#!/usr/bin/env bash
# Bundle one (or all) Lambda functions into a deployable zip.
#
#   ./scripts/build-lambda.sh semantic-search buyer-profile
#   ./scripts/build-lambda.sh                 # every function listed in LAUNCH
#
# esbuild, not `tsc` + `zip dist`: the functions import `pg` and the AWS SDK, and
# a zip of `dist/` alone contains none of that. Bundling to ONE file also removes
# any question of which node_modules layout the runtime sees.
#
# The zip is built with a FIXED timestamp so identical source produces a
# byte-identical artefact. Without that, `zip` stamps the current time into every
# entry, the SHA changes on every build, and Terraform redeploys all five
# functions whenever any one of them is touched.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/build"
mkdir -p "$OUT"

LAUNCH=(
  # user-facing
  semantic-search buyer-profile contracts-finder contracts-scotland find-a-tender
  # ingestion
  ingest-cf ingest-fts ingest-cf-native ingest-contracts-scotland ingest-cf-bulk
  ingest-source-full ingest-trigger sync-notices normalize-raw-cf
  scrape-cf-notice scrape-ccs-digital-outcomes
  # backfill
  backfill-tick backfill-source-tick backfill-status backfill-raw-cf
  backfill-cf-bulk-tick backfill-linked-tables
  # embedding
  embed-tenders-batch generate-tender-embedding
)
TARGETS=("${@:-}")
[ -z "${1:-}" ] && TARGETS=("${LAUNCH[@]}")

for fn in "${TARGETS[@]}"; do
  src="$ROOT/functions/$fn/index.ts"
  [ -f "$src" ] || { echo "no such function: $fn" >&2; exit 1; }

  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT

  # --packages=bundle: pull `pg` and the AWS SDK into the output. The Node 20
  # runtime ships its own @aws-sdk, but bundling pins the version we tested
  # rather than inheriting whatever AWS rolls out.
  "$ROOT/node_modules/.bin/esbuild" "$src" \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=cjs \
    --outfile="$work/index.js" \
    --log-level=warning

  # Fixed mtime -> reproducible zip. 2020-01-01 is arbitrary but stable.
  TZ=UTC touch -t 202001010000.00 "$work/index.js"
  ( cd "$work" && zip -qrX -D "$OUT/$fn.zip" index.js )

  size=$(( $(wc -c < "$OUT/$fn.zip") / 1024 ))
  printf '  %-20s %5s KB  sha256=%s\n' "$fn" "$size" \
    "$(openssl dgst -sha256 -binary "$OUT/$fn.zip" | openssl base64 -A)"

  rm -rf "$work"
  trap - EXIT
done
