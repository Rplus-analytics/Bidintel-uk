# Phase 3 — Lambda-to-RDS networking (stack "D")
#
# bidintel-1 sits in the DEFAULT VPC (vpc-0b343e728bc5e8eb1, 172.31.0.0/16) with
# three PUBLIC subnets. This stack adds the private side that VPC-attached
# Lambdas need, without moving the database (deferred: private RDS rebuild).
#
#   * two private subnets (eu-north-1a, eu-north-1b)
#   * ONE NAT gateway — VPC attachment removes default internet access, and the
#     ingestion functions must still reach gov.uk / CKAN / TED, plus Secrets
#     Manager and the AI gateway
#   * a Lambda security group, and an ingress rule on the RDS SG that accepts
#     5432 from THAT SECURITY GROUP ONLY
#   * a free S3 gateway endpoint
#
# Interface endpoints for Secrets Manager / Logs are deliberately NOT created:
# the NAT already provides that reachability, and each endpoint would add
# $7.67/month per AZ for no functional gain while a NAT exists.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "bidintel-tfstate-008041477140"
    key          = "phase3-network/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project   = "BidIntel"
      Component = "network"
      Phase     = "3"
      ManagedBy = "terraform"
    }
  }
}
