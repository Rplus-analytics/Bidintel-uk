
CREATE MATERIALIZED VIEW public.tenders_cf_full_mat AS
SELECT
  'cf'::text AS source,
  payload->>'ocid' AS external_id,
  payload->'tender'->>'title' AS title,
  payload->'tender'->>'description' AS description,
  payload->'buyer'->>'name' AS buyer_name,
  NULLIF(payload->'tender'->'minValue'->>'amount','')::numeric AS value_min,
  NULLIF(payload->'tender'->'value'->>'amount','')::numeric AS value_max,
  payload->'tender'->>'status' AS status,
  public.safe_ts(payload->'tender'->>'datePublished') AS published_at,
  public.safe_ts(payload->'tender'->'tenderPeriod'->>'endDate') AS deadline_at,
  payload->'tender'->'classification'->>'id' AS primary_cpv,
  payload->'parties'->0->'address'->>'countryName' AS country,
  payload->'parties'->0->'contactPoint'->>'email' AS contact_email,
  payload->'parties'->0->'contactPoint'->>'name' AS contact_name,
  payload AS raw_json,
  published_date AS created_at
FROM public.raw_contracts_finder
WITH NO DATA;

CREATE INDEX ON public.tenders_cf_full_mat (external_id);
CREATE INDEX ON public.tenders_cf_full_mat (published_at);
CREATE INDEX ON public.tenders_cf_full_mat (primary_cpv);
CREATE INDEX ON public.tenders_cf_full_mat (country);

GRANT SELECT ON public.tenders_cf_full_mat TO authenticated;

SELECT cron.schedule(
  'refresh-tenders-cf-full-mat',
  '0 * * * *',
  'REFRESH MATERIALIZED VIEW public.tenders_cf_full_mat'
);

-- Kick off initial population in the background via pg_cron one-shot (runs in ~1 minute)
SELECT cron.schedule(
  'initial-populate-tenders-cf-full-mat',
  '* * * * *',
  $$DO $body$
  BEGIN
    IF NOT (SELECT relispopulated FROM pg_class WHERE relname = 'tenders_cf_full_mat') THEN
      REFRESH MATERIALIZED VIEW public.tenders_cf_full_mat;
    END IF;
    PERFORM cron.unschedule('initial-populate-tenders-cf-full-mat');
  END
  $body$;$$
);
