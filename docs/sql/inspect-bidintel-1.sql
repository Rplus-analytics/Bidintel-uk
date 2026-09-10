-- ============================================================================
-- bidintel-1 inspection — READ-ONLY
--
--   psql -h bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com \
--        -U postgres -d postgres -f docs/sql/inspect-bidintel-1.sql
--   (or from an interactive session: \i docs/sql/inspect-bidintel-1.sql)
--
-- CONTEXT (inspected 2026-09-10): bidintel-1 holds a PARTIAL MANUAL IMPORT made
-- from Lovable Cloud's per-table CSV export. Confirmed by inspection:
--   * 20 tables; NO vector columns anywhere; no `embedding_status` column
--   * `awards` = 28,376 = exactly 2.00x the exported 14,188 (imported twice)
--   * `notices` exists but is EMPTY; only `notices_slim` is populated
--   * `companies` and `user_actions` do not exist
--   * `org_name_aliases` and `saved_searches` exist but are empty
--   * leftovers: `newtable` (0), `suppliers_staging` (0),
--     `tenders_slim_staging` (19,056 — same as `tenders`)
--   * tup_inserted 140,257 / updated 160 / deleted 242; sessions 157, fatal 0
--
-- This import will NOT be reused. Data will come from Lovable Cloud's official
-- project export instead — see docs/RESTORE-LOVABLE-EXPORT.md. This script now
-- serves to re-verify that conclusion and to check a restore afterwards.
--
-- Every table-dependent query is guarded, so anything absent is skipped rather
-- than erroring. Nothing here writes.
-- ============================================================================
\timing on
\pset null '(null)'

\echo '\n=== 1. TABLES ==============================================='
\dt public.*

\echo '\n=== 1b. ROW COUNTS, every table, descending ================='
-- Compare against the export snapshot in docs/migration/supabase-aws-migration-status.md
SELECT c.relname AS table_name,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
          false, true, ''))
       )[1]::text::bigint AS row_count
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND c.relkind = 'r'
ORDER  BY 2 DESC NULLS LAST;

\echo '\n=== 2. EMBEDDING STATUS ====================================='
SELECT to_regclass('public.tenders') IS NOT NULL
   AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='tenders'
                 AND column_name='embedding_status') AS has_embstatus \gset
\if :has_embstatus
SELECT embedding_status, count(*) AS rows
FROM   public.tenders
GROUP  BY 1
ORDER  BY 2 DESC;
\else
\echo '  (skipped: public.tenders.embedding_status does not exist — the column may'
\echo '   not have survived a CSV import, which is itself worth knowing)'
\endif

\echo '\n=== 3a. VECTOR COLUMNS ======================================'
SELECT c.relname  AS table_name,
       a.attname  AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type
FROM   pg_attribute a
JOIN   pg_class     c ON c.oid = a.attrelid
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  a.attnum > 0 AND NOT a.attisdropped
  AND  format_type(a.atttypid, a.atttypmod) LIKE 'vector%'
ORDER  BY 1, 2;

\echo '\n=== 3b. EMBEDDING COVERAGE =================================='
-- If this returns no rows, pgvector columns did not survive the import and
-- every embedding must be regenerated. That is the expensive outcome.
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

\echo '\n=== 4. (recency check removed) ============================='
\echo '  The live source of truth is Lovable Cloud, which offers no direct SQL'
\echo '  access, so there is no second database to compare against. Data comes'
\echo '  from the official Lovable project export — see docs/RESTORE-LOVABLE-EXPORT.md'

\echo '\n=== 5. CONNECTION / WRITE HISTORY ==========================='
SELECT datname, numbackends, sessions, sessions_abandoned, sessions_fatal,
       xact_commit, xact_rollback,
       tup_inserted, tup_updated, tup_deleted, blks_read, stats_reset
FROM   pg_stat_database
WHERE  datname = current_database();

\echo '\n=== 6. PROFILES TABLE ======================================='
SELECT to_regclass('public.profiles') IS NOT NULL AS has_profiles \gset
\if :has_profiles
\d public.profiles
\else
\echo '  (skipped: public.profiles does not exist)'
\endif

\echo '\n=== 7. ORPHAN AUDIT — user-ID columns vs profiles.id ========'
-- profiles.id is the audit TARGET, so it is not listed here.
\if :has_profiles
WITH cols(tbl, col) AS (VALUES
  ('memberships','user_id'), ('saved_bids','saved_by'), ('saved_searches','user_id'),
  ('companies','user_id'),   ('user_actions','user_id'))
SELECT c.tbl AS table_name, c.col AS column_name,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM public.%I WHERE %I IS NOT NULL', c.tbl, c.col),
          false, true, ''))
       )[1]::text::bigint AS non_null_ids,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM public.%I x WHERE x.%I IS NOT NULL '
                 'AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.%I)',
                 c.tbl, c.col, c.col), false, true, ''))
       )[1]::text::bigint AS orphans
FROM   cols c
WHERE  to_regclass('public.'||c.tbl) IS NOT NULL
  AND  EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=c.tbl AND column_name=c.col)
ORDER  BY 1, 2;
\else
\echo '  (skipped: public.profiles does not exist, nothing to audit against)'
\endif

\echo '\n=== 8. AWARDS DOUBLE-IMPORT CHECK ==========================='
-- awards is 28,376 = exactly 2 x the exported 14,188. Confirm duplication and
-- whether a unique constraint on (source, external_id) is missing or was dropped.
SELECT to_regclass('public.awards') IS NOT NULL AS has_awards \gset
\if :has_awards
SELECT count(*) AS total_rows,
       count(DISTINCT (source, external_id)) AS distinct_source_extid,
       count(*) - count(DISTINCT (source, external_id)) AS duplicate_rows
FROM   public.awards;

\echo '  -- worst offenders --'
SELECT source, external_id, count(*) AS copies
FROM   public.awards
GROUP  BY 1, 2
HAVING count(*) > 1
ORDER  BY 3 DESC, 1, 2
LIMIT  10;

\echo '  -- constraints and indexes actually present on awards --'
\d public.awards
\else
\echo '  (skipped: public.awards does not exist)'
\endif

\echo '\n=== 9. SCHEMA COMPLETENESS =================================='
-- Did DDL come across, or only data? These are the things a CSV import loses.
\echo '  -- extensions (is pgvector installed?) --'
SELECT extname, extversion FROM pg_extension ORDER BY 1;

\echo '  -- triggers (canonical-name and derived-status triggers are invisible in CSV) --'
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM   pg_trigger t
JOIN   pg_class c ON c.oid = t.tgrelid
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public' AND NOT t.tgisinternal
ORDER  BY 1, 2;

\echo '  -- functions / RPCs (search_tenders_hybrid must exist, 14-arg overload) --'
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
ORDER  BY 1, 2;

\echo '  -- RLS policies (none means row-level security did not come across) --'
SELECT schemaname, tablename, policyname
FROM   pg_policies
WHERE  schemaname = 'public'
ORDER  BY 2, 3;

\echo '  -- indexes on the big tables --'
SELECT tablename, indexname
FROM   pg_indexes
WHERE  schemaname = 'public'
  AND  tablename IN ('tenders','awards','notices','notices_slim','buyers','suppliers')
ORDER  BY 1, 2;
