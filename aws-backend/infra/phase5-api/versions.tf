# Phase 5 — HTTP API in front of the launch Lambdas (stack "G")
#
# One HTTP API (not REST): ~70% cheaper per million requests, native JWT
# authorizers, and built-in CORS. The features REST APIs have that HTTP APIs do
# not — request validation, usage plans, WAF — are not used here.
#
# EVERY route carries the Cognito JWT authorizer. There is no public route and
# no fallback $default route, so an unmatched path is a 404 from API Gateway
# rather than something that reaches a function.
#
# The authorizer validates:
#   issuer   the Cognito user pool  -> a token from any other pool is rejected
#   audience the SPA client ID      -> a token minted for a different client of
#                                      the SAME pool is also rejected
#
# The audience check is the half people skip. Without it, any client registered
# against this pool could call this API.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "bidintel-tfstate-008041477140"
    key          = "phase5-api/terraform.tfstate"
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
      Component = "api"
      Phase     = "5"
      ManagedBy = "terraform"
    }
  }
}
