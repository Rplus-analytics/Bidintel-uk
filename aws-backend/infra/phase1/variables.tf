variable "aws_region" {
  description = "Target region. Decided 2026-09-10: Stockholm, where bidintel-1 lives."
  type        = string
  default     = "eu-north-1"
}

variable "account_id" {
  description = "AWS account ID, used to make the state bucket name globally unique."
  type        = string
  default     = "008041477140"
}

variable "name_prefix" {
  type    = string
  default = "bidintel"
}

variable "mail_from_domain" {
  description = <<-EOT
    Domain SES sends from. DKIM CNAME records must be added to this domain's DNS
    before the identity verifies — Terraform creates the identity and emits the
    records, but cannot publish them unless the zone is also in Route 53.
  EOT
  type        = string
  default     = "bidintel.rplusai.co.uk"
}

variable "manage_dns_in_route53" {
  description = "Set true only if this domain's DNS is hosted in Route 53 in THIS account, in which case the DKIM records are published automatically."
  type        = bool
  default     = false
}
