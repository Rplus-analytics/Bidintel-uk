DROP INDEX IF EXISTS public.idx_raw_cf_published_date;
CREATE INDEX IF NOT EXISTS idx_backfill_state_completed_source ON public.backfill_state (completed, source);
CREATE INDEX IF NOT EXISTS idx_saved_bids_org_updated ON public.saved_bids (organisation_id, updated_at DESC);