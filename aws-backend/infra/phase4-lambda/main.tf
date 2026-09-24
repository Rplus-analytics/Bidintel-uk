# ---------------------------------------------------------------------------
# Existing secrets (created empty in phase 1, populated out of band)
# ---------------------------------------------------------------------------
#
# Read as data sources so the exact ARN — including the six-character suffix
# Secrets Manager appends — goes into the IAM policies. A wildcard ARN would
# also match a future `bidintel/api-db-2`; these do not.

data "aws_secretsmanager_secret" "api_db" {
  name = "${var.name_prefix}/api-db"
}

data "aws_secretsmanager_secret" "openai" {
  name = "${var.name_prefix}/openai"
}

# ---------------------------------------------------------------------------
# Function definitions
# ---------------------------------------------------------------------------
#
# `secrets` is the ONLY source of a function's secretsmanager:GetSecretValue
# grant. A function with an empty list gets a policy with no Secrets Manager
# statement at all, so the three proxies literally cannot read a secret even if
# one were later added to their environment by mistake.

locals {
  functions = {
    semantic-search = {
      description = "Hybrid semantic + keyword + CPV tender search. Calls search_tenders_hybrid as bidintel_api, under RLS."
      timeout     = 30
      memory      = 1024
      vpc         = true
      # RESTORED 25 Sep, when the account quota went from 10 to 1000.
      # Previously: set to -1 because THIS ACCOUNT'S TOTAL Lambda
      # concurrency limit is 10 — the default for a new account, not the usual
      # 1000. Any reservation at all fails with:
      #
      #   InvalidParameterValueException: Specified ReservedConcurrentExecutions
      #   ... decreases account's UnreservedConcurrentExecution below its
      #   minimum value of [10]
      #
      # The account cap is a tighter guard than the reservation would have been,
      # so nothing is lost today. It is however a CUTOVER BLOCKER: ten
      # concurrent executions is shared by every function including the
      # ingestion fleet, so a cron run and a user search compete. Raise it via
      # a Service Quotas request before go-live, then restore this reservation.
      reserved_concurrency = 10
      secrets = [
        data.aws_secretsmanager_secret.api_db.arn,
        data.aws_secretsmanager_secret.openai.arn,
      ]
      env = {
        DATABASE_SECRET_ARN = data.aws_secretsmanager_secret.api_db.arn
        OPENAI_SECRET_ARN   = data.aws_secretsmanager_secret.openai.arn
      }
    }

    buyer-profile = {
      description = "Buyer description + org chart via OpenAI tool calling. No database access."
      # Observed ~5.6s against OpenAI; 60s leaves room for a slow upstream
      # without letting a hung request burn a full API Gateway timeout.
      timeout              = 60
      memory               = 512
      vpc                  = true
      reserved_concurrency = 5
      secrets              = [data.aws_secretsmanager_secret.openai.arn]
      env                  = { OPENAI_SECRET_ARN = data.aws_secretsmanager_secret.openai.arn }
    }

    contracts-finder = {
      description          = "Contracts Finder V2 search proxy. No database, no secrets."
      timeout              = 60 # two 20s upstream attempts plus mapping
      memory               = 512
      vpc                  = false
      reserved_concurrency = -1
      secrets              = []
      env                  = {}
    }

    contracts-scotland = {
      description          = "Public Contracts Scotland proxy. No database, no secrets."
      timeout              = 30
      memory               = 512
      vpc                  = false
      reserved_concurrency = -1
      secrets              = []
      env                  = {}
    }

    find-a-tender = {
      description          = "Find a Tender Service OCDS proxy. No database, no secrets."
      timeout              = 30
      memory               = 512
      vpc                  = false
      reserved_concurrency = -1
      secrets              = []
      env                  = {}
    }
  }
}

# ---------------------------------------------------------------------------
# IAM — one role per function, never a shared role
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each = local.functions

  name               = "${var.name_prefix}-${each.key}"
  description        = "Execution role for ${each.key}. Secrets access is scoped to this function's own secrets."
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Logs only. Note this is NOT AWSLambdaBasicExecutionRole: that managed policy
# grants logs:* on "*", letting any function write into any other function's log
# group. This restricts each role to its own.
data "aws_iam_policy_document" "logs" {
  for_each = local.functions

  statement {
    sid       = "OwnLogGroupOnly"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.fn[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  for_each = local.functions

  name   = "logs"
  role   = aws_iam_role.fn[each.key].id
  policy = data.aws_iam_policy_document.logs[each.key].json
}

# Only created for functions that actually declare secrets, so the three proxy
# roles carry no Secrets Manager permission of any kind.
resource "aws_iam_role_policy" "secrets" {
  for_each = { for k, v in local.functions : k => v if length(v.secrets) > 0 }

  name = "secrets"
  role = aws_iam_role.fn[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadOwnSecretsOnly"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = each.value.secrets
    }]
  })
}

