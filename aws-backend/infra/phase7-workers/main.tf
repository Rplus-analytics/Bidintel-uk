data "aws_secretsmanager_secret" "worker_db" {
  name = "${var.name_prefix}/worker-db" # bidintel_app
}

data "aws_secretsmanager_secret" "openai" {
  name = "${var.name_prefix}/openai"
}

data "aws_caller_identity" "current" {}

locals {
  ec2_arn_prefix = "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}"

  db_env = {
    DATABASE_SECRET_ARN = data.aws_secretsmanager_secret.worker_db.arn
  }
  ai_env = {
    OPENAI_SECRET_ARN = data.aws_secretsmanager_secret.openai.arn
  }

  # timeout: generous where a function pages through an upstream API; Lambda's
  # ceiling is 900s and several of these legitimately need minutes.
  #
  # reserved = 1 SINGLE-FLIGHTS a worker, and it is not a cost control.
  #
  # Find a Tender rate-limits per IP ("Rate limit of 12 exceeded"), and every
  # VPC Lambda here shares one NAT address. Four concurrent ingest-fts
  # invocations — which is what repeated manual invocations produced — therefore
  # sabotage each other: each container paces itself correctly and the host still
  # sees four times the agreed rate. Per-container pacing cannot fix that; only
  # limiting concurrency can.
  #
  # It is also correct independently: these are cron singletons that hold
  # advisory locks in backfill_state, and two concurrent runs of the same worker
  # duplicate work and contend for the same lock.
  #
  # This was impossible until 25 Sep, when the account concurrency quota was
  # raised from 10 to 1000 — at 10, ANY reservation was rejected for dropping
  # unreserved capacity below the floor.
  workers = {
    # --- ingestion ---------------------------------------------------------
    ingest-cf                   = { timeout = 720, memory = 512, reserved = 1, schedule = "rate(1 hour)", ai = false }
    ingest-fts                  = { timeout = 720, memory = 512, reserved = 1, schedule = "rate(1 hour)", ai = false }
    ingest-cf-native            = { timeout = 600, memory = 768, reserved = 1, schedule = "rate(30 minutes)", ai = false }
    ingest-contracts-scotland   = { timeout = 300, memory = 512, reserved = 1, schedule = "rate(2 hours)", ai = false }
    ingest-cf-bulk              = { timeout = 900, memory = 1536, reserved = 1, schedule = null, ai = false }
    ingest-source-full          = { timeout = 900, memory = 1024, reserved = 1, schedule = null, ai = false }
    ingest-trigger              = { timeout = 120, memory = 512, schedule = null, ai = false }
    sync-notices                = { timeout = 900, memory = 1024, reserved = 1, schedule = "rate(6 hours)", ai = false }
    normalize-raw-cf            = { timeout = 600, memory = 1024, reserved = 1, schedule = "rate(1 hour)", ai = false }
    scrape-cf-notice            = { timeout = 120, memory = 512, schedule = null, ai = false }
    scrape-ccs-digital-outcomes = { timeout = 600, memory = 768, reserved = 1, schedule = "rate(12 hours)", ai = false }

    # --- backfill ----------------------------------------------------------
    backfill-tick          = { timeout = 600, memory = 768, reserved = 1, schedule = "rate(5 minutes)", ai = false }
    backfill-source-tick   = { timeout = 600, memory = 768, reserved = 1, schedule = "rate(5 minutes)", ai = false }
    backfill-status        = { timeout = 60, memory = 512, schedule = null, ai = false }
    backfill-raw-cf        = { timeout = 900, memory = 1024, reserved = 1, schedule = null, ai = false }
    backfill-cf-bulk-tick  = { timeout = 900, memory = 1024, reserved = 1, schedule = null, ai = false }
    # No schedule, ever. It is gated behind BACKFILL_LINKED_TABLES_ENABLED and an
    # admin token precisely so it cannot run unattended.
    backfill-linked-tables = { timeout = 900, memory = 1024, schedule = null, ai = false }

    # --- embedding ---------------------------------------------------------
    embed-tenders-batch       = { timeout = 600, memory = 1024, reserved = 1, schedule = "rate(15 minutes)", ai = true }
    generate-tender-embedding = { timeout = 120, memory = 512, schedule = null, ai = true }
  }
}

