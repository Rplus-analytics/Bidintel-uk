UPDATE public.tenders t
SET status = (
  CASE lower(t.raw_json->'tender'->>'status')
    WHEN 'active' THEN 'active' WHEN 'complete' THEN 'complete' WHEN 'completed' THEN 'complete'
    WHEN 'cancelled' THEN 'cancelled' WHEN 'canceled' THEN 'cancelled' WHEN 'withdrawn' THEN 'withdrawn'
    WHEN 'planned' THEN 'planned' WHEN 'planning' THEN 'planned' WHEN 'unsuccessful' THEN 'complete'
    ELSE 'unknown'
  END
)::tender_status
WHERE t.source = 'cf' AND t.status = 'unknown'
  AND t.raw_json->'tender'->>'status' IS NOT NULL;