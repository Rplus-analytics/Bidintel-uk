-- ============================================================================
-- 03-verify.sql — the real gate on whether the schema build worked.
-- Read-only. Counts only, no row data.
-- ============================================================================
\pset null '(null)'
\echo '=== extensions ==='
SELECT extname, extversion FROM pg_extension ORDER BY 1;

\echo '=== object counts ==='
SELECT 'tables'   AS object, count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
UNION ALL SELECT 'functions',  count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
UNION ALL SELECT 'triggers',   count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
UNION ALL SELECT 'rls policies', count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'rls-enabled tables', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity
UNION ALL SELECT 'unique indexes', count(*) FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE '%UNIQUE%';

\echo '=== every table a worker or the frontend touches must exist ==='
WITH req(t, why) AS (VALUES
  ('tenders','core search'), ('notices','notices feed'), ('awards','awards'),
  ('award_suppliers','awards'), ('buyers','buyer pages'), ('suppliers','supplier pages'),
  ('cpv_codes','filters'), ('tenders_ccs','ccs'), ('profiles','auth'),
  ('memberships','auth'), ('organisations','auth'), ('org_match_profiles','settings'),
  ('saved_bids','saved bids'), ('saved_searches','saved searches'),
  ('org_name_aliases','canonicalisation'), ('backfill_state','workers'),
  ('ingest_runs','workers'), ('raw_contracts_finder','CF search page'),
  ('tenders_fts','ingest-source-full'), ('tenders_pcs','ingest-source-full'),
  ('tenders_ted','ingest-source-full'), ('cf_bulk_upload','ingest-cf-bulk'),
  ('raw_fts','backfill-source-tick'), ('raw_ted','backfill-source-tick'),
  ('raw_cf_native','ingest-cf-native'), ('raw_ccs_digital_outcomes','scrape-ccs'),
  ('tender_cpv','linked'), ('tender_lots','linked'), ('tender_documents','linked'),
  ('companies','dashboard-added'), ('user_actions','dashboard-added'))
SELECT req.t AS table_name, req.why,
       CASE WHEN to_regclass('public.'||req.t) IS NULL THEN '*** MISSING ***' ELSE 'ok' END AS status
FROM req WHERE to_regclass('public.'||req.t) IS NULL
ORDER BY 1;
\echo '  (no rows above = every required table exists)'

\echo '=== unique constraints the upserts depend on ==='
WITH req(tbl, cols) AS (VALUES
  ('tenders','source, external_id'), ('awards','source, external_id'),
  ('notices','source, external_id'), ('backfill_state','source'),
  ('buyers','name'), ('suppliers','name'),
  ('raw_contracts_finder','ocid, release_id'), ('cf_bulk_upload','notice_identifier'))
SELECT req.tbl, req.cols,
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname='public'
                          AND i.tablename=req.tbl AND i.indexdef LIKE '%UNIQUE%'
                          AND i.indexdef LIKE '%'||replace(req.cols,', ',', ')||'%')
            THEN 'ok' ELSE '*** MISSING — upserts will duplicate ***' END AS status
FROM req ORDER BY 1;

\echo '=== auth shims resolve ==='
SELECT 'auth.uid()'  AS fn, auth.uid()  IS NULL AS null_without_jwt
UNION ALL SELECT 'auth.role()', auth.role() = 'anon';

\echo '=== search_tenders_hybrid must be ABSENT (awaiting live definition) ==='
SELECT count(*) AS overloads_present FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='search_tenders_hybrid';

\echo '=== RLS will actually apply: app roles must NOT bypass ==='
SELECT rolname, rolbypassrls, rolsuper
FROM pg_roles WHERE rolname IN ('bidintel_app','authenticated','anon','postgres') ORDER BY 1;
