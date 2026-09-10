output "tfstate_bucket" {
  description = "S3 bucket for Terraform remote state. Put this in every later phase's backend block."
  value       = aws_s3_bucket.tfstate.id
}

output "backend_block" {
  description = "Copy-paste backend config for phases 2-7."
  value       = <<-EOT
    backend "s3" {
      bucket       = "${aws_s3_bucket.tfstate.id}"
      key          = "<phase>/terraform.tfstate"
      region       = "${var.aws_region}"
      encrypt      = true
      use_lockfile = true
    }
  EOT
}

output "secret_arns" {
  description = "Empty secret containers. Populate with `aws secretsmanager put-secret-value` — never in Terraform."
  value       = { for k, v in aws_secretsmanager_secret.app : k => v.arn }
}

output "ses_identity" {
  value = aws_sesv2_email_identity.main.email_identity
}

output "ses_dkim_records" {
  description = "Add these three CNAMEs to DNS to verify the domain (automatic only if manage_dns_in_route53 = true)."
  value = [
    for t in aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens :
    "${t}._domainkey.${var.mail_from_domain}  CNAME  ${t}.dkim.amazonses.com"
  ]
}

output "ses_mail_from_records" {
  description = "MX and SPF records for the custom MAIL FROM subdomain."
  value = [
    "mail.${var.mail_from_domain}  MX  10 feedback-smtp.${var.aws_region}.amazonses.com",
    "mail.${var.mail_from_domain}  TXT  \"v=spf1 include:amazonses.com ~all\"",
  ]
}

output "next_steps" {
  value = <<-EOT
    1. Uncomment the backend block in versions.tf, then: terraform init -migrate-state
    2. Add the DKIM CNAMEs and MAIL FROM records above to DNS
    3. Request SES production access in the console (cannot be done in Terraform)
    4. Populate the three secrets with `aws secretsmanager put-secret-value`
  EOT
}
