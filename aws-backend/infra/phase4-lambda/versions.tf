# Phase 4 — the five launch Lambda functions (stack "F")
#
# Deploys the interactive path only. The ingestion/backfill workers are NOT here:
# they still need `_shared/db.ts` implemented (see docs/DEPLOYMENT-STATUS.md,
# "Required before cutover").
#
# Two tiers, deliberately different:
#
#   IN THE VPC     semantic-search, buyer-profile
#                  Private subnets, bidintel-lambda SG, egress via the NAT.
#                  semantic-search must reach RDS; buyer-profile is placed
#                  alongside it so every function holding an AI key shares one
#                  known egress IP (13.51.139.129) rather than AWS's public
#                  Lambda ranges.
#
#   OUTSIDE        contracts-finder, contracts-scotland, find-a-tender
#                  Pure upstream proxies with no database and no secrets.
#                  Keeping them out of the VPC avoids an ENI cold start and
#                  keeps their (chatty, multi-MB) upstream responses off the
#                  NAT, where every gigabyte is billed.
#
# SECRETS: Terraform sets only ARNs. No secret VALUE appears in this stack, in
# state, or in a function's environment - see functions/_shared/secret-env.ts.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "bidintel-tfstate-008041477140"
    key          = "phase4-lambda/terraform.tfstate"
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
      Component = "lambda"
      Phase     = "4"
      ManagedBy = "terraform"
    }
  }
}
