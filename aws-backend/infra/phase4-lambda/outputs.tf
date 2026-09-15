output "function_arns" {
  description = "Invoke ARNs for the API Gateway integrations in phase 5."
  value       = { for k, v in aws_lambda_function.fn : k => v.arn }
}

output "function_names" {
  value = { for k, v in aws_lambda_function.fn : k => v.function_name }
}

output "role_arns" {
  value = { for k, v in aws_iam_role.fn : k => v.arn }
}

output "vpc_attached" {
  description = "Which functions sit in the private subnets. The rest have default internet access and no database reachability."
  value       = [for k, v in local.functions : k if v.vpc]
}
