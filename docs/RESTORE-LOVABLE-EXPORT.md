# Restoring a Lovable Cloud export into RDS PostgreSQL 18

**Target:** `bidintel-1` (`eu-north-1`, PostgreSQL 18.3, plain RDS — not Supabase).
**Source:** Lovable Cloud → Overview → Advanced settings → **Export project data**.
Includes schema, data, RLS policies and auth users. **5 GB limit, one export per day.**

> ## Handling rules — read first
>
> **The export contains personal data (user emails, profile names) and bcrypt password hashes
> from `auth.users`.** Therefore:
>
> - **Never commit it.** Root `.gitignore` carries deliberately broad patterns (`*export*.sql`,
>   `*export*.zip`, `*.dump`, `lovable-export*/`, …). Verify with `git check-ignore -v <file>`
>   before the file ever lands in the repo directory. Better: keep it outside the repo entirely.
> - **Inspect schema only.** `grep` for DDL, count rows — never `SELECT` and print row contents.
> - **Never paste row data** into tickets, chat, or an AI tool.
> - **Delete the local copy** once restored: `shred -u` or `rm -P`.
> - Anything needing the database password is run by the account owner, not by an assistant.
>
> The 5 GB cap is worth checking against `raw_contracts_finder` (~2.3 GB on its own). If the export
> is truncated, that table is the likely casualty — see step 3.

---

## Why this replaces the existing import

`bidintel-1` currently holds a **partial manual import from per-table CSVs**. Inspection on
2026-09-10 found:

| Finding | Consequence |
|---|---|
| **No vector columns anywhere**, no `embedding_status` column | Every embedding must be regenerated regardless — CSV cannot carry `vector(1536)` |
| `awards` = 28,376 = exactly 2.00× the exported 14,188 | Imported twice; the `(source, external_id)` unique constraint was absent |
| `notices` exists but is **empty**; only `notices_slim` populated | Table naming diverges from every query in the codebase |
| `companies`, `user_actions` do not exist | Two of the six user-ID columns have nowhere to live |
| `org_name_aliases`, `saved_searches` exist but **empty** | Present, unpopulated — user data missing |
| `newtable`, `suppliers_staging`, `tenders_slim_staging` (19,056) | Leftover staging tables from the manual process |
| 140,257 inserts / 160 updates / 242 deletes, 157 sessions | One bulk load, no application traffic since |

**Do not reconcile this. Drop and restore from the official export.** The official export carries
schema, RLS policies and auth users — none of which a CSV can — so it is a strictly better starting
point than anything reachable by repairing what is there.

---

## Two restores, not one

| | When | Into | Purpose |
|---|---|---|---|
| **Test restore** | **Now** | a **scratch database** on `bidintel-1` (`bidintel_restore_test`) | Prove the procedure, measure duration, find every Supabase-ism before it matters. Leaves the existing contents untouched. |
| **Final restore** | At cutover, **after a write freeze** on Lovable Cloud | the production database | The real thing. Only after the test restore has succeeded end to end. |

Doing the test restore into a separate database on the same instance costs nothing extra and needs no
new infrastructure. Remember the **one-export-per-day limit** — a botched test restore means waiting
until tomorrow, so script the steps before spending the export.

---

## The core problem: Supabase-isms in a plain RDS instance

A Lovable Cloud export is a dump of a **Supabase** database. Plain RDS PostgreSQL has none of
Supabase's roles, schemas or helper functions, so a naive `psql -f export.sql` fails — often
part-way, leaving a half-restored database.

| Supabase-ism | Exists on plain RDS? | Handling |
|---|---|---|
| Roles `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_admin`, `dashboard_user` | **No** | Pre-create as `NOLOGIN` stubs so `GRANT`/`ALTER ... OWNER TO` statements resolve |
| Schema `auth` (incl. `auth.users`) | **No** | Recreate the schema; keep it as the user table until Cognito import, then retire |
| Function `auth.uid()`, `auth.role()`, `auth.jwt()` | **No** | Provide GUC-backed shims — see step 5 |
| Schema `storage`, `realtime`, `vault`, `graphql`, `extensions`, `pgbouncer` | **No** | **Not used by BidIntel** (verified: zero `storage.from`/`.channel()` call sites). Filter out. |
| Extension `vector` | Available, not installed | `CREATE EXTENSION vector;` before restore |
| Extension `pg_trgm` | Available, not installed | `CREATE EXTENSION pg_trgm;` before restore |
| Extensions `pg_net`, `supabase_vault`, `pg_graphql`, `pgsodium`, `pgjwt` | **No / not on RDS** | Filter out. `pg_net` is replaced by EventBridge. |
| `pg_cron` | Needs `shared_preload_libraries` | Not needed — EventBridge replaces it |
| Publication `supabase_realtime` | **No** | Filter out — Realtime is unused |
| Event triggers, `ALTER SYSTEM`, `COMMENT ON EXTENSION` | Restricted on RDS | Filter out |

