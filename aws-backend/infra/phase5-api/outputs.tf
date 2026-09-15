output "api_base_url" {
  description = "Set VITE_API_BASE_URL to this."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "routes" {
  description = "Every route. All are POST and all require a Cognito ID token."
  value       = sort([for k, v in aws_apigatewayv2_route.fn : v.route_key])
}

output "api_id" { value = aws_apigatewayv2_api.main.id }

output "cors_allowed_origins" { value = var.cors_allow_origins }
