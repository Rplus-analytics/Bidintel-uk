CREATE TABLE IF NOT EXISTS public.backfill_state (
  source text PRIMARY KEY,
  year int NOT NULL,
  month0 int NOT NULL CHECK (month0 BETWEEN 0 AND 11),
  completed boolean NOT NULL DEFAULT false,
  last_run_at timestamptz
);

ALTER TABLE public.backfill_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backfill_state read for authed"
ON public.backfill_state FOR SELECT
TO authenticated USING (true);