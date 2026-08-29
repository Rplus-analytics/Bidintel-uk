-- 1. Source-specific tables (clone shape from tenders)
CREATE TABLE IF NOT EXISTS public.tenders_fts (LIKE public.tenders INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS public.tenders_cf  (LIKE public.tenders INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS public.tenders_ted (LIKE public.tenders INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS public.tenders_pcs (LIKE public.tenders INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);

-- 2. Unique (source, external_id) per table (idempotent guards)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_fts_unique') THEN
    ALTER TABLE public.tenders_fts ADD CONSTRAINT tenders_fts_unique UNIQUE (source, external_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_cf_unique') THEN
    ALTER TABLE public.tenders_cf ADD CONSTRAINT tenders_cf_unique UNIQUE (source, external_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_ted_unique') THEN
    ALTER TABLE public.tenders_ted ADD CONSTRAINT tenders_ted_unique UNIQUE (source, external_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_pcs_unique') THEN
    ALTER TABLE public.tenders_pcs ADD CONSTRAINT tenders_pcs_unique UNIQUE (source, external_id);
  END IF;
END $$;

-- Helpful indexes for queries
CREATE INDEX IF NOT EXISTS tenders_fts_published_idx ON public.tenders_fts (published_date DESC);
CREATE INDEX IF NOT EXISTS tenders_cf_published_idx  ON public.tenders_cf  (published_date DESC);
CREATE INDEX IF NOT EXISTS tenders_ted_published_idx ON public.tenders_ted (published_date DESC);
CREATE INDEX IF NOT EXISTS tenders_pcs_published_idx ON public.tenders_pcs (published_date DESC);

-- 3. RLS — read for authenticated (mirrors public.tenders)
ALTER TABLE public.tenders_fts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenders_cf  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenders_ted ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenders_pcs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth read tenders_fts' AND tablename = 'tenders_fts') THEN
    CREATE POLICY "auth read tenders_fts" ON public.tenders_fts FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth read tenders_cf' AND tablename = 'tenders_cf') THEN
    CREATE POLICY "auth read tenders_cf" ON public.tenders_cf FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth read tenders_ted' AND tablename = 'tenders_ted') THEN
    CREATE POLICY "auth read tenders_ted" ON public.tenders_ted FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth read tenders_pcs' AND tablename = 'tenders_pcs') THEN
    CREATE POLICY "auth read tenders_pcs" ON public.tenders_pcs FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- 4. Master view
CREATE OR REPLACE VIEW public.tenders_master AS
SELECT *, 'fts'::text AS src FROM public.tenders_fts
UNION ALL
SELECT *, 'cf'::text  AS src FROM public.tenders_cf
UNION ALL
SELECT *, 'ted'::text AS src FROM public.tenders_ted
UNION ALL
SELECT *, 'pcs'::text AS src FROM public.tenders_pcs;

-- 5. Seed backfill cursors for the new full-history sources
INSERT INTO public.backfill_state (source, year, month0, completed)
VALUES
  ('fts_full', 2021, 0, false),
  ('cf_full',  2015, 0, false),
  ('ted_full', 2018, 0, false),
  ('pcs_full', 2015, 0, false)
ON CONFLICT (source) DO NOTHING;