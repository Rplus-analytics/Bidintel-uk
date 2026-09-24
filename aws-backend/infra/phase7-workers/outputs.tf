output "worker_names" { value = sort([for k, v in aws_lambda_function.fn : v.function_name]) }
output "schedules_enabled" { value = var.enable_schedules }
output "scheduled_workers" {
  value = { for k, v in aws_cloudwatch_event_rule.fn : k => "${v.schedule_expression} (${v.state})" }
}
