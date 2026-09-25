#!/usr/bin/env bash
#
# Invoke each deployed worker ONCE, by hand, and report what it changed.
#
# Row counts are snapshotted immediately before and after each invocation, so a
# delta is attributable to that worker rather than to the batch. Workers run
# strictly one at a time for the same reason (and because this account's Lambda
# concurrency limit is 10).
#
#   ./scripts/invoke-workers.sh [worker ...]     # default: the safe set
#
# EXCLUDED BY DEFAULT and why:
#   backfill-linked-tables  gated behind an admin token; must stay manual
#   ingest-cf-bulk          downloads a multi-GB bulk file
#   backfill-raw-cf         long historical walk, not a smoke test
#   backfill-cf-bulk-tick   depends on cf_bulk_upload state
#   ingest-source-full      full-source re-walk

set -uo pipefail
cd "$(dirname "$0")/.."

PROFILE="${AWS_PROFILE:-bidintel-deploy}"
REGION="${AWS_REGION:-eu-north-1}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

DEFAULT=(
  ingest-cf-native ingest-contracts-scotland normalize-raw-cf
  scrape-ccs-digital-outcomes sync-notices ingest-trigger scrape-cf-notice
  backfill-status backfill-tick backfill-source-tick
  embed-tenders-batch generate-tender-embedding
)
TARGETS=("$@"); [ ${#TARGETS[@]} -eq 0 ] && TARGETS=("${DEFAULT[@]}")

TABLES="tenders notices raw_contracts_finder raw_cf_native raw_fts buyers tenders_fts tenders_pcs tenders_ccs award_suppliers awards suppliers"

snapshot() {
  local out=""
  for t in $TABLES; do
    out+="$t=$(psql -At -c "SELECT count(*) FROM $t;" 2>/dev/null || echo NA) "
  done
  echo "$out"
}

# EventBridge scheduled-event shape for the cron workers; API Gateway v2 proxy
# shape for the request-style ones. Sending the wrong one makes a worker read an
# empty body and no-op, which looks like success.
event_for() {
  case "$1" in
    backfill-status|ingest-trigger|scrape-cf-notice|generate-tender-embedding|embed-tenders-batch)
      echo '{"version":"2.0","requestContext":{"http":{"method":"POST"}},"body":"{}","isBase64Encoded":false}' ;;
    *)
      echo '{"version":"0","detail-type":"Scheduled Event","source":"aws.events","detail":{}}' ;;
  esac
}

printf '%-30s %8s %10s  %s\n' WORKER STATUS DURATION "ROW CHANGES"
printf '%s\n' "--------------------------------------------------------------------------------"

for fn in "${TARGETS[@]}"; do
  before=$(snapshot)
  event_for "$fn" > "$TMP/ev.json"
  start=$(date +%s)
  # --cli-read-timeout 0: the default 60s fires on the paced ingesters, and the
  # CLI then never writes the output file — so a naive harness reads the PREVIOUS
  # run's result and reports it as this one's. That happened, and two different
  # functions appeared to return identical figures.
  aws lambda invoke --region "$REGION" --profile "$PROFILE" \
    --cli-read-timeout 0 --cli-connect-timeout 0 \
    --function-name "bidintel-$fn" --cli-binary-format raw-in-base64-out \
    --payload "file://$TMP/ev.json" "$TMP/out.json" > "$TMP/meta.json" 2>"$TMP/err.txt"
  rc=$?
  dur=$(( $(date +%s) - start ))
  after=$(snapshot)

  if [ $rc -ne 0 ]; then
    printf '%-30s %8s %9ss  %s\n' "$fn" "INVOKE" "$dur" "$(head -c 120 "$TMP/err.txt" | tr '\n' ' ')"
    continue
  fi

  status="ok"
  if grep -q '"FunctionError"' "$TMP/meta.json" 2>/dev/null; then status="ERROR"; fi
  if python3 -c "import json,sys; d=json.load(open('$TMP/out.json')); sys.exit(0 if isinstance(d,dict) and 'errorMessage' in d else 1)" 2>/dev/null; then
    status="ERROR"
  fi

  delta=$(python3 - "$before" "$after" <<'PY'
import sys
b = dict(kv.split("=") for kv in sys.argv[1].split() if "=" in kv)
a = dict(kv.split("=") for kv in sys.argv[2].split() if "=" in kv)
out = []
for k in a:
    try:
        d = int(a[k]) - int(b.get(k, a[k]))
    except ValueError:
        continue
    if d: out.append(f"{k} {d:+d}")
print(", ".join(out) if out else "no row changes")
PY
)
  printf '%-30s %8s %9ss  %s\n' "$fn" "$status" "$dur" "$delta"

  # Anything the function itself reported, trimmed.
  python3 - "$TMP/out.json" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit()
if isinstance(d, dict) and "errorMessage" in d:
    print("      !", str(d["errorMessage"])[:200]); sys.exit()
body = d.get("body") if isinstance(d, dict) else None
if isinstance(body, str):
    try: body = json.loads(body)
    except Exception: pass
payload = body if body is not None else d
s = json.dumps(payload)
if len(s) > 200: s = s[:200] + "…"
print("      ->", s)
PY
done
