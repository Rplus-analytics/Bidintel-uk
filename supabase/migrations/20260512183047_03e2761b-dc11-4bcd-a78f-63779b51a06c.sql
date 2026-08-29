INSERT INTO public.raw_fts (ocid, published_date, payload, fetched_at)
SELECT 
  COALESCE(ocid, external_id) as ocid,
  published_at as published_date,
  raw_json as payload,
  created_at as fetched_at
FROM public.tenders_fts
WHERE raw_json IS NOT NULL
  AND COALESCE(ocid, external_id) IS NOT NULL
  AND COALESCE(ocid, external_id) NOT IN (SELECT ocid FROM public.raw_fts WHERE ocid IS NOT NULL)
ON CONFLICT (ocid) DO NOTHING;