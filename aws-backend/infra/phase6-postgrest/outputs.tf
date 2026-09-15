output "postgrest_url" {
  description = "Set VITE_POSTGREST_URL to this. HTTP - see the warning in versions.tf."
  value       = "http://${aws_lb.main.dns_name}"
}

output "alb_allowlist_note" {
  description = "Who may reach the ALB is managed by scripts/allow-ip.sh, not by Terraform. Run `scripts/allow-ip.sh --list` to see the current allowlist."
  value       = "managed out of band: scripts/allow-ip.sh <label> [ip]"
}

output "cluster_name" { value = aws_ecs_cluster.main.name }
output "service_name" { value = aws_ecs_service.postgrest.name }
output "log_group" { value = aws_cloudwatch_log_group.postgrest.name }
