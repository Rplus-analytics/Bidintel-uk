#!/usr/bin/env bash
#
# Point the bidintel-1 security group at this machine's current public IP.
#
# The operator's ISP address is dynamic and has changed mid-task more than once,
# which breaks psql and any running load. This revokes whatever operator /32 is
# currently allowed and adds the current one, in one go, so rules never
# accumulate and there is only ever one operator address permitted.
#
# It deliberately leaves security-group *references* alone (the Lambda SG rule),
# touching only CIDR-based ingress rules.
#
#   ./scripts/allow-my-ip.sh [aws-profile]
#
set -euo pipefail

PROFILE="${1:-bidintel-deploy}"
REGION="${AWS_REGION:-eu-north-1}"
SG="${BIDINTEL_RDS_SG:-sg-0ee45efaf95f0dce1}"

# libpq/awscli on this machine need the Homebrew expat shim; harmless elsewhere.
[ -d /opt/homebrew/opt/expat/lib ] && export DYLD_LIBRARY_PATH="/opt/homebrew/opt/expat/lib:${DYLD_LIBRARY_PATH:-}"

MYIP=$(curl -s -m 10 https://checkip.amazonaws.com | tr -d '[:space:]')
if ! printf '%s' "$MYIP" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  echo "could not determine public IP (got: '$MYIP')" >&2; exit 1
fi

CURRENT=$(aws ec2 describe-security-group-rules --region "$REGION" --profile "$PROFILE" \
  --filters "Name=group-id,Values=$SG" \
  --query 'SecurityGroupRules[?!IsEgress && CidrIpv4!=`null`].[SecurityGroupRuleId,CidrIpv4]' --output text)

if printf '%s\n' "$CURRENT" | awk '{print $2}' | grep -qx "$MYIP/32"; then
  echo "already allowed: $MYIP/32"; exit 0
fi

# Revoke previous operator CIDR rules so they never pile up.
printf '%s\n' "$CURRENT" | while read -r rid cidr; do
  [ -z "${rid:-}" ] && continue
  aws ec2 revoke-security-group-ingress --region "$REGION" --profile "$PROFILE" \
    --group-id "$SG" --security-group-rule-ids "$rid" >/dev/null
  echo "revoked $cidr"
done

aws ec2 authorize-security-group-ingress --region "$REGION" --profile "$PROFILE" \
  --group-id "$SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,IpRanges=[{CidrIp=$MYIP/32,Description='operator machine (dynamic ISP)'}]" \
  --query 'SecurityGroupRules[0].SecurityGroupRuleId' --output text >/dev/null
echo "allowed $MYIP/32 on $SG"
