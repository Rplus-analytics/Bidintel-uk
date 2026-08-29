
CREATE MATERIALIZED VIEW IF NOT EXISTS public.tenders_cf_full_mat AS
SELECT * FROM public.tenders_cf_full
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS tenders_cf_full_mat_pk
  ON public.tenders_cf_full_mat (source, notice_id);
CREATE INDEX IF NOT EXISTS tenders_cf_full_mat_ocid_idx ON public.tenders_cf_full_mat (ocid);
CREATE INDEX IF NOT EXISTS tenders_cf_full_mat_published_date_idx ON public.tenders_cf_full_mat (published_date);
CREATE INDEX IF NOT EXISTS tenders_cf_full_mat_region_idx ON public.tenders_cf_full_mat (region);
CREATE INDEX IF NOT EXISTS tenders_cf_full_mat_sector_idx ON public.tenders_cf_full_mat (sector);
CREATE INDEX IF NOT EXISTS tenders_cf_full_mat_sme_idx ON public.tenders_cf_full_mat (suitable_for_sme);

GRANT SELECT ON public.tenders_cf_full_mat TO authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule('refresh-tenders-cf-full');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-tenders-cf-full',
  '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.tenders_cf_full_mat$$
);

-- Also schedule a one-time initial populate in 1 minute (non-concurrent for first load)
SELECT cron.schedule(
  'initial-populate-tenders-cf-full',
  '* * * * *',
  $$DO $body$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenders_cf_full_mat LIMIT 1) THEN
      REFRESH MATERIALIZED VIEW public.tenders_cf_full_mat;
    ELSE
      PERFORM cron.unschedule('initial-populate-tenders-cf-full');
    END IF;
  END
  $body$;$$
);
