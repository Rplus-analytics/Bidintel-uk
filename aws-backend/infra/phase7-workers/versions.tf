# Phase 7 — the ingestion, backfill and embedding workers
#
# Nineteen functions, all VPC-attached, all on bidintel_app (BYPASSRLS) via
# bidintel/worker-db. They write rows for every organisation and are never
# reachable from the web tier, which is exactly why they must NOT share the
# bidintel_api credentials the user-facing functions use.
#
# EVERY SCHEDULE IS CREATED DISABLED. Enabling them is a separate, deliberate
# act (var.enable_schedules), because the first thing these do on a live
# schedule is write to the database that the app reads.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "bidintel-tfstate-008041477140"
    key          = "phase7-workers/terraform.tfstate"
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
      Component = "workers"
      Phase     = "7"
      ManagedBy = "terraform"
    }
  }
}
