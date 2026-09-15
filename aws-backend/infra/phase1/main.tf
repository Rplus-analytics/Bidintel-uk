# ---------------------------------------------------------------------------
# Terraform remote state
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.name_prefix}-tfstate-${var.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

# Versioning is not optional on a state bucket: it is the only way back from a
# corrupted or truncated state file.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# State files contain resource metadata and occasionally secrets. This bucket
# must never be public under any circumstances.
resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    id     = "expire-noncurrent-state"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Deny any non-TLS access to the bucket.
resource "aws_s3_bucket_policy" "tfstate_tls_only" {
  bucket = aws_s3_bucket.tfstate.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.tfstate.arn,
        "${aws_s3_bucket.tfstate.arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}

# State locking uses S3-NATIVE locking (`use_lockfile = true` in the backend
# block), not DynamoDB. Terraform >= 1.10 writes a `.tflock` object next to the
# state and relies on S3 conditional writes for mutual exclusion. That needs no
# extra resource here — only bucket versioning, which is enabled above.
#
# The lifecycle rule below deliberately does NOT expire `.tflock` objects
# quickly; a stale lock is cleared with `terraform force-unlock`, not by S3.

# ---------------------------------------------------------------------------
# Secrets Manager — containers only, no values
# ---------------------------------------------------------------------------
#
# Deliberately NO aws_secretsmanager_secret_version resources. A version would
# put the secret value into Terraform state in plaintext. These are created
# empty and populated out of band:
#
#   aws secretsmanager put-secret-value --secret-id bidintel/ai-gateway \
#     --secret-string '{"LOVABLE_API_KEY":"..."}' --profile rplusai
#
# The RDS master password already exists as an AWS-managed secret
# (rds!db-43ad15dc-...) and is deliberately not duplicated here.

locals {
  app_secrets = {
    "ai-gateway" = "AI provider credentials. Currently LOVABLE_API_KEY; see the open decision in docs/DEPLOYMENT-PLAN.md about replacing the Lovable gateway."
    "resend"     = "RESEND_API_KEY and ALERTS_FROM_ADDRESS for daily-search-alerts."
    "app-db"     = "Application (non-owner, non-BYPASSRLS) database role for the Lambda functions. NOT the RDS master user."
    "api-db"     = "bidintel_api — the LOGIN role user-facing Lambdas (semantic-search, buyer-profile) use. LOGIN, NOBYPASSRLS: it reads data tables directly but reaches user tables only through RLS. Deliberately separate from bidintel_app, whose BYPASSRLS must never back a user-facing path."
    "worker-db"  = "bidintel_app — the LOGIN role the ingestion/embedding Lambdas use. Has direct table privileges on the data tables and BYPASSRLS (it writes rows for every organisation and is never reachable from the web tier). Deliberately separate from bidintel/app-db so a compromised web tier cannot obtain worker privileges."
    "openai"     = "OPENAI_API_KEY. Launch AI provider: text-embedding-3-small for embeddings (vector-identical to what Lovable's gateway produced, so no re-embedding penalty) and a chat model with tool calling for buyer-profile. Bedrock is post-launch."
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.app_secrets

  name        = "${var.name_prefix}/${each.key}"
  description = each.value

  # Long enough to recover from an accidental delete, short enough that a
  # rotation is not blocked for a month.
  recovery_window_in_days = 7
}

# ---------------------------------------------------------------------------
# SES — domain identity + DKIM
# ---------------------------------------------------------------------------
#
# NOTE: production access (leaving the sandbox) CANNOT be done in Terraform. It
# is a support case in the SES console. Until it is granted, SES will only send
# to verified addresses. See docs/DEPLOYMENT-PLAN.md phase 1.

resource "aws_sesv2_email_identity" "main" {
  email_identity = var.mail_from_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "main" {
  email_identity         = aws_sesv2_email_identity.main.email_identity
  mail_from_domain       = "mail.${var.mail_from_domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# Only published automatically when the zone lives in Route 53 in this account.
# Otherwise read them from the `ses_dkim_records` output and add them by hand.
data "aws_route53_zone" "main" {
  count        = var.manage_dns_in_route53 ? 1 : 0
  name         = var.mail_from_domain
  private_zone = false
}

resource "aws_route53_record" "dkim" {
  count = var.manage_dns_in_route53 ? 3 : 0

  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = "${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.mail_from_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}
