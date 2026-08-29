DROP VIEW IF EXISTS public.tenders_master;

CREATE VIEW public.tenders_master AS
SELECT 
  source, external_id, title, description,
  buyer_name, buyer_type, notice_type, procedure_type,
  value_min, value_max, currency,
  published_at, deadline_at, award_date,
  contract_start, contract_end,
  primary_cpv, country, region, sector,
  source_url, status::text AS status, created_at, updated_at
FROM public.tenders_fts
UNION ALL
SELECT 
  source, external_id, title, description,
  buyer_name, null::text AS buyer_type, null::text AS notice_type, null::text AS procedure_type,
  value_min, value_max, currency,
  published_at, deadline_at, null::timestamptz AS award_date,
  null::date AS contract_start, null::date AS contract_end,
  primary_cpv, country, null::text AS region, null::text AS sector,
  source_url, null::text AS status, created_at, null::timestamptz AS updated_at
FROM public.tenders_cf
UNION ALL
SELECT 
  source, external_id, title, description,
  buyer_name, null::text AS buyer_type, notice_type, procedure_type,
  value_min, value_max, currency,
  published_at, deadline_at, null::timestamptz AS award_date,
  null::date AS contract_start, null::date AS contract_end,
  primary_cpv, country, region, null::text AS sector,
  source_url, status::text AS status, created_at, updated_at
FROM public.tenders_ted
UNION ALL
SELECT 
  source, external_id, title, description,
  buyer_name, null::text AS buyer_type, null::text AS notice_type, null::text AS procedure_type,
  value_min, value_max, currency,
  published_at, deadline_at, null::timestamptz AS award_date,
  null::date AS contract_start, null::date AS contract_end,
  primary_cpv, country, null::text AS region, null::text AS sector,
  source_url, null::text AS status, created_at, null::timestamptz AS updated_at
FROM public.tenders_pcs;