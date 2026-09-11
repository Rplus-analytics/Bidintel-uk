-- ============================================================================
-- 02-postlude.sql — run AFTER 01-replay.sh
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove search_tenders_hybrid entirely.
--
-- The migrations create FOUR overloads (5, 10, 13 and 14 arg). Per instruction,
-- none is trusted: the pipeline DDL is dated 18 Aug, newer than the 25 Jun
-- migration, so the live function may read different tables. All overloads are
-- dropped here and the live definition installed once the export arrives.
--
-- Consequence until then: semantic-search returns its graceful-degradation
-- response (results: [], rpcError set) rather than erroring. Keyword search via
-- PostgREST is unaffected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'search_tenders_hybrid'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
    RAISE NOTICE 'dropped %', r.sig;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Drop the unused matview and its base view.
-- Read by nothing: no frontend call site, no Lambda, no edge function.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.tenders_cf_full_mat;
DROP VIEW IF EXISTS public.tenders_cf_full;

-- ---------------------------------------------------------------------------
-- 3. Tables the Lambdas write to that the migrations may not create.
-- tenders_ted / raw_ted are absent from Lovable's DDL.sql but ARE written by
-- ingest-source-full and backfill-source-tick. Shapes follow their siblings.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenders_ted (LIKE public.tenders_fts INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.raw_ted (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocid         text NOT NULL,
  release_id   text,
  published_date timestamptz,
  payload      jsonb NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS raw_ted_ocid_key ON public.raw_ted (ocid);

-- ---------------------------------------------------------------------------
-- 4. THE CRITICAL PART: every unique constraint the workers rely on.
--
-- The existing `postgres` database has ZERO unique constraints, which is
-- exactly how `awards` ended up with 14,188 duplicate rows. Every upsert in
-- every worker targets one of these; without them, ON CONFLICT either errors or
-- silently duplicates. These MUST exist before any data load or worker run.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS tenders_source_external_id_key      ON public.tenders (source, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS awards_source_external_id_key       ON public.awards (source, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS notices_source_external_id_key      ON public.notices (source, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS award_suppliers_award_supplier_key  ON public.award_suppliers (award_id, supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS tender_cpv_tender_code_key          ON public.tender_cpv (tender_id, cpv_code);
CREATE UNIQUE INDEX IF NOT EXISTS tender_lots_tender_lot_key          ON public.tender_lots (tender_id, lot_number);
CREATE UNIQUE INDEX IF NOT EXISTS backfill_state_source_key           ON public.backfill_state (source);
CREATE UNIQUE INDEX IF NOT EXISTS tenders_ccs_source_external_id_key  ON public.tenders_ccs (source, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS raw_ccs_project_id_key              ON public.raw_ccs_digital_outcomes (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS raw_cf_native_notice_id_key2        ON public.raw_cf_native (notice_id);
CREATE UNIQUE INDEX IF NOT EXISTS cf_bulk_upload_notice_ident_key2    ON public.cf_bulk_upload (notice_identifier);
CREATE UNIQUE INDEX IF NOT EXISTS raw_contracts_finder_ocid_rel_key2  ON public.raw_contracts_finder (ocid, release_id);
CREATE UNIQUE INDEX IF NOT EXISTS raw_fts_ocid_key2                   ON public.raw_fts (ocid);
-- buyers / suppliers are upserted on EITHER external_id OR name, so both need
-- to be unique (ocds-linked.ts picks the conflict target per release).
CREATE UNIQUE INDEX IF NOT EXISTS buyers_name_key                     ON public.buyers (name);
CREATE UNIQUE INDEX IF NOT EXISTS buyers_external_id_key              ON public.buyers (external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_key                  ON public.suppliers (name);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_external_id_key           ON public.suppliers (external_id) WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. HNSW index. Session-scoped maintenance_work_mem, no parameter group.
-- Deferred until embeddings exist — an HNSW index over an all-NULL column is
-- pointless and would need rebuilding anyway.
-- ---------------------------------------------------------------------------
-- SET maintenance_work_mem = '512MB';
-- CREATE INDEX tenders_embedding_hnsw_idx ON public.tenders USING hnsw (embedding vector_cosine_ops);
-- RESET maintenance_work_mem;

-- ---------------------------------------------------------------------------
-- 6. Application role. Non-owner, no BYPASSRLS — the two properties that make
-- RLS actually apply. PostgREST's authenticator switches into `authenticated`.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bidintel_app') THEN
    CREATE ROLE bidintel_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO bidintel_app, authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon;
