#!/usr/bin/env bash
#
# Allow one named person's current public IP through BOTH security groups that
# gate the test stack:
#
#   bidintel-1 RDS SG        tcp/5432   direct psql
#   bidintel-postgrest-alb   tcp/80     the PostgREST ALB the app talks to
#
#   ./scripts/allow-ip.sh <label> [ip]      # ip defaults to this machine's
#   ./scripts/allow-ip.sh rajesh 203.0.113.7
#   ./scripts/allow-ip.sh --list
#   ./scripts/allow-ip.sh --revoke <label>
#
# WHY THIS REPLACES allow-my-ip.sh: that script revoked EVERY CIDR ingress rule
# before adding its own, which was right when there was exactly one operator and
# is wrong the moment a second tester exists — running it would silently cut the
# other person off. Rules here are tagged in their Description with
#
#     bidintel-access:<label>
#
# and only rules carrying the SAME label are revoked, so each person's entry is
# updated independently and nobody else is disturbed.
#
# Security-group REFERENCES (the Lambda SG -> RDS rule, the ALB SG -> task rule)
# are never touched: this only ever considers CIDR-based rules.
#
# NOTE: the ALB is plain HTTP and carries Cognito ID tokens in cleartext, which
# is the only reason this allowlist has to be this tight. See
# docs/DEPLOYMENT-STATUS.md.

set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-bidintel-deploy}"
REGION="${AWS_REGION:-eu-north-1}"
RDS_SG="${BIDINTEL_RDS_SG:-sg-0ee45efaf95f0dce1}"

# libpq/awscli on macOS here need the Homebrew expat shim; harmless elsewhere.
[ -d /opt/homebrew/opt/expat/lib ] && export DYLD_LIBRARY_PATH="/opt/homebrew/opt/expat/lib:${DYLD_LIBRARY_PATH:-}"

aws_() { aws --region "$REGION" --profile "$PROFILE" "$@"; }

alb_sg() {
  aws_ ec2 describe-security-groups \
    --filters "Name=group-name,Values=bidintel-postgrest-alb" \
    --query 'SecurityGroups[0].GroupId' --output text
}

# All CIDR ingress rules on a SG, as: <rule-id> <cidr> <port> <description>
rules_on() {
  aws_ ec2 describe-security-group-rules --filters "Name=group-id,Values=$1" \
    --query 'SecurityGroupRules[?!IsEgress && CidrIpv4!=`null`].[SecurityGroupRuleId,CidrIpv4,FromPort,Description]' \
    --output text
}

case "${1:-}" in
  --list)
    for sg in "$RDS_SG" "$(alb_sg)"; do
      echo "== $sg"
      rules_on "$sg" | sed 's/^/   /'
    done
    exit 0
    ;;
  --revoke)
    LABEL="${2:?usage: --revoke <label>}"
    for sg in "$RDS_SG" "$(alb_sg)"; do
      rules_on "$sg" | while read -r rid cidr port desc; do
        case "$desc" in
          *"bidintel-access:$LABEL"*)
            aws_ ec2 revoke-security-group-ingress --group-id "$sg" --security-group-rule-ids "$rid" >/dev/null
            echo "revoked $cidr:$port from $sg"
            ;;
        esac
      done
    done
    exit 0
    ;;
  "" )
    echo "usage: $0 <label> [ip] | --list | --revoke <label>" >&2; exit 1 ;;
esac

LABEL="$1"
IP="${2:-}"
if [ -z "$IP" ]; then
  IP=$(curl -s -m 10 https://checkip.amazonaws.com | tr -d '[:space:]')
fi
printf '%s' "$IP" | grep -qE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || {
  echo "not a valid IPv4 address: '$IP'" >&2; exit 1; }

ALB_SG=$(alb_sg)
[ "$ALB_SG" != "None" ] || { echo "could not find bidintel-postgrest-alb" >&2; exit 1; }

DESC="bidintel-access:$LABEL"

# Does this rule belong to the person we are updating?
#
# Labelled rules match on the label. In addition, when the label is "operator",
# any CIDR rule with NO label is adopted: the original allow-my-ip.sh wrote
# free-text descriptions ("operator machine (dynamic) - replace with SSM"), and
# matching those by string would mean hard-coding whatever text happened to be
# used. Adopting unlabelled rules normalises them on first run instead.
belongs_to_label() { # $1=description
  case "${1:-}" in
    *"bidintel-access:$LABEL"*) return 0 ;;
    *"bidintel-access:"*)       return 1 ;;  # someone else's — never touch
    *) [ "$LABEL" = "operator" ] && return 0 || return 1 ;;
  esac
}

allow() { # $1=sg $2=port $3=what
  local sg="$1" port="$2" what="$3" satisfied="" stale=()

  while read -r rid cidr rport desc; do
    [ -z "${rid:-}" ] && continue
    belongs_to_label "${desc:-}" || continue
    if [ "$cidr" = "$IP/32" ] && [ "$rport" = "$port" ] && [ "${desc:-}" = "$DESC" ]; then
      satisfied=1
    else
      # Wrong IP, wrong port, or an unlabelled legacy rule to be normalised.
      stale+=("$rid:$cidr:$rport")
    fi
  done < <(rules_on "$sg")

  if [ -n "$satisfied" ] && [ ${#stale[@]} -eq 0 ]; then
    echo "  already allowed $IP/32:$port ($what)"
    return
  fi

  for entry in ${stale[@]+"${stale[@]}"}; do
    local rid="${entry%%:*}" rest="${entry#*:}"
    aws_ ec2 revoke-security-group-ingress --group-id "$sg" --security-group-rule-ids "$rid" >/dev/null
    echo "  revoked ${rest/:/ port } ($what)"
  done

  if [ -n "$satisfied" ]; then
    echo "  allowed $IP/32:$port ($what)"
    return
  fi

  aws_ ec2 authorize-security-group-ingress --group-id "$sg" \
    --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$IP/32,Description='$DESC'}]" \
    >/dev/null
  echo "  allowed $IP/32:$port ($what)"
}

echo "$LABEL -> $IP"
allow "$RDS_SG" 5432 "RDS, direct psql"
allow "$ALB_SG" 80   "PostgREST ALB"
