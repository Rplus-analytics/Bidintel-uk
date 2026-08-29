
-- Kill any lingering refreshers
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND (query ILIKE '%tenders_cf_full_mat%' OR query ILIKE '%refresh_tenders_cf_full_mat%');

-- Unschedule any cron jobs that touch it
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE command ILIKE '%tenders_cf_full_mat%' LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

DROP MATERIALIZED VIEW IF EXISTS public.tenders_cf_full_mat;