# ---------------------------------------------------------------------------
# IAM — one role per worker
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
  for_each           = local.workers
  name               = "${var.name_prefix}-${each.key}"
  description        = "Worker execution role for ${each.key}."
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.workers
  name              = "/aws/lambda/${var.name_prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role_policy" "logs" {
  for_each = local.workers
  name     = "logs"
  role     = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.fn[each.key].arn}:*"
    }]
  })
}

resource "aws_iam_role_policy" "secrets" {
  for_each = local.workers
  name     = "secrets"
  role     = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = each.value.ai ? [
        data.aws_secretsmanager_secret.worker_db.arn,
        data.aws_secretsmanager_secret.openai.arn,
      ] : [data.aws_secretsmanager_secret.worker_db.arn]
    }]
  })
}

# See phase4's note: Lambda pre-flight-checks these with no resource context, so
# CreateNetworkInterface must be scoped by RESOURCE ARN (which it honours) and
# the rest must be "*" (which it does not).
resource "aws_iam_role_policy" "vpc" {
  for_each = local.workers
  name     = "vpc-access"
  role     = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "DescribeNetwork", Effect = "Allow", Action = ["ec2:DescribeNetworkInterfaces"], Resource = "*" },
      {
        Sid    = "CreateEniInTheseSubnetsOnly"
        Effect = "Allow"
        Action = ["ec2:CreateNetworkInterface"]
        Resource = concat(
          [for s in var.private_subnet_ids : "${local.ec2_arn_prefix}:subnet/${s}"],
          ["${local.ec2_arn_prefix}:security-group/${var.lambda_security_group_id}",
          "${local.ec2_arn_prefix}:network-interface/*"],
        )
      },
      {
        Sid      = "ManageEni"
        Effect   = "Allow"
        Action   = ["ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
        Resource = "*"
      },
    ]
  })
}

# sync-notices fans out to the three source proxies. It calls them through the
# LAMBDA API rather than the HTTP API: every API Gateway route carries the
# Cognito authorizer, so an unauthenticated call returns 401 — and callSource()
# swallows a non-2xx into an empty array, which would have made this worker
# report success while ingesting nothing. IAM is both stronger and simpler than
# minting a user token for a machine.
resource "aws_iam_role_policy" "sync_notices_invoke" {
  name = "invoke-sources"
  role = aws_iam_role.fn["sync-notices"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      Resource = [
        "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.name_prefix}-contracts-finder",
        "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.name_prefix}-contracts-scotland",
        "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.name_prefix}-find-a-tender",
      ]
    }]
  })
}

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "fn" {
  for_each = local.workers

  function_name    = "${var.name_prefix}-${each.key}"
  role             = aws_iam_role.fn[each.key].arn
  filename         = "${var.build_dir}/${each.key}.zip"
  source_code_hash = filebase64sha256("${var.build_dir}/${each.key}.zip")
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  timeout          = each.value.timeout
  memory_size      = each.value.memory
  reserved_concurrent_executions = try(each.value.reserved, -1)

  environment {
    variables = merge(
      local.db_env,
      each.value.ai ? local.ai_env : {},
      each.key == "sync-notices" ? { SOURCE_FN_PREFIX = "${var.name_prefix}-" } : {},
    )
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [var.lambda_security_group_id]
  }

  depends_on = [aws_cloudwatch_log_group.fn]
}

# ---------------------------------------------------------------------------
# Schedules — created DISABLED
# ---------------------------------------------------------------------------

locals {
  scheduled = { for k, v in local.workers : k => v if v.schedule != null }
}

resource "aws_cloudwatch_event_rule" "fn" {
  for_each = local.scheduled

  name                = "${var.name_prefix}-${each.key}"
  description         = "Scheduled run for ${each.key}."
  schedule_expression = each.value.schedule
  state               = var.enable_schedules ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "fn" {
  for_each = local.scheduled

  rule = aws_cloudwatch_event_rule.fn[each.key].name
  arn  = aws_lambda_function.fn[each.key].arn
}

resource "aws_lambda_permission" "events" {
  for_each = local.scheduled

  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.fn[each.key].arn
}
