CREATE TABLE IF NOT EXISTS public.raw_ted (
  id uuid primary key default gen_random_uuid(),
  ocid text unique,
  published_date timestamptz,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

ALTER TABLE public.raw_ted ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_ted read for authed"
ON public.raw_ted FOR SELECT
TO authenticated
USING (true);

CREATE INDEX IF NOT EXISTS raw_ted_published_date_idx ON public.raw_ted(published_date);

INSERT INTO public.raw_ted (ocid, published_date, payload)
SELECT external_id, published_at, raw_json
FROM public.tenders_ted
WHERE external_id IS NOT NULL AND raw_json IS NOT NULL
ON CONFLICT (ocid) DO NOTHING;