ALTER TABLE public.backfill_state
ADD COLUMN IF NOT EXISTS day_offset integer NOT NULL DEFAULT 0;