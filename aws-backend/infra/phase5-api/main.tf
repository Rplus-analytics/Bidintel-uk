data "terraform_remote_state" "lambda" {
  backend = "s3"
  config = {
    bucket = "bidintel-tfstate-008041477140"
    key    = "phase4-lambda/terraform.tfstate"
    region = "eu-north-1"
  }
}

locals {
  # Route path == function name, so the frontend's existing
  # `invoke("semantic-search")` becomes `POST ${API}/semantic-search` with no
  # per-function mapping table to keep in sync.
  routes = data.terraform_remote_state.lambda.outputs.function_names
}

# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.name_prefix}-api"
  description   = "BidIntel edge functions. Every route requires a Cognito ID token."
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_allow_origins
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type", "x-client-info", "apikey"]

    # False on purpose. The app sends the token in an Authorization header, not
    # a cookie, so credentialed CORS is unnecessary — and enabling it would
    # widen what a malicious page could do with an authenticated browser.
    allow_credentials = false

    # Cache the preflight for 5 minutes. Longer would make a CORS change slow to
    # take effect during testing.
    max_age = 300
  }
}

# ---------------------------------------------------------------------------
# Cognito JWT authorizer
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "${var.name_prefix}-cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.cognito_issuer
    audience = [var.cognito_audience]
  }
}

# ---------------------------------------------------------------------------
# Integrations + routes
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "fn" {
  for_each = local.routes

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = data.terraform_remote_state.lambda.outputs.function_arns[each.key]
  payload_format_version = "2.0"

  # Below every function's own timeout, so a hung upstream surfaces as a clean
  # 504 from the gateway rather than a dangling browser request.
  timeout_milliseconds = 29000
}

resource "aws_apigatewayv2_route" "fn" {
  for_each = local.routes

  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /${each.key}"
  target    = "integrations/${aws_apigatewayv2_integration.fn[each.key].id}"

  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# No OPTIONS routes: with CORS configured on the API, API Gateway answers
# preflight itself, before authorization, and never invokes a function. Adding
# explicit OPTIONS routes would shadow that and require them to be public.
#
# No $default route either. An unmatched path must 404 at the edge.

# ---------------------------------------------------------------------------
# Permission for API Gateway to invoke each function
# ---------------------------------------------------------------------------
#
# source_arn is pinned to the exact method and path. A blanket
# "${execution_arn}/*/*" would let any route on this API invoke any function.

resource "aws_lambda_permission" "apigw" {
  for_each = local.routes

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = each.value
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/POST/${each.key}"
}

# ---------------------------------------------------------------------------
# Stage + access logs
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name_prefix}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn

    # Includes the authorizer error so a rejected token can be told apart from a
    # failing function. Deliberately does NOT log the Authorization header.
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      requestTime      = "$context.requestTime"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      integrationError = "$context.integrationErrorMessage"
      authorizerError  = "$context.authorizer.error"
      responseLatency  = "$context.responseLatency"
      sub              = "$context.authorizer.claims.sub"
    })
  }

  default_route_settings {
    # A runaway client should hit a 429 here rather than exhausting Lambda
    # concurrency or the database connection pool.
    throttling_rate_limit  = 50
    throttling_burst_limit = 100
  }
}
