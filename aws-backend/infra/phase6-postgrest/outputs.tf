output "postgrest_url" {
  description = "Set VITE_POSTGREST_URL to this. HTTP - see the warning in versions.tf."
  value       = "http://${aws_lb.main.dns_name}"
}

output "alb_allowed_cidrs" {
  description = "The only IPs that can reach PostgREST."
  value       = var.admin_cidrs
}

output "cluster_name" { value = aws_ecs_cluster.main.name }
output "service_name" { value = aws_ecs_service.postgrest.name }
output "log_group" { value = aws_cloudwatch_log_group.postgrest.name }
