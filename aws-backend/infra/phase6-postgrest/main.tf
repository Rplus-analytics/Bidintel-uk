data "aws_secretsmanager_secret" "db" {
  name = "${var.name_prefix}/app-db" # holds bidintel_authenticator
}

data "aws_secretsmanager_secret" "jwks" {
  name = "${var.name_prefix}/jwks"
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-postgrest-alb"
  description = "PostgREST ALB. Ingress from named operator IPs only - never 0.0.0.0/0 while this listener is plain HTTP."
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-postgrest-alb" }
}

# ---------------------------------------------------------------------------
# NO ingress rules here, on purpose
# ---------------------------------------------------------------------------
#
# The ALB's allowlist is NOT managed by Terraform. Testers are on dynamic home
# and office ISP addresses that change without warning — when one does, the app
# goes blank and the fix has to be a ten-second command, not a plan-and-apply
# against a stack that also owns the load balancer and the ECS service.
#
# `scripts/allow-ip.sh <label>` owns these rules instead. It tags each rule's
# description with `bidintel-access:<label>` and only ever revokes rules
# carrying the same label, so one person's address can be updated without
# disturbing anyone else's.
#
# Terraform still owns the security GROUP, its egress, and the RDS/task rules
# that reference security groups rather than addresses — the parts that are
# genuinely infrastructure. A per-person dynamic IP is operational data.
#
# This split was not the original design: Terraform did manage an `admin_cidrs`
# ingress rule, and the first run of the new script revoked it, leaving the
# stack drifted and wanting to recreate a duplicate. Removed here and dropped
# from state with `terraform state rm`.

resource "aws_vpc_security_group_egress_rule" "alb_to_task" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the PostgREST task"
  referenced_security_group_id = aws_security_group.task.id
  from_port                    = 3000
  to_port                      = 3001
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "task" {
  name        = "${var.name_prefix}-postgrest-task"
  description = "PostgREST Fargate task. Reachable only from the ALB."
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name_prefix}-postgrest-task" }
}

resource "aws_vpc_security_group_ingress_rule" "task_from_alb" {
  security_group_id            = aws_security_group.task.id
  description                  = "API + admin (health check) ports, from the ALB security group only"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3001
  ip_protocol                  = "tcp"
}

# Outbound for the image pull, Secrets Manager, CloudWatch and RDS, all via NAT.
resource "aws_vpc_security_group_egress_rule" "task_all" {
  security_group_id = aws_security_group.task.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# Same principle as the Lambda rule: RDS trusts a SECURITY GROUP, not a CIDR.
resource "aws_vpc_security_group_ingress_rule" "rds_from_task" {
  security_group_id            = var.rds_security_group_id
  description                  = "PostgreSQL from the PostgREST task SG only"
  referenced_security_group_id = aws_security_group.task.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# ---------------------------------------------------------------------------
# Load balancer
# ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${var.name_prefix}-postgrest"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  # Not a production hardening knob so much as a statement of intent: this
  # listener must not be casually deleted while it is the only way in.
  enable_deletion_protection = false

  # Longer than PostgREST's slowest expected query; shorter than the ALB default
  # of 60s so a stuck connection is not held open for a minute.
  idle_timeout = 45
}

resource "aws_lb_target_group" "postgrest" {
  name        = "${var.name_prefix}-postgrest"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # Fargate awsvpc networking

  health_check {
    enabled = true
    # PostgREST's ADMIN server, on its own port. /live says the process is up;
    # /ready additionally says the database connection is established and the
    # schema cache is loaded — which is what "in service" should actually mean.
    #
    # Health-checking the API port instead would mean checking "/", whose status
    # depends on the anon role's privileges. Since anon is revoked from every
    # user table, that would tie liveness to an authorisation decision.
    port                = "3001"
    protocol            = "HTTP"
    path                = "/ready"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Nothing in this API is session-affine.
  deregistration_delay = 15
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# The EXECUTION role is used by the ECS agent before the container starts: it
# pulls the image, writes logs, and resolves the secrets injected below. The
# container itself never assumes it.
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-postgrest-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-own-secrets"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [data.aws_secretsmanager_secret.db.arn, data.aws_secretsmanager_secret.jwks.arn]
    }]
  })
}

# Deliberately EMPTY of permissions. PostgREST calls no AWS API at runtime — it
# talks to Postgres and nothing else — so its task role grants nothing. The role
# exists only because ECS Exec would need one later.
resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-postgrest-task"
  description        = "PostgREST runtime role. Intentionally holds no permissions: the process calls no AWS API."
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "postgrest" {
  name              = "/ecs/${var.name_prefix}-postgrest"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"
}

