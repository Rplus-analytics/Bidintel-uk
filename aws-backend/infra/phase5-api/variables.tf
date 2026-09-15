variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "name_prefix" {
  type    = string
  default = "bidintel"
}

variable "cognito_issuer" {
  description = "Token issuer. A token from any other user pool fails validation here."
  type        = string
  default     = "https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_9LKk8RR6t"
}

variable "cognito_audience" {
  description = <<-EOT
    The SPA app client ID. This is the `aud` claim on an ID TOKEN. Access tokens
    from this pool carry `client_id` instead and will NOT validate against this
    authorizer — deliberate: the ID token is the one carrying the custom
    app_user_id / org_id claims the pre-token-generation V1 trigger adds.
  EOT
  type        = string
  default     = "4ua1vhje9gmm3kekuk6spvf1r"
}

variable "cors_allow_origins" {
  description = <<-EOT
    Exact origins, never "*". A wildcard is incompatible with credentialed
    requests anyway, and this API is only ever called from the app.
    The Vercel origin is deliberately absent for now: that frontend is served
    over HTTPS and cannot call the HTTP PostgREST ALB, so it is not yet a
    working client. Add it when the HTTPS decision lands.
  EOT
  type        = list(string)
  default     = ["http://localhost:8080"]
}

variable "log_retention_days" {
  type    = number
  default = 14
}
