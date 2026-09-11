# Phase 1 — Foundations
#
# Creates the things every later phase depends on:
#   * Terraform remote state (S3 bucket, with S3-native locking)
#   * Secrets Manager containers for the application secrets (NO values —
#     values are set out of band so they never enter Terraform state)
#   * SES domain identity + DKIM for transactional email
#
# CHICKEN-AND-EGG: this stack creates its own state backend, so the FIRST apply
# runs with local state. After that apply, uncomment the backend block below and
# run `terraform init -migrate-state` to move the local state into the bucket.
# Every later phase can use the S3 backend from the start.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Uncomment AFTER the first apply, then `terraform init -migrate-state`.
  #
  # use_lockfile = true is S3-NATIVE locking (Terraform >= 1.10). It writes a
  # .tflock object beside the state and uses S3 conditional writes, so no
  # DynamoDB table is needed. Requires bucket versioning, which is enabled below.
  backend "s3" {
    bucket       = "bidintel-tfstate-008041477140"
    key          = "phase1/terraform.tfstate"
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
      Component = "foundations"
      Phase     = "1"
      ManagedBy = "terraform"
    }
  }
}
