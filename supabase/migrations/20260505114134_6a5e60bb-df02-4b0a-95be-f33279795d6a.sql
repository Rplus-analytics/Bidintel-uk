
-- =========================================================
-- Procurement schema refactor
-- Canonical entity: public.notices (populated by 7 source ingestors)
-- Goals: normalize buyers, add FKs, add full-text search,
--        prepare for embeddings/matching, add useful indexes.
-- =========================================================

-- 1) Rename buyers1 -> buyers (preserves FK from tenders)
ALTER TABLE IF EXISTS public.buyers1 RENAME TO buyers;
ALTER INDEX IF EXISTS buyers1_pkey RENAME TO buyers_pkey;
ALTER INDEX IF EXISTS buyers1_name_key RENAME TO buyers_name_key;

-- 2) Enrich buyers with optional identifiers
ALTER TABLE public.buyers
  ADD COLUMN IF NOT EXISTS buyer_type_code text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'GB',
  ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- 3) Notices: add buyer FK, full-text search, embedding placeholder
ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS buyer_id uuid REFERENCES public.buyers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS procedure_type text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS embedding jsonb,                 -- store vector as JSON until pgvector enabled
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
      setweight(to_tsvector('english', coalesce(buyer,'')), 'B') ||
      setweight(to_tsvector('english', coalesce(description,'')), 'C')
    ) STORED;

-- Backfill buyer_id from existing buyer name
UPDATE public.notices n
SET buyer_id = b.id
FROM public.buyers b
WHERE n.buyer_id IS NULL AND n.buyer IS NOT NULL AND b.name = n.buyer;

-- 4) Suppliers: ensure companies_house_id is unique when present
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_companies_house_uq
  ON public.suppliers(companies_house_id)
  WHERE companies_house_id IS NOT NULL;

-- 5) Awards: link to supplier and to canonical notice (already has notice_id)
ALTER TABLE public.awards
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buyer_id uuid REFERENCES public.buyers(id) ON DELETE SET NULL;

-- 6) notice_cpv: add proper FKs (currently orphaned table)
DO $$ BEGIN
  ALTER TABLE public.notice_cpv
    ADD CONSTRAINT notice_cpv_notice_fk FOREIGN KEY (notice_id)
    REFERENCES public.notices(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.notice_cpv
    ADD CONSTRAINT notice_cpv_cpv_fk FOREIGN KEY (cpv_code)
    REFERENCES public.cpv_codes(code) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7) Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_notices_search        ON public.notices USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_notices_deadline      ON public.notices(deadline_date);
CREATE INDEX IF NOT EXISTS idx_notices_cpv           ON public.notices(cpv_code);
CREATE INDEX IF NOT EXISTS idx_notices_region        ON public.notices(region);
CREATE INDEX IF NOT EXISTS idx_notices_buyer_id      ON public.notices(buyer_id);
CREATE INDEX IF NOT EXISTS idx_notices_value         ON public.notices(value);
CREATE INDEX IF NOT EXISTS idx_notice_cpv_cpv        ON public.notice_cpv(cpv_code);
CREATE INDEX IF NOT EXISTS idx_buyers_name_lower     ON public.buyers((lower(name)));
CREATE INDEX IF NOT EXISTS idx_awards_supplier_id    ON public.awards(supplier_id);
CREATE INDEX IF NOT EXISTS idx_awards_buyer_id       ON public.awards(buyer_id);

-- 8) Drop redundant 'tenders' mirror (data is duplicated from notices, populated by same sync).
--    Cascade also drops tender_lots/tender_cpv/tender_documents which are empty.
DROP TABLE IF EXISTS public.tender_documents CASCADE;
DROP TABLE IF EXISTS public.tender_lots      CASCADE;
DROP TABLE IF EXISTS public.tender_cpv       CASCADE;
DROP TABLE IF EXISTS public.tenders          CASCADE;

-- 9) updated_at trigger on notices (uses existing public.set_updated_at)
DROP TRIGGER IF EXISTS trg_notices_updated_at ON public.notices;
CREATE TRIGGER trg_notices_updated_at
  BEFORE UPDATE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10) RLS for new columns inherits existing notices/buyers policies. Make sure RLS on buyers stays enabled.
ALTER TABLE public.buyers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "buyers read for authed" ON public.buyers
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
