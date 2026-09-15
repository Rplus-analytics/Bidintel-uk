# Phase 6 — PostgREST on Fargate behind an HTTP ALB (stack "H")
#
# This is the supabase-js `.from()` compatibility layer. PostgREST IS what
# Supabase runs; pointing the existing client at our own instance is what lets
# every `.from(...).select(...).eq(...)` in the app stay byte-identical.
#
# ############################################################################
# # HTTP, NOT HTTPS. Cognito ID tokens cross this listener IN CLEARTEXT.     #
# #                                                                          #
# # Acceptable ONLY because: the listener is reachable from a small list of  #
# # named IPs (var.admin_cidrs), and the only client is a developer machine  #
# # on http://localhost:8080. Anyone on the network path between that        #
# # machine and the ALB can capture a token and replay it for its 60-minute  #
# # lifetime.                                                                #
# #                                                                          #
# # MUST be replaced with HTTPS before cutover. ACM cannot issue for         #
# # bidintel-drab.vercel.app, so this needs a controlled domain - the open   #
# # "production hosting + HTTPS decision" owned by Karan.                    #
# ############################################################################

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket       = "bidintel-tfstate-008041477140"
    key          = "phase6-postgrest/terraform.tfstate"
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
      Component = "postgrest"
      Phase     = "6"
      ManagedBy = "terraform"
    }
  }
}
