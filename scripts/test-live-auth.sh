#!/usr/bin/env bash
#
# Prove the NEW_PASSWORD_REQUIRED flow end to end against the real user pool,
# through the real frontend module, without touching anybody's account.
#
# Creates a throwaway user in FORCE_CHANGE_PASSWORD with a temporary password we
# generate, runs src/test/cognito-live.test.ts against it, and deletes the user
# whatever the outcome.
#
#   ./scripts/test-live-auth.sh
#
# Passwords are generated locally and never printed.
set -euo pipefail

cd "$(dirname "$0")/.."
POOL="${BIDINTEL_USER_POOL:-eu-north-1_9LKk8RR6t}"
PROFILE="${AWS_PROFILE:-bidintel-deploy}"
REGION="${AWS_REGION:-eu-north-1}"
USERNAME="livetest-$(date +%s)@bidintel.invalid"

aws_() { aws --region "$REGION" --profile "$PROFILE" "$@"; }

# Borrow a real org_id: custom:org_id has a MIN_LENGTH constraint, so a
# placeholder is rejected at creation.
ORG=$(aws_ cognito-idp describe-user-pool --user-pool-id "$POOL" \
  --query 'UserPool.Id' --output text >/dev/null && \
  aws_ cognito-idp list-users --user-pool-id "$POOL" --limit 1 \
  --query 'Users[0].Attributes[?Name==`custom:org_id`].Value|[0]' --output text)
[ -n "$ORG" ] && [ "$ORG" != "None" ] || { echo "could not read an org_id to clone" >&2; exit 1; }

TMP="Tmp-$(openssl rand -hex 10)A1"
NEW="New-$(openssl rand -hex 10)B2"

cleanup() {
  aws_ cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$USERNAME" >/dev/null 2>&1 || true
  echo "  throwaway user deleted"
}
trap cleanup EXIT

aws_ cognito-idp admin-create-user --user-pool-id "$POOL" --username "$USERNAME" \
  --message-action SUPPRESS --temporary-password "$TMP" \
  --user-attributes Name=email,Value="$USERNAME" Name=email_verified,Value=true \
      Name=custom:app_user_id,Value="00000000-0000-0000-0000-000000000001" \
      Name=custom:org_id,Value="$ORG" \
  --query 'User.UserStatus' --output text | sed 's/^/  created status: /'

BIDINTEL_LIVE_AUTH_USER="$USERNAME" \
BIDINTEL_LIVE_AUTH_PASSWORD="$TMP" \
BIDINTEL_LIVE_AUTH_NEWPASSWORD="$NEW" \
  npx vitest run src/test/cognito-live.test.ts
