CREATE TABLE IF NOT EXISTS public.cf_bulk_upload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_identifier text UNIQUE,
  ocid text,
  published_date timestamptz,
  payload jsonb,
  source text DEFAULT 'cf_bulk',
  fetched_at timestamptz DEFAULT now()
);

ALTER TABLE public.cf_bulk_upload ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cf_bulk_upload read for authed"
ON public.cf_bulk_upload
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX IF NOT EXISTS cf_bulk_upload_ocid_idx ON public.cf_bulk_upload(ocid);
CREATE INDEX IF NOT EXISTS cf_bulk_upload_published_date_idx ON public.cf_bulk_upload(published_date);