# ---------------------------------------------------------------------------
# Pre-token-generation trigger (V1 — ID token)
# ---------------------------------------------------------------------------
#
# Emits the `role` claim PostgREST needs, plus the user's existing profiles.id
# UUID as `app_user_id` so auth.uid() keeps returning the same value it did on
# Lovable Cloud. See pre-token-generation/index.mjs for why V1 rather than V2.

data "archive_file" "pre_token_generation" {
  type        = "zip"
  source_file = "${path.module}/pre-token-generation/index.mjs"
  output_path = "${path.module}/.build/pre-token-generation.zip"
}

resource "aws_iam_role" "pre_token_generation" {
  name = "${var.name_prefix}-pre-token-generation"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# CloudWatch Logs only. This function reads nothing and writes nothing.
resource "aws_iam_role_policy_attachment" "pre_token_generation_basic" {
  role       = aws_iam_role.pre_token_generation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "pre_token_generation" {
  function_name = "${var.name_prefix}-pre-token-generation"
  role          = aws_iam_role.pre_token_generation.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename         = data.archive_file.pre_token_generation.output_path
  source_code_hash = data.archive_file.pre_token_generation.output_base64sha256

  # Runs on the sign-in critical path. Cognito's own timeout for this trigger is
  # 5s; anything slower fails the login outright.
  timeout     = 5
  memory_size = 128

  # NOT VPC-attached: it needs no database and no private resource, so keeping
  # it outside the VPC avoids cold-start ENI attachment on the login path.
}

resource "aws_lambda_permission" "cognito_invoke" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_token_generation.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