---

## Procedure

### Step 0 — Prerequisites (once)

```bash
# Custom parameter group, because default.postgres18 cannot be edited.
# Only needed if you later want pg_cron; pgvector and pg_trgm need no preload.
# Raise maintenance_work_mem for the HNSW index build (see step 7).
aws rds create-db-parameter-group --db-parameter-group-name bidintel-pg18 \
  --db-parameter-group-family postgres18 --description "BidIntel PostgreSQL 18" \
  --region eu-north-1 --profile rplusai
```

### Step 1 — Take the export

Lovable Cloud → Overview → Advanced settings → **Export project data**. Download **outside the repo**:

```bash
mkdir -p ~/bidintel-exports && cd ~/bidintel-exports    # NOT inside the git repo
# ... download here ...
ls -lh
shasum -a 256 * > SHA256SUMS          # so you can prove which export a restore came from
```

### Step 2 — Verify it is ignored (belt and braces)

```bash
cd ~/Bidintel && git check-ignore -v ~/bidintel-exports/<file>   # expect a match
git status --short                                               # expect nothing new
```

### Step 3 — Inspect the schema only, never the rows

```bash
cd ~/bidintel-exports
# If it is an archive, list without extracting row data first:
tar -tzf <file>.tar.gz | head -50        # or: unzip -l <file>.zip

# Schema-only reconnaissance on a .sql dump — DDL lines only, no COPY payloads:
grep -nE '^(CREATE|ALTER|GRANT|REVOKE|COMMENT|DROP) ' <file>.sql | head -100
grep -cE '^COPY '                        <file>.sql   # how many data blocks
grep -oE 'CREATE EXTENSION [^;]+'        <file>.sql | sort -u
grep -oE 'CREATE SCHEMA [^;]+'           <file>.sql | sort -u
grep -oE 'CREATE POLICY [^ ]+ ON [^ ]+'  <file>.sql | sort -u | wc -l
grep -oE 'auth\.(uid|role|jwt)\(\)'      <file>.sql | sort | uniq -c
grep -oE 'vector\([0-9]+\)'              <file>.sql | sort | uniq -c   # did vectors survive?
grep -cE 'TO (anon|authenticated|service_role)' <file>.sql

# Size sanity — is raw_contracts_finder present, or did the 5 GB cap truncate it?
grep -n 'COPY public.raw_contracts_finder' <file>.sql
```

**Do not** `head`/`cat` a `COPY` block: that is row data, including `auth.users` password hashes.

### Step 4 — Create the scratch database and its prerequisites

Run by the account owner (needs the master password):

```sql
-- as master user, connected to `postgres`
CREATE DATABASE bidintel_restore_test;
\c bidintel_restore_test

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase role stubs. NOLOGIN: they must never be usable to connect.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','authenticator',
                           'supabase_admin','supabase_auth_admin','supabase_storage_admin',
                           'dashboard_user','pgbouncer']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
```

### Step 5 — `auth.uid()` shims

The export's RLS policies call `auth.uid()`. Provide GUC-backed equivalents so the policies restore
**and** work under the Lambda model (see `aws-backend/auth/AUTH-MIGRATION-PLAN.md` §4.2). These are
the same functions phase 2 needs permanently.

```sql
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::uuid
  $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('app.role', true), ''), 'authenticated')
  $$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
```

Note these are **not** `SECURITY DEFINER` — they read settings rather than querying `memberships`,
so the RLS recursion the Supabase originals worked around does not arise.

### Step 6 — Filter and restore

```bash
# Strip statements plain RDS cannot execute. Review the diff before running:
#   diff <(cat export.sql) filtered.sql | head -50
grep -vE '^(CREATE|DROP) EXTENSION (pg_net|supabase_vault|pg_graphql|pgsodium|pgjwt|pg_cron)' export.sql \
  | grep -vE '^CREATE SCHEMA (storage|realtime|graphql|graphql_public|vault|pgbouncer|extensions)' \
  | grep -vE '^(CREATE|ALTER) PUBLICATION supabase_realtime' \
  | grep -vE '^ALTER SYSTEM' \
  | grep -vE '^CREATE EVENT TRIGGER' \
  | grep -vE '^COMMENT ON EXTENSION' \
  > filtered.sql

# Restore. ON_ERROR_STOP so it halts rather than half-completing.
psql "host=bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com dbname=bidintel_restore_test user=postgres" \
     -v ON_ERROR_STOP=1 -f filtered.sql 2> restore-errors.log

# Errors are DDL diagnostics, not row data — safe to read.
sort restore-errors.log | uniq -c | sort -rn | head -30
```

