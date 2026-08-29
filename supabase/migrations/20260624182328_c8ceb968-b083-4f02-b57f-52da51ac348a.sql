
UPDATE public.tenders SET source_status = COALESCE(
  NULLIF(raw_json->'tender'->>'status', ''),
  NULLIF(status::text, '')
)
WHERE source = 'cf' AND source_status IS NULL;
