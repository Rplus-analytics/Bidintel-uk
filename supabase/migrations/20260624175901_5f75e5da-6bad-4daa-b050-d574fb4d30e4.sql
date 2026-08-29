UPDATE public.notices n
SET status = t.status::text
FROM public.tenders t
WHERE n.source = t.source AND n.external_id = t.external_id
  AND t.source IN ('cf','fts')
  AND COALESCE(n.status,'') IN ('', 'unknown')
  AND t.status::text <> 'unknown';