resource "aws_ecs_task_definition" "postgrest" {
  family                   = "${var.name_prefix}-postgrest"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "ARM64" # Graviton, ~20% cheaper
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "postgrest"
    image     = var.postgrest_image
    essential = true

    portMappings = [
      { containerPort = 3000, protocol = "tcp" },
      { containerPort = 3001, protocol = "tcp" },
    ]

    environment = [
      # THE CONNECTION STRING IS EMPTY ON PURPOSE. An empty libpq URI makes the
      # client take every parameter from the PG* environment variables below.
      # That means the password is injected straight from Secrets Manager into
      # its own variable and is never assembled into a URI — nothing has to
      # URL-encode it, and it cannot leak through a logged connection string.
      { name = "PGRST_DB_URI", value = "postgresql://" },
      { name = "PGPORT", value = "5432" },
      { name = "PGSSLMODE", value = "require" },

      { name = "PGRST_DB_SCHEMAS", value = "public" },

      # The role PostgREST uses when a request carries NO token. `anon` is
      # revoked from every user table, so an unauthenticated request reaches
      # nothing — this is what makes a missing token return empty rather than
      # erroring.
      { name = "PGRST_DB_ANON_ROLE", value = "anon" },

      # Audience validation. A token minted for a different client of the same
      # user pool is rejected here.
      { name = "PGRST_JWT_AUD", value = var.cognito_audience },

      # Issuer validation. PostgREST has no setting for `iss`, so it is enforced
      # in the database — see aws-backend/schema/06-postgrest.sql. This function
      # runs after SET ROLE and before the query, in the same transaction.
      { name = "PGRST_DB_PRE_REQUEST", value = "public.check_jwt_issuer" },

      # The claim PostgREST reads to decide which role to SET. The
      # pre-token-generation V1 trigger puts `role` on the ID token for exactly
      # this purpose.
      { name = "PGRST_JWT_ROLE_CLAIM_KEY", value = ".role" },

      { name = "PGRST_SERVER_PORT", value = "3000" },
      { name = "PGRST_ADMIN_SERVER_PORT", value = "3001" },

      # 10 connections from one task, against a small instance also serving the
      # Lambdas. Raise only alongside the RDS instance class.
      { name = "PGRST_DB_POOL", value = "10" },

      # Off. Leaving it on would publish a complete description of the schema —
      # every table, column and function — to anything that can reach the ALB.
      { name = "PGRST_OPENAPI_MODE", value = "disabled" },

      { name = "PGRST_LOG_LEVEL", value = "info" },
    ]

    # Resolved by the ECS agent at start-up and injected as environment
    # variables. The values never appear in the task definition, in Terraform
    # state, or in `aws ecs describe-task-definition`.
    secrets = [
      { name = "PGUSER", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:PGUSER::" },
      { name = "PGPASSWORD", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:PGPASSWORD::" },
      { name = "PGHOST", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:PGHOST::" },
      { name = "PGDATABASE", valueFrom = "${data.aws_secretsmanager_secret.db.arn}:PGDATABASE::" },
      # The whole secret: PostgREST accepts a JWK Set as jwt-secret. These are
      # PUBLIC keys; they live in Secrets Manager for uniform delivery and
      # one-command rotation, not because they are confidential.
      { name = "PGRST_JWT_SECRET", valueFrom = data.aws_secretsmanager_secret.jwks.arn },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.postgrest.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "postgrest"
      }
    }
  }])
}

resource "aws_ecs_service" "postgrest" {
  name            = "${var.name_prefix}-postgrest"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.postgrest.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets = var.private_subnet_ids
    # Private subnets with a NAT: no public IP, and the task is not reachable
    # from the internet except through the ALB.
    assign_public_ip = false
    security_groups  = [aws_security_group.task.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.postgrest.arn
    container_name   = "postgrest"
    container_port   = 3000
  }

  # PostgREST takes a few seconds to connect and load the schema cache; without
  # this the first health checks fail and ECS kills the task in a loop.
  health_check_grace_period_seconds = 60

  # One task, so a rolling deploy must be allowed to run two briefly.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]
}

# ---------------------------------------------------------------------------
# TLS certificate
# ---------------------------------------------------------------------------
#
# MUST be in eu-north-1: an ALB can only use a certificate from its own region.
# (CloudFront is the exception that requires us-east-1; this is not CloudFront.)
#
# DNS validation rather than email: it is the only method that can be automated,
# and it re-validates silently at renewal. Email validation would need a human
# to click a link every 13 months or the listener breaks.

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"

  lifecycle {
    # ACM cannot change a certificate's domain in place. Without this, any such
    # change destroys the certificate the live listener is using before the
    # replacement exists.
    create_before_destroy = true
  }

  tags = { Name = var.api_domain }
}

# NOT aws_acm_certificate_validation: that resource BLOCKS the apply until the
# certificate is issued, and issuance depends on a human adding a record in
# Cloudflare. It would hold a state lock for as long as that takes and then time
# out. The two-stage var.enable_https flag does the same job without blocking.

# ---------------------------------------------------------------------------
# HTTPS listener
# ---------------------------------------------------------------------------

resource "aws_lb_listener" "https" {
  count = var.enable_https ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate.api.arn

  # TLS 1.2 minimum. The -TLS13- policies also negotiate 1.3 where the client
  # supports it. Excludes the 1.0/1.1 suites entirely; nothing that needs to
  # reach this is that old.
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.postgrest.arn
  }
}

# ---------------------------------------------------------------------------
# Port 80
# ---------------------------------------------------------------------------
#
# Once 443 exists, 80 stops serving traffic and only redirects. HSTS is NOT set
# here: this host is reached by XHR from the app rather than by typing it into a
# browser, so a Strict-Transport-Security header would do nothing useful while
# pinning the domain to HTTPS in every visitor's browser for its max-age — an
# awkward thing to undo if the domain is ever reused.

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.enable_https ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.postgrest.arn
    }
  }

  dynamic "default_action" {
    for_each = var.enable_https ? [1] : []
    content {
      type = "redirect"
      redirect {
        port     = "443"
        protocol = "HTTPS"
        # 301, not 302: this is permanent, and a permanent redirect is cached by
        # the client so the plaintext round trip stops happening at all.
        status_code = "HTTP_301"
      }
    }
  }
}
