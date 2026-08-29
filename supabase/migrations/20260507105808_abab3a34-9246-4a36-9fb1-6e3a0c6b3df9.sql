CREATE TABLE IF NOT EXISTS public.raw_contracts_finder (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocid text NOT NULL,
  release_id text NOT NULL,
  published_date timestamptz,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ocid, release_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_cf_ocid ON public.raw_contracts_finder(ocid);
CREATE INDEX IF NOT EXISTS idx_raw_cf_published ON public.raw_contracts_finder(published_date DESC);

ALTER TABLE public.raw_contracts_finder ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_contracts_finder read for authed"
  ON public.raw_contracts_finder
  FOR SELECT
  TO authenticated
  USING (true);
