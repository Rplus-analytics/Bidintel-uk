variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "name_prefix" {
  type    = string
  default = "bidintel"
}

variable "vpc_id" {
  description = "The default VPC that bidintel-1 already lives in."
  type        = string
  default     = "vpc-0b343e728bc5e8eb1"
}

variable "rds_security_group_id" {
  description = "bidintel-1's security group. This stack ADDS one ingress rule to it and changes nothing else."
  type        = string
  default     = "sg-0ee45efaf95f0dce1"
}

variable "nat_public_subnet_id" {
  description = "Existing PUBLIC subnet to place the NAT gateway in (eu-north-1a)."
  type        = string
  default     = "subnet-06cc022f95f6c3cbc"
}

variable "private_subnets" {
  description = <<-EOT
    Private subnet CIDRs per AZ. Chosen well clear of the default VPC's existing
    /20s (172.31.0.0, 172.31.16.0, 172.31.32.0) and clear of the 48/64/80 range
    AWS would use if further default subnets ever appear.
  EOT
  type        = map(string)
  default = {
    "eu-north-1a" = "172.31.200.0/22"
    "eu-north-1b" = "172.31.204.0/22"
  }
}
