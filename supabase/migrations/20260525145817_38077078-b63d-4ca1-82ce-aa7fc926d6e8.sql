ALTER TABLE public.backfill_state
  ADD COLUMN IF NOT EXISTS lock_until timestamp with time zone;
