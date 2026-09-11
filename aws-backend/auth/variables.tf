variable "aws_region" {
  description = "AWS region for the User Pool. Keep it in the same region as the API Gateway and RDS instance."
  type        = string
  default     = "eu-north-1" # Stockholm — where bidintel-1 lives (region decision, 2026-09-10)
}

variable "environment" {
  description = "Deployment environment. Used in resource names and tags."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
  default     = "bidintel"
}

variable "cognito_domain_prefix" {
  description = <<-EOT
    Prefix for the Cognito-hosted domain, producing
    https://<prefix>.auth.<region>.amazoncognito.com. Must be globally unique
    across all AWS accounts, so a bare "bidintel" may already be taken — append
    the environment or a short random suffix. Required for the MCP OAuth flow
    (authorization endpoint + hosted sign-in page).
  EOT
  type        = string
  default     = "bidintel-auth"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.cognito_domain_prefix))
    error_message = "cognito_domain_prefix must be lowercase alphanumeric with hyphens, 3-63 chars, and must not start or end with a hyphen."
  }
}

variable "api_identifier" {
  description = <<-EOT
    Resource-server identifier for the BidIntel API. This becomes the prefix of
    every custom scope (e.g. "<identifier>/bids.write") and the `aud`-adjacent
    value MCP clients request. It is an opaque identifier, not a URL that has to
    resolve — but using the real API URL is the convention.
  EOT
  type        = string
  default     = "https://api.bidintel.rplusai.co.uk"
}

variable "spa_callback_urls" {
  description = "Allowed OAuth redirect URLs for the web app. Only needed if the SPA uses the hosted UI; the direct SRP sign-in flow (the like-for-like replacement for the current form) does not use these."
  type        = list(string)
  default = [
    "https://bidintel-drab.vercel.app/auth/callback",
    "https://bidintel.rplusai.co.uk/auth/callback",
    "http://localhost:8080/auth/callback",
  ]
}

variable "spa_logout_urls" {
  description = "Allowed post-logout redirect URLs for the web app."
  type        = list(string)
  default = [
    "https://bidintel-drab.vercel.app/auth",
    "https://bidintel.rplusai.co.uk/auth",
    "http://localhost:8080/auth",
  ]
}

variable "mcp_callback_urls" {
  description = <<-EOT
    Redirect URLs for the MCP OAuth client. MCP clients (Claude Desktop, IDE
    integrations) each have their own callback; every one must be listed here
    because Cognito does not support RFC 7591 dynamic client registration.
    See AUTH-MIGRATION-PLAN.md § "MCP and OAuth" — this is a real constraint.
  EOT
  type        = list(string)
  default = [
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:33418/oauth/callback",
  ]
}

variable "password_minimum_length" {
  description = <<-EOT
    Minimum password length. The current Supabase flow enforces only >= 8
    (admin-create-user/index.ts). This defaults to 12 because every user has to
    set a new password during the migration anyway — see the plan's
    "Passwords cannot be migrated" section — so raising the floor costs nothing.
    Set to 8 to match current behaviour exactly.
  EOT
  type        = number
  default     = 12
}

variable "access_token_validity_minutes" {
  description = "Access token lifetime in minutes (5-1440). Supabase's default was 60."
  type        = number
  default     = 60
}

variable "id_token_validity_minutes" {
  description = "ID token lifetime in minutes (5-1440). The SPA sends this token to the API, so it governs how quickly a role or org change takes effect."
  type        = number
  default     = 60
}

variable "refresh_token_validity_days" {
  description = "Refresh token lifetime in days. 30 keeps users signed in for a month, roughly matching current Supabase behaviour."
  type        = number
  default     = 30
}

variable "mfa_configuration" {
  description = "OFF, OPTIONAL or ON. OPTIONAL enables TOTP without forcing it on the existing 7 users."
  type        = string
  default     = "OPTIONAL"

  validation {
    condition     = contains(["OFF", "OPTIONAL", "ON"], var.mfa_configuration)
    error_message = "mfa_configuration must be OFF, OPTIONAL or ON."
  }
}

variable "pre_token_generation_lambda_arn" {
  description = <<-EOT
    Optional ARN of a pre-token-generation Lambda. Leave null (the default) to
    use Cognito attributes as the authoritative source of org_id and role.

    Set it only if you decide claims should be resolved from RDS at token-issue
    time instead — that removes claim staleness but adds a database dependency to
    every sign-in. The trade-off is discussed in the plan under
    "Keeping claims and the database in step".
  EOT
  type        = string
  default     = null
}

variable "ses_source_arn" {
  description = <<-EOT
    Optional verified SES identity ARN for Cognito emails (invites, password
    resets). Leave null to use Cognito's built-in sender, which is capped at
    50 emails/day — fine for 7 users, not fine for production growth.
  EOT
  type        = string
  default     = null
}

variable "ses_from_email" {
  description = "From address for Cognito emails. Only used when ses_source_arn is set."
  type        = string
  default     = "no-reply@bidintel.rplusai.co.uk"
}

variable "deletion_protection" {
  description = "ACTIVE or INACTIVE. Keep ACTIVE — deleting a User Pool destroys every user irrecoverably."
  type        = string
  default     = "ACTIVE"
}

variable "allowed_origins" {
  description = <<-EOT
    Browser origins permitted to call the API. Consumed by the API Gateway CORS
    config and by PostgREST's server-cors-allowed-origins in a later phase.
    NOT a wildcard: the handlers currently return `*`, which must be narrowed to
    this list before production traffic (duplicate/permissive CORS is how a
    public API ends up readable from any site).
  EOT
  type        = list(string)
  default = [
    "https://bidintel-drab.vercel.app",
    "https://bidintel.rplusai.co.uk",
    "http://localhost:8080",
  ]
}
