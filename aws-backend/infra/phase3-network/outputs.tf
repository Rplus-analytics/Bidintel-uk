output "private_subnet_ids" {
  description = "Attach Lambdas to these. Order is stable (sorted by AZ)."
  value       = [for k in sort(keys(aws_subnet.private)) : aws_subnet.private[k].id]
}

output "lambda_security_group_id" {
  description = "Attach this SG to every VPC-attached Lambda."
  value       = aws_security_group.lambda.id
}

output "nat_gateway_id" { value = aws_nat_gateway.main.id }
output "nat_public_ip" {
  description = "Static egress IP for all VPC Lambda outbound traffic. Useful if a source API ever needs allowlisting."
  value       = aws_eip.nat.public_ip
}

output "lambda_vpc_config" {
  description = "Copy into aws lambda create-function --vpc-config."
  value       = "SubnetIds=${join(",", [for k in sort(keys(aws_subnet.private)) : aws_subnet.private[k].id])},SecurityGroupIds=${aws_security_group.lambda.id}"
}
