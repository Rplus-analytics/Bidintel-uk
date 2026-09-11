#!/usr/bin/env bash
# Replays the 90 migrations in filename order into database `bidintel`.
#
# WHY REPLAY rather than hand-author a schema: the migrations already ARE
# correct DDL for the app tables, including constraints, triggers and RLS.
# Hand-authoring would diverge immediately and make the later reconciliation
# against Lovable's live definitions meaningless. Replay keeps them as the
# source of truth so that reconciliation is a genuine diff.
#
# Requires PGPASSWORD in the environment. Never writes the password anywhere.
set -uo pipefail

H="${PGHOST:-bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com}"
DB="${PGDATABASE:-bidintel}"
U="${PGUSER:-postgres}"
MIG="$(cd "$(dirname "$0")/../../supabase/migrations" && pwd)"
LOG="$(dirname "$0")/replay.log"

: > "$LOG"
ok=0; failed=0

# ON_ERROR_STOP is deliberately OFF: replaying a migration history against a
# fresh database produces expected, harmless failures (a later migration DROPs
# a policy an earlier one created, IF NOT EXISTS guards, re-CREATEs). Stopping
# on the first one would halt a schema that is otherwise building correctly.
# Every error is logged and summarised instead, and 04-verify.sql is the real
# gate on whether the result is correct.
for f in "$MIG"/*.sql; do
  out=$(psql -h "$H" -U "$U" -d "$DB" -v ON_ERROR_STOP=0 -q -f "$f" 2>&1)
  if [ -n "$out" ]; then
    printf '### %s\n%s\n' "$(basename "$f")" "$out" >> "$LOG"
    failed=$((failed+1))
  else
    ok=$((ok+1))
  fi
done

echo "  migrations applied clean : $ok"
echo "  migrations with output   : $failed  (see $(basename "$LOG"))"
echo "  distinct error classes:"
grep -oE 'ERROR:  [^"]*' "$LOG" 2>/dev/null | sed 's/ERROR:  //' | cut -c1-60 | sort | uniq -c | sort -rn | head -15 | sed 's/^/    /'
