# ---------------------------------------------------------------------------
# Private subnets
# ---------------------------------------------------------------------------

resource "aws_subnet" "private" {
  for_each = var.private_subnets

  vpc_id            = var.vpc_id
  cidr_block        = each.value
  availability_zone = each.key

  # Explicitly private: no auto-assigned public IPs.
  map_public_ip_on_launch = false

  tags = { Name = "${var.name_prefix}-private-${each.key}" }
}

# ---------------------------------------------------------------------------
# Single NAT gateway
# ---------------------------------------------------------------------------
#
# One NAT, not one per AZ. At 7 users a NAT outage is a degraded ingestion run,
# not an outage of the product — the interactive path (API Gateway -> Lambda ->
# RDS) does not traverse it. Two NATs would double the $33.58/month for
# availability this workload does not need yet.
#
# NOTE: a single NAT is a single-AZ dependency. If eu-north-1a fails, the
# private subnet in 1b loses egress. Accepted deliberately.

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.name_prefix}-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = var.nat_public_subnet_id
  tags          = { Name = "${var.name_prefix}-nat" }
}

# ---------------------------------------------------------------------------
# Private routing
# ---------------------------------------------------------------------------

resource "aws_route_table" "private" {
  vpc_id = var.vpc_id
  tags   = { Name = "${var.name_prefix}-private" }
}

resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main.id
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# Free, and keeps S3 traffic off the NAT (where it would be billed per GB).
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  tags              = { Name = "${var.name_prefix}-s3" }
}

# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "lambda" {
  name        = "${var.name_prefix}-lambda"
  description = "VPC-attached Lambda functions. Egress only; no ingress."
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-lambda" }

  lifecycle {
    create_before_destroy = true
  }
}

# Lambdas initiate connections; nothing connects TO them. No ingress rules.
resource "aws_vpc_security_group_egress_rule" "lambda_all" {
  security_group_id = aws_security_group.lambda.id
  description       = "Outbound to RDS, Secrets Manager, and source APIs via NAT"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# The rule that matters: RDS accepts 5432 from the Lambda SECURITY GROUP, not
# from a CIDR. Referencing the SG means the permission follows the Lambdas
# wherever their ENIs land, and no IP range is ever trusted.
#
# This is an ADDITIVE rule on the existing SG. The single-IP rule for the
# owner's psql access (103.214.63.239/32) is managed outside Terraform and is
# left untouched.
resource "aws_vpc_security_group_ingress_rule" "rds_from_lambda" {
  security_group_id            = var.rds_security_group_id
  description                  = "PostgreSQL from bidintel-lambda SG only"
  referenced_security_group_id = aws_security_group.lambda.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
