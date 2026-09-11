# ============================================================================
# Cognito User Pool — replacement for Supabase Auth
# ============================================================================
#
# Maps the current Postgres identity model onto Cognito:
#
#   auth.users                  -> Cognito user (sub)
#   profiles.id                 -> custom:app_user_id  (preserves existing FKs)
#   profiles.email              -> email (username attribute)
#   profiles.display_name       -> name
#   memberships.organisation_id -> custom:org_id
#   memberships.role            -> group membership (org_admin | org_member)
#
# memberships.user_id is the PRIMARY KEY, so a user belongs to exactly one
# organisation. That is what makes a single custom:org_id attribute sufficient.
# If multi-org is ever needed, see the plan's "If one org per user stops being
# true" section — it changes this design materially.
#
# !! SCHEMA IS IMMUTABLE !!
# Cognito custom attributes cannot be added, removed or altered after the pool
# is created. Terraform will plan a full replacement — destroying every user — if
# the schema blocks below change. Settle the attribute set before the first apply.

resource "aws_cognito_user_pool" "main" {
  name = "${var.name_prefix}-${var.environment}"

  # Email is the login identifier, matching the current sign-in form.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  deletion_protection = var.deletion_protection

  # ---------------------------------------------------------------------------
  # Provisioning model: admin-only.
  # The Auth page states "New organisations and users are provisioned by the
  # platform administrator" and offers no sign-up form; admin-create-user is the
  # only path to a new user. allow_admin_create_user_only enforces that in
  # Cognito itself rather than relying on the absence of UI.
  # ---------------------------------------------------------------------------
  admin_create_user_config {
    allow_admin_create_user_only = true

    invite_message_template {
      email_subject = "Your BidIntel account"
      email_message = "Your BidIntel account is ready. Username: {username} Temporary password: {####} Sign in at https://bidintel.rplusai.co.uk and you will be asked to choose a new password."
      sms_message   = "BidIntel username: {username} temporary password: {####}"
    }
  }

  password_policy {
    minimum_length                   = var.password_minimum_length
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  mfa_configuration = var.mfa_configuration

  # Required whenever MFA is OPTIONAL or ON. TOTP only — no SMS, which avoids
  # SNS spend limits and the SMS sandbox entirely.
  dynamic "software_token_mfa_configuration" {
    for_each = var.mfa_configuration == "OFF" ? [] : [1]
    content {
      enabled = true
    }
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  dynamic "email_configuration" {
    for_each = var.ses_source_arn == null ? [] : [1]
    content {
      email_sending_account  = "DEVELOPER"
      source_arn             = var.ses_source_arn
      from_email_address     = var.ses_from_email
      reply_to_email_address = var.ses_from_email
    }
  }

  # V1 trigger: customises the ID TOKEN, which works on every feature plan.
  # V2 (access-token customisation) would require Essentials or Plus.
  lambda_config {
    pre_token_generation = aws_lambda_function.pre_token_generation.arn
  }

  # --- Standard attributes ---------------------------------------------------

  schema {
    name                     = "email"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = true
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # profiles.display_name
  schema {
    name                     = "name"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 0
      max_length = 256
    }
  }

  # --- Custom attributes -----------------------------------------------------

  # memberships.organisation_id. Mutable because admins move users between orgs.
  # The SPA client cannot write it (see write_attributes on the client below) —
  # that restriction is what stops a user granting themselves another org's data.
  schema {
    name                     = "org_id"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 36
      max_length = 36
    }
  }

  # profiles.id — the application's own user UUID.
  #
  # Cognito assigns its own `sub` and it cannot be set on import, so without this
  # the existing profiles/memberships/saved_bids.saved_by foreign keys would all
  # have to be re-pointed. Carrying the original UUID as a claim keeps those rows
  # untouched and means the authorizer needs no database lookup to resolve
  # "who is this" — see the plan's "Identity mapping" section.
  schema {
    name                     = "app_user_id"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false
    developer_only_attribute = false

    string_attribute_constraints {
      min_length = 36
      max_length = 36
    }
  }

  lifecycle {
    # Guards against an accidental `terraform destroy` taking every user with it.
    prevent_destroy = true
  }
}

# ============================================================================
# Groups — the org_role enum ('admin' | 'member')
# ============================================================================
#
# Group membership arrives in both the ID and access tokens as the
# `cognito:groups` claim, so role checks work against either token.
#
# These are pool-global role groups, not per-organisation groups. That is
# correct while one-org-per-user holds: the pair (custom:org_id, cognito:groups)
# fully determines "which org" and "what role". Per-org groups would be needed
# only for multi-org membership.

resource "aws_cognito_user_group" "org_admin" {
  name         = "org_admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Organisation administrator. Equivalent to memberships.role = 'admin' and satisfies the is_org_admin() checks."
  precedence   = 1
}

resource "aws_cognito_user_group" "org_member" {
  name         = "org_member"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Standard organisation member. Equivalent to memberships.role = 'member'."
  precedence   = 10
}

# ============================================================================
# Resource server — OAuth scopes for the MCP server
# ============================================================================
#
# Mirrors the five tools the MCP server exposes. Kept even though the MCP client
# is not created at launch: a resource server is independent of its consumers,
# costs nothing, and having the scopes defined up front means adding the MCP
# client later is a one-resource change.

resource "aws_cognito_resource_server" "api" {
  identifier   = var.api_identifier
  name         = "${var.name_prefix}-api"
  user_pool_id = aws_cognito_user_pool.main.id

  scope {
    scope_name        = "tenders.read"
    scope_description = "Read tender and award data scoped to the caller's organisation"
  }

  scope {
    scope_name        = "bids.read"
    scope_description = "Read the organisation's saved bids"
  }

  scope {
    scope_name        = "bids.write"
    scope_description = "Create and update the organisation's saved bids"
  }

  scope {
    scope_name        = "searches.read"
    scope_description = "Read the organisation's saved searches"
  }
}

# ============================================================================
# App client — the React SPA
# ============================================================================

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.name_prefix}-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  # Public client: a browser cannot keep a secret.
  generate_secret = false

  # SRP rather than USER_PASSWORD_AUTH: the password is never sent over the wire,
  # and it is what the Amplify sign-in helper uses by default.
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = var.access_token_validity_minutes
  id_token_validity      = var.id_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Returns a generic failure for both "wrong password" and "no such user",
  # so the endpoint cannot be used to enumerate accounts.
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  auth_session_validity         = 3

  # ---------------------------------------------------------------------------
  # Attribute permissions — the load-bearing security control here.
  #
  # read_attributes lets the SPA see its own org and role. write_attributes
  # deliberately OMITS custom:org_id and custom:app_user_id: a user calling
  # updateUserAttributes cannot move themselves into another organisation or
  # impersonate another application user. Only admin-side calls
  # (AdminUpdateUserAttributes, which is IAM-gated) can set them.
  #
  # Removing that asymmetry silently converts the whole tenancy model into an
  # honour system.
  # ---------------------------------------------------------------------------
  read_attributes = [
    "email",
    "email_verified",
    "name",
    "custom:org_id",
    "custom:app_user_id",
  ]

  write_attributes = [
    "email",
    "name",
  ]

  supported_identity_providers = ["COGNITO"]

  # Hosted-UI settings. The like-for-like port of the current sign-in form uses
  # the SRP API directly and never touches these, but they are configured so the
  # hosted UI is available for password reset and future SSO without a redeploy.
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.spa_callback_urls
  logout_urls                          = var.spa_logout_urls
}

# ============================================================================
# App client — the MCP server: NOT CREATED AT LAUNCH
# ============================================================================
#
# Dropped deliberately. The `mcp` edge function is one of the five not yet
# ported, and nothing in the launch scope (login, tender search, buyer/supplier
# pages, saved bids) uses it. Re-add when the MCP server is ported; the resource
# server below already carries the scopes it will need.
#
# Note Cognito has no RFC 7591 dynamic client registration, so when it is added
# every MCP client's redirect URI must be pre-registered — see
# aws-backend/auth/AUTH-MIGRATION-PLAN.md § "MCP and OAuth".

# ============================================================================
# Hosted domain
# ============================================================================
#
# Provides /oauth2/authorize, /oauth2/token, /oauth2/userInfo and the hosted
# sign-in page. Required for the MCP authorization-code flow.

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}
