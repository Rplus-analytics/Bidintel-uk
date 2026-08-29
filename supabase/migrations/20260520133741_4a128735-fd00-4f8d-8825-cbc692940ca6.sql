DROP VIEW IF EXISTS public.tenders_cf CASCADE;

CREATE VIEW public.tenders_cf AS
SELECT
  'cf'::text AS source,
  payload->>'ocid' AS external_id,
  payload->'tender'->>'title' AS title,
  payload->'tender'->>'description' AS description,
  payload->'buyer'->>'name' AS buyer_name,
  NULLIF(payload->'tender'->'minValue'->>'amount','')::numeric AS value_min,
  NULLIF(payload->'tender'->'value'->>'amount','')::numeric AS value_max,
  COALESCE(payload->'tender'->'value'->>'currency', 'GBP') AS currency,
  NULLIF(payload->'tender'->>'datePublished','')::timestamptz AS published_at,
  NULLIF(payload->'tender'->'tenderPeriod'->>'endDate','')::timestamptz AS deadline_at,
  payload->'tender'->'classification'->>'id' AS primary_cpv,
  payload->'tender'->'documents'->0->>'url' AS source_url,
  payload->'parties'->0->'address'->>'countryName' AS country,
  payload->'parties'->0->'address'->>'region' AS region,
  payload->'parties'->0->'address'->>'postalCode' AS postcode,
  payload->'parties'->0->'contactPoint'->>'name' AS contact_name,
  payload->'parties'->0->'contactPoint'->>'email' AS contact_email,
  payload->'parties'->0->'contactPoint'->>'telephone' AS contact_telephone,
  payload->'tender'->>'status' AS status,
  payload->'tender'->>'procurementMethod' AS procedure_type,
  payload->'tender'->>'procurementMethodDetails' AS ojeu_procedure_type,
  payload->'tender'->>'mainProcurementCategory' AS contract_type,
  NULLIF(payload->'tender'->'contractPeriod'->>'startDate','')::timestamptz AS contract_start,
  NULLIF(payload->'tender'->'contractPeriod'->>'endDate','')::timestamptz AS contract_end,
  payload->'tender'->'suitability'->>'sme' AS suitable_for_sme,
  payload->'tender'->'suitability'->>'vcse' AS suitable_for_vco,
  payload->>'ocid' AS ocid,
  published_date AS created_at,
  payload AS raw_json
FROM public.raw_contracts_finder;

GRANT SELECT ON public.tenders_cf TO authenticated;

CREATE VIEW public.tenders_master AS
SELECT
  source, external_id, title, description, buyer_name, buyer_type,
  notice_type, procedure_type, value_min, value_max, currency,
  published_at, deadline_at, award_date, contract_start, contract_end,
  primary_cpv, country, region, sector, source_url,
  status::text AS status, created_at, updated_at
FROM public.tenders_fts
UNION ALL
SELECT
  source, external_id, title, description, buyer_name,
  NULL::text AS buyer_type, NULL::text AS notice_type,
  procedure_type, value_min, value_max, currency,
  published_at, deadline_at,
  NULL::timestamptz AS award_date,
  contract_start::date AS contract_start,
  contract_end::date AS contract_end,
  primary_cpv, country, region, NULL::text AS sector,
  source_url, status, created_at, NULL::timestamptz AS updated_at
FROM public.tenders_cf
UNION ALL
SELECT
  source, external_id, title, description, buyer_name,
  NULL::text AS buyer_type, notice_type, procedure_type,
  value_min, value_max, currency, published_at, deadline_at,
  NULL::timestamptz AS award_date, NULL::date AS contract_start, NULL::date AS contract_end,
  primary_cpv, country, region, NULL::text AS sector,
  source_url, status::text AS status, created_at, updated_at
FROM public.tenders_ted
UNION ALL
SELECT
  source, external_id, title, description, buyer_name,
  NULL::text AS buyer_type, NULL::text AS notice_type, NULL::text AS procedure_type,
  value_min, value_max, currency, published_at, deadline_at,
  NULL::timestamptz AS award_date, NULL::date AS contract_start, NULL::date AS contract_end,
  primary_cpv, country, NULL::text AS region, NULL::text AS sector,
  source_url, NULL::text AS status, created_at, NULL::timestamptz AS updated_at
FROM public.tenders_pcs;

GRANT SELECT ON public.tenders_master TO authenticated;