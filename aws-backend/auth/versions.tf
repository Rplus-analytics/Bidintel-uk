# Terraform + provider version pinning.
#
# Terraform was chosen over CDK for this stack for three reasons:
#   1. The User Pool is foundational — RDS, Lambda, API Gateway and EventBridge
#      stacks will all consume its ID/ARN. Terraform's remote state outputs make
#      that cross-stack reference explicit and readable.
#   2. CDK requires `cdk bootstrap` against the target account before anything
#      can be synthesised. Since no AWS credentials exist yet, Terraform lets the
#      whole stack be written and reviewed without touching the account.
#   3. aws_cognito_user_pool covers the full Cognito surface (resource servers,
#      token validity units, attribute-level client permissions) without the
#      escape hatches the CDK L2 constructs still need for some of it.
#
# Nothing here has been applied. See AUTH-MIGRATION-PLAN.md § "Before you apply".

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and fill in once an AWS account and state bucket exist. Local state
  # is fine for a first `plan`, but a User Pool is stateful, long-lived infra —
  # move to remote state before the first apply.
  #
  # backend "s3" {
  #   bucket         = "bidintel-tfstate"
  #   key            = "auth/terraform.tfstate"
  #   region         = "eu-north-1"
  #   encrypt        = true
  #   dynamodb_table = "bidintel-tfstate-lock"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "BidIntel"
      Component   = "auth"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}