If it is a custom-format dump instead, use `pg_restore` and let it continue past errors so you get
the full list in one pass:

```bash
pg_restore --no-owner --no-acl --schema=public --schema=auth \
           -d "postgresql://postgres@.../bidintel_restore_test" export.dump 2> restore-errors.log
```

`--no-owner --no-acl` sidesteps most role problems; the stubs in step 4 cover the rest.

### Step 7 — Rebuild what the dump cannot carry

```sql
-- HNSW index. Raise maintenance_work_mem first or pgvector falls back to a much
-- slower on-disk build. ~200-256 MB is enough for 20k x 1536.
SET maintenance_work_mem = '512MB';
CREATE INDEX IF NOT EXISTS tenders_embedding_hnsw_idx
  ON public.tenders USING hnsw (embedding vector_cosine_ops);
RESET maintenance_work_mem;
```

### Step 8 — Post-restore verification

Run `docs/sql/inspect-bidintel-1.sql` against `bidintel_restore_test`. It checks row counts,
vector columns, constraints, triggers, functions, RLS policies and indexes.

**Embedding coverage — the question the CSV import could not answer:**

```sql
-- Per vector column: how many rows actually carry an embedding?
SELECT c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM %I.%I WHERE %I IS NOT NULL',
                 n.nspname, c.relname, a.attname), false, true, ''))
       )[1]::text::bigint AS embedded_rows,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
          false, true, ''))
       )[1]::text::bigint AS total_rows
FROM   pg_attribute a
JOIN   pg_class     c ON c.oid = a.attrelid
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  a.attnum > 0 AND NOT a.attisdropped
  AND  format_type(a.atttypid, a.atttypmod) LIKE 'vector%'
ORDER  BY 1, 2;

-- Pipeline bookkeeping, if the column survived.
SELECT embedding_status, count(*) AS rows
FROM   public.tenders
GROUP  BY 1 ORDER BY 2 DESC;

-- Dimension check: must be 1536 to match text-embedding-3-small.
SELECT DISTINCT vector_dims(embedding) AS dims
FROM   public.tenders WHERE embedding IS NOT NULL;
```

**Interpretation.** If `embedded_rows` is close to `total_rows`, the embeddings survived and the
Bedrock option's "re-embed everything" cost disappears — which changes the open embedding-provider
decision. If it is zero or the vector columns are absent, all ~20k must be regenerated regardless of
provider, and that argument becomes moot.

**Other checks:**

```sql
-- Duplicates that the CSV import created — should be zero here.
SELECT count(*) - count(DISTINCT (source, external_id)) AS duplicate_awards FROM public.awards;

-- RLS policies: expect ~19 across the 6 app tables.
SELECT tablename, count(*) FROM pg_policies WHERE schemaname='public' GROUP BY 1 ORDER BY 1;

-- Auth users: expect 7. Count only — do not select the rows.
SELECT count(*) AS auth_users FROM auth.users;
```

### Step 9 — Clean up

```bash
shred -u ~/bidintel-exports/<file> 2>/dev/null || rm -P ~/bidintel-exports/<file>
```

```sql
DROP DATABASE bidintel_restore_test;   -- only after findings are written down
```

---

## Final restore at cutover

1. **Freeze writes on Lovable Cloud** — disable the `pg_cron` ingestion jobs. Note the time.
2. Take a **fresh export** (remember: one per day — do not waste it on a rehearsal).
3. Restore into the production database using the procedure above, now proven.
4. Verify: row counts, `duplicate_awards = 0`, RLS policy count, `auth.users` count, embedding coverage.
5. Import the 7 users into Cognito (`docs/DEPLOYMENT-PLAN.md` §c).
6. Re-enable ingestion **on AWS only**.

**Rollback:** Lovable Cloud stays untouched and running throughout. Rollback is repointing the
frontend. Do not decommission anything for at least two weeks. The one-way door is Cognito — once
users reset passwords there, going back means resetting again.

## Open questions

1. **Actual export format** — `.sql`, custom-format dump, or an archive? The filter commands in
   step 6 assume plain SQL; adjust for `pg_restore` if not.
2. **Does the 5 GB cap truncate anything?** `raw_contracts_finder` alone is ~2.3 GB. If it is
   excluded or truncated, it can be rebuilt from source APIs via `backfill-raw-cf`.
3. **Do vectors survive the export?** Determines the re-embedding cost, and therefore the pending
   embedding-provider decision.
4. **Does it include `auth.users` password hashes in a usable form?** Irrelevant for Cognito, which
   cannot import hashes anyway — every user resets. Noted only because it raises the handling bar.
