output "postgrest_url" {
  description = "Set VITE_POSTGREST_URL to this."
  value       = var.enable_https ? "https://${var.api_domain}" : "http://${aws_lb.main.dns_name}"
}

output "alb_dns_name" {
  description = "CNAME target for the api hostname."
  value       = aws_lb.main.dns_name
}

output "acm_certificate_status" {
  value = aws_acm_certificate.api.status
}

output "dns_records_for_cloudflare" {
  description = "Add these in Cloudflare. BOTH must be DNS only (grey cloud) - see docs/DEPLOYMENT-STATUS.md."
  value = concat(
    [for o in aws_acm_certificate.api.domain_validation_options :
      "VALIDATION  CNAME  ${o.resource_record_name}  ->  ${o.resource_record_value}  [DNS only]"
    ],
    ["ENDPOINT    CNAME  ${var.api_domain}  ->  ${aws_lb.main.dns_name}  [DNS only]"],
  )
}

output "alb_allowlist_note" {
  description = "Who may reach the ALB is managed by scripts/allow-ip.sh, not by Terraform. Run `scripts/allow-ip.sh --list` to see the current allowlist."
  value       = "managed out of band: scripts/allow-ip.sh <label> [ip]"
}

output "cluster_name" { value = aws_ecs_cluster.main.name }
output "service_name" { value = aws_ecs_service.postgrest.name }
output "log_group" { value = aws_cloudwatch_log_group.postgrest.name }

output "acm_certificate_arn" {
  value = aws_acm_certificate.api.arn
}
