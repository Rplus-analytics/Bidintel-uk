# Values other stacks (API Gateway authorizer, Lambda env, the SPA build) consume.

output "user_pool_id" {
  description = "Cognito User Pool ID."
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "User Pool ARN. Needed by IAM policies for any Lambda calling the Cognito admin APIs."
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_endpoint" {
  description = "User Pool endpoint host."
  value       = aws_cognito_user_pool.main.endpoint
}

output "issuer_url" {
  description = "OIDC issuer. This is the `issuer` for the API Gateway JWT authorizer and replaces the Supabase issuer in src/lib/mcp/index.ts."
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "jwks_uri" {
  description = "JWKS endpoint used to verify token signatures in a Lambda authorizer."
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}/.well-known/jwks.json"
}

output "spa_client_id" {
  description = "App client ID for the React SPA. Becomes VITE_COGNITO_CLIENT_ID."
  value       = aws_cognito_user_pool_client.spa.id
}

output "hosted_ui_domain" {
  description = "Cognito hosted domain."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "oauth_authorize_endpoint" {
  description = "OAuth authorization endpoint for the MCP flow."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com/oauth2/authorize"
}

output "oauth_token_endpoint" {
  description = "OAuth token endpoint for the MCP flow."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com/oauth2/token"
}

output "api_scopes" {
  description = "Fully-qualified custom scopes for the BidIntel API."
  value       = [for s in ["tenders.read", "bids.read", "bids.write", "searches.read"] : "${var.api_identifier}/${s}"]
}

output "group_names" {
  description = "Role groups, mapping to the org_role enum."
  value = {
    admin  = aws_cognito_user_group.org_admin.name
    member = aws_cognito_user_group.org_member.name
  }
}

output "frontend_env" {
  description = "Copy-paste block for the SPA's .env — see AUTH-MIGRATION-PLAN.md § Frontend changes."
  value = <<-EOT
    VITE_COGNITO_USER_POOL_ID=${aws_cognito_user_pool.main.id}
    VITE_COGNITO_CLIENT_ID=${aws_cognito_user_pool_client.spa.id}
    VITE_COGNITO_REGION=${var.aws_region}
    VITE_COGNITO_DOMAIN=${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com
  EOT
}
