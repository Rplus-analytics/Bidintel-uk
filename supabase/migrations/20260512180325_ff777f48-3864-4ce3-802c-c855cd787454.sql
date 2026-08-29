CREATE TABLE IF NOT EXISTS public.raw_fts (
  id uuid primary key default gen_random_uuid(),
  ocid text unique,
  release_id text,
  published_date timestamptz,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

ALTER TABLE public.raw_fts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_fts read for authed"
ON public.raw_fts FOR SELECT
TO authenticated
USING (true);

CREATE INDEX IF NOT EXISTS idx_raw_fts_published_date ON public.raw_fts(published_date);

-- Backfill existing tenders_fts rows into raw_fts
INSERT INTO public.raw_fts (ocid, release_id, published_date, payload, fetched_at)
SELECT
  COALESCE(ocid, external_id),
  external_id,
  published_at,
  raw_json,
  COALESCE(created_at, now())
FROM public.tenders_fts
WHERE raw_json IS NOT NULL
  AND COALESCE(ocid, external_id) IS NOT NULL
ON CONFLICT (ocid) DO NOTHING;