#!/usr/bin/env bash
# Streams the Lovable app export into `bidintel`. No local unzip; nothing is
# written to disk. Prints counts and errors only — never row data.
#
# Requires PGPASSWORD in the environment.
set -uo pipefail
H="${PGHOST:-bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com}"
DB=bidintel; U=postgres
EXP="$HOME/bidintel-export/app"

# table:zip:target  — FK order, tenders and notices last
ORDER="
auth_users:auth_users.zip:auth.users
organisations:organisations.zip:public.organisations
profiles:profiles.zip:public.profiles
memberships:memberships.zip:public.memberships
org_match_profiles:org_match_profiles.zip:public.org_match_profiles
org_name_aliases:org_name_aliases.zip:public.org_name_aliases
cpv_codes:cpv_codes.zip:public.cpv_codes
buyers:buyers.zip:public.buyers
suppliers:suppliers.zip:public.suppliers
companies:companies.zip:public.companies
user_actions:user_actions.zip:public.user_actions
backfill_state:backfill_state.zip:public.backfill_state
saved_searches:saved_searches.zip:public.saved_searches
saved_bids:saved_bids.zip:public.saved_bids
tenders_ccs:tenders_ccs.zip:public.tenders_ccs
awards:awards.zip:public.awards
award_suppliers:award_suppliers.zip:public.award_suppliers
notices:notices.zip:public.notices
tenders:tenders.zip:public.tenders
"

psql -h "$H" -U "$U" -d "$DB" -q -c "SET session_replication_role = replica;" >/dev/null 2>&1

for row in $ORDER; do
  [ -z "$row" ] && continue
  name="${row%%:*}"; rest="${row#*:}"; zip="${rest%%:*}"; tgt="${rest##*:}"
  [ -f "$EXP/$zip" ] || { printf "  %-20s SKIP (no zip)\n" "$name"; continue; }
  member=$(unzip -l "$EXP/$zip" | awk 'NR==4{print $4}')
  hdr=$(unzip -p "$EXP/$zip" "$member" | head -1 | tr -d '\r')
  cols=$(echo "$hdr" | sed 's/[^,]*/"&"/g')

  # Triggers off for this table: the export already reflects trigger output, so
  # re-firing could reset embedding_status or rewrite derived columns.
  psql -h "$H" -U "$U" -d "$DB" -q -c "ALTER TABLE $tgt DISABLE TRIGGER USER;" 2>/dev/null

  err=$(unzip -p "$EXP/$zip" "$member" \
        | psql -h "$H" -U "$U" -d "$DB" -v ON_ERROR_STOP=1 -q \
               -c "\\copy $tgt ($cols) FROM STDIN WITH (FORMAT csv, HEADER true)" 2>&1)
  rc=$?
  psql -h "$H" -U "$U" -d "$DB" -q -c "ALTER TABLE $tgt ENABLE TRIGGER USER;" 2>/dev/null

  n=$(psql -h "$H" -U "$U" -d "$DB" -At -c "SELECT count(*) FROM $tgt;" 2>/dev/null)
  if [ "$rc" = "0" ]; then printf "  %-20s %10s rows\n" "$name" "$n"
  else printf "  %-20s FAILED  %s\n" "$name" "$(echo "$err" | head -2 | tr '\n' ' ' | cut -c1-150)"; fi
done

psql -h "$H" -U "$U" -d "$DB" -q -c "SET session_replication_role = DEFAULT;" >/dev/null 2>&1
