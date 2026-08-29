UPDATE public.tenders t
SET source_url = 'https://www.contractsfinder.service.gov.uk/Notice/' || regexp_replace(r.release_id, '-\d+$', '')
FROM public.raw_contracts_finder r
WHERE t.source = 'cf'
  AND (t.source_url IS NULL OR t.source_url = '')
  AND r.ocid = t.ocid
  AND regexp_replace(r.release_id, '-\d+$', '') ~* '^[0-9a-f-]{20,}$';