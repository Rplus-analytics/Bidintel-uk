
-- 1. Raw table
CREATE TABLE IF NOT EXISTS public.raw_ccs_digital_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text UNIQUE NOT NULL,
  payload jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.raw_ccs_digital_outcomes TO authenticated;
GRANT ALL ON public.raw_ccs_digital_outcomes TO service_role;
ALTER TABLE public.raw_ccs_digital_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read raw_ccs_digital_outcomes" ON public.raw_ccs_digital_outcomes FOR SELECT TO authenticated USING (true);

-- 2. Normalized table (mirrors tenders_fts shape, minimal columns populated)
CREATE TABLE IF NOT EXISTS public.tenders_ccs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'ccs_digital_outcomes',
  external_id text NOT NULL,
  title text,
  description text,
  buyer_name text,
  buyer_type text,
  notice_type text,
  procedure_type text,
  value_min numeric,
  value_max numeric,
  currency text DEFAULT 'GBP',
  published_at timestamptz,
  deadline_at timestamptz,
  award_date timestamptz,
  contract_start date,
  contract_end date,
  primary_cpv text,
  cpv_codes text[],
  country text DEFAULT 'GB',
  region text,
  sector text,
  source_url text,
  status text,
  framework text,
  lot text,
  raw_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenders_ccs_unique UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS tenders_ccs_published_idx ON public.tenders_ccs (published_at DESC);
GRANT SELECT ON public.tenders_ccs TO authenticated;
GRANT ALL ON public.tenders_ccs TO service_role;
ALTER TABLE public.tenders_ccs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read tenders_ccs" ON public.tenders_ccs FOR SELECT TO authenticated USING (true);

CREATE TRIGGER tenders_ccs_set_updated_at
BEFORE UPDATE ON public.tenders_ccs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Recreate tenders_master to add ccs_digital_outcomes as 4th source
CREATE OR REPLACE VIEW public.tenders_master AS
  SELECT source, external_id, title, description, buyer_name, buyer_type, notice_type, procedure_type,
    value_min, value_max, currency, published_at, deadline_at, award_date,
    contract_start, contract_end, primary_cpv, country, region, sector, source_url,
    status::text AS status, created_at, updated_at
  FROM public.tenders_fts
  UNION ALL
  SELECT source, external_id, title, description, buyer_name,
    NULL::text, NULL::text, procedure_type, value_min, value_max, currency,
    published_at, deadline_at, NULL::timestamptz,
    contract_start::date, contract_end::date, primary_cpv, country, region, NULL::text,
    source_url, status, created_at, NULL::timestamptz
  FROM public.tenders_cf
  UNION ALL
  SELECT source, external_id, title, description, buyer_name,
    NULL::text, NULL::text, NULL::text, value_min, value_max, currency,
    published_at, deadline_at, NULL::timestamptz,
    NULL::date, NULL::date, primary_cpv, country, NULL::text, NULL::text,
    source_url, NULL::text, created_at, NULL::timestamptz
  FROM public.tenders_pcs
  UNION ALL
  SELECT source, external_id, title, description, buyer_name, buyer_type, notice_type, procedure_type,
    value_min, value_max, currency, published_at, deadline_at, award_date,
    contract_start, contract_end, primary_cpv, country, region, sector, source_url,
    status, created_at, updated_at
  FROM public.tenders_ccs;

-- 4. Seed backfill_state row (idempotent). Uses year=cursor pointer; month0=combo index.
INSERT INTO public.backfill_state (source, year, month0, completed, last_run_at)
VALUES ('ccs_digital_outcomes', 0, 0, false, NULL)
ON CONFLICT (source) DO NOTHING;