# ENI management for the VPC-attached functions.
#
# NOTE ON THE SHAPE OF THIS POLICY: the obvious least-privilege version —
# ec2:CreateNetworkInterface on "*" with a `StringEquals ec2:Subnet` condition —
# is REJECTED by Lambda at CreateFunction time:
#
#   InvalidParameterValueException: The provided execution role does not have
#   permissions to call CreateNetworkInterface on EC2
#
# Lambda pre-flight-checks the role with a policy simulation that supplies no
# subnet context, so any condition on that action evaluates false and the
# function will not create at all. The equivalent restriction has to be
# expressed as RESOURCE ARNs instead, which the simulation does honour: naming
# the two subnets and the security group means this role can only build an ENI
# in this VPC's private subnets, with that SG.

data "aws_caller_identity" "current" {}

locals {
  ec2_arn_prefix = "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}"
}

resource "aws_iam_role_policy" "vpc" {
  for_each = { for k, v in local.functions : k => v if v.vpc }

  name = "vpc-access"
  role = aws_iam_role.fn[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Cannot be resource-scoped: AWS only supports "*" for this action.
        Sid      = "DescribeNetwork"
        Effect   = "Allow"
        Action   = ["ec2:DescribeNetworkInterfaces"]
        Resource = "*"
      },
      {
        Sid    = "CreateEniInTheseSubnetsOnly"
        Effect = "Allow"
        Action = ["ec2:CreateNetworkInterface"]
        Resource = concat(
          [for s in var.private_subnet_ids : "${local.ec2_arn_prefix}:subnet/${s}"],
          [
            "${local.ec2_arn_prefix}:security-group/${var.lambda_security_group_id}",
            "${local.ec2_arn_prefix}:network-interface/*",
          ],
        )
      },
      {
        # Also "*", and also not by choice: scoping these to
        # `:network-interface/*` fails the same pre-flight check with
        # "does not have permissions to call DeleteNetworkInterface on EC2".
        # Lambda evaluates them with no resource context at all.
        #
        # RESIDUAL RISK, stated plainly: this role could delete any ENI in the
        # account, not only its own. It cannot CREATE one outside the two
        # private subnets above, and it holds no other EC2 permission, so the
        # exposure is denial-of-service against this account's networking rather
        # than data access. Accepted; the alternative is not running the
        # function in a VPC at all.
        Sid      = "ManageEni"
        Effect   = "Allow"
        Action   = ["ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
        Resource = "*"
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# Log groups — created here, not implicitly by Lambda
# ---------------------------------------------------------------------------
#
# A log group Lambda creates on first invocation has NEVER-EXPIRE retention and
# is not tracked by Terraform. Declaring it makes the retention deliberate.

resource "aws_cloudwatch_log_group" "fn" {
  for_each = local.functions

  name              = "/aws/lambda/${var.name_prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# The functions
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "fn" {
  for_each = local.functions

  function_name = "${var.name_prefix}-${each.key}"
  description   = each.value.description
  role          = aws_iam_role.fn[each.key].arn

  filename = "${var.build_dir}/${each.key}.zip"
  # Forces a new deployment whenever the bundle changes. scripts/build-lambda.sh
  # zips with a fixed timestamp, so this hash tracks SOURCE changes only and an
  # unchanged function is not redeployed just because a sibling was rebuilt.
  source_code_hash = filebase64sha256("${var.build_dir}/${each.key}.zip")

  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"] # Graviton: ~20% cheaper per ms, same code

  timeout                        = each.value.timeout
  memory_size                    = each.value.memory
  reserved_concurrent_executions = each.value.reserved_concurrency

  dynamic "environment" {
    for_each = length(each.value.env) > 0 ? [1] : []
    content {
      variables = each.value.env
    }
  }

  dynamic "vpc_config" {
    for_each = each.value.vpc ? [1] : []
    content {
      subnet_ids         = var.private_subnet_ids
      security_group_ids = [var.lambda_security_group_id]
    }
  }

  # Without this the first invocation can race the log group into existence and
  # inherit never-expire retention.
  depends_on = [aws_cloudwatch_log_group.fn]
}
