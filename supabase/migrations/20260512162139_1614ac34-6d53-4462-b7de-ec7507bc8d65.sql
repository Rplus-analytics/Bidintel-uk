DROP VIEW IF EXISTS public.tenders_master;
DROP TABLE IF EXISTS public.tenders_cf;

CREATE OR REPLACE VIEW public.tenders_cf AS
SELECT
  'cf'::text AS source,
  COALESCE(payload->>'ocid', release_id) AS external_id,
  payload->'tender'->>'title' AS title,
  payload->'tender'->>'description' AS description,
  payload->'buyer'->>'name' AS buyer_name,
  NULLIF(payload->'tender'->'minValue'->>'amount','')::numeric AS value_min,
  NULLIF(payload->'tender'->'value'->>'amount','')::numeric AS value_max,
  COALESCE(payload->'tender'->'value'->>'currency','GBP') AS currency,
  COALESCE(NULLIF(payload->'tender'->>'datePublished','')::timestamptz, published_date) AS published_at,
  NULLIF(payload->'tender'->'tenderPeriod'->>'endDate','')::timestamptz AS deadline_at,
  payload->'tender'->'classification'->>'id' AS primary_cpv,
  payload->'tender'->'documents'->0->>'url' AS source_url,
  payload->'parties'->0->'address'->>'countryName' AS country,
  published_date AS created_at,
  payload AS raw_json
FROM public.raw_contracts_finder;

ALTER VIEW public.tenders_cf SET (security_invoker = true);

CREATE OR REPLACE VIEW public.tenders_master AS
SELECT source, external_id, title, description, buyer_name,
       value_min, value_max, currency, published_at, deadline_at,
       primary_cpv, source_url, country, created_at
FROM public.tenders_fts
UNION ALL
SELECT source, external_id, title, description, buyer_name,
       value_min, value_max, currency, published_at, deadline_at,
       primary_cpv, source_url, country, created_at
FROM public.tenders_cf
UNION ALL
SELECT source, external_id, title, description, buyer_name,
       value_min, value_max, currency, published_at, deadline_at,
       primary_cpv, source_url, country, created_at
FROM public.tenders_ted
UNION ALL
SELECT source, external_id, title, description, buyer_name,
       value_min, value_max, currency, published_at, deadline_at,
       primary_cpv, source_url, country, created_at
FROM public.tenders_pcs;

ALTER VIEW public.tenders_master SET (security_invoker = true);

DELETE FROM public.backfill_state WHERE source = 'cf_full';