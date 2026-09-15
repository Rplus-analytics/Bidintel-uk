variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "name_prefix" {
  type    = string
  default = "bidintel"
}

variable "vpc_id" {
  type    = string
  default = "vpc-0b343e728bc5e8eb1"
}

variable "public_subnet_ids" {
  description = "The ALB needs at least two AZs. These are the default VPC's public subnets."
  type        = list(string)
  default     = ["subnet-06cc022f95f6c3cbc", "subnet-0e479e8942cd00c2e", "subnet-051bcbeff2e9b979a"]
}

variable "private_subnet_ids" {
  description = "From phase3-network. The PostgREST task runs here, not in public subnets."
  type        = list(string)
  default     = ["subnet-0ff77108be79ccdd5", "subnet-0a1094478008deedb"]
}

variable "rds_security_group_id" {
  type    = string
  default = "sg-0ee45efaf95f0dce1"
}

variable "cognito_audience" {
  description = "SPA client ID. PostgREST rejects any token whose `aud` is not this."
  type        = string
  default     = "4ua1vhje9gmm3kekuk6spvf1r"
}

variable "postgrest_image" {
  description = "Pinned by digest-bearing tag rather than :latest, so a redeploy cannot silently change versions."
  type        = string
  default     = "postgrest/postgrest:v12.2.3"
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "api_domain" {
  description = <<-EOT
    The hostname the app talks to. DELIBERATELY NOT bidintel.rplusai.co.uk —
    that is the live Lovable site and repointing it is a cutover step, not a
    prerequisite for testing.
  EOT
  type        = string
  default     = "api.bidintel.rplusai.co.uk"
}

variable "enable_https" {
  description = <<-EOT
    Gates the 443 listener and the 80 -> 443 redirect.

    Two-stage on purpose. ACM will not issue until the validation CNAME exists
    in Cloudflare, and a listener referencing an unissued certificate fails the
    apply. So: apply once with this false to create the certificate and emit the
    record, add the record, then apply again with it true.
  EOT
  type        = bool
  default     = false
}
