CREATE OR REPLACE FUNCTION public.backfill_status_all(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  WITH batch AS (
    SELECT id FROM public.tenders
    WHERE derived_status IS NULL
    LIMIT p_limit
  ), upd AS (
    UPDATE public.tenders t SET
      source_status = COALESCE(
        t.source_status,
        CASE t.source
          WHEN 'fts' THEN NULLIF(t.raw_json->'tender'->>'status','')
          WHEN 'ted' THEN NULLIF(t.raw_json->>'notice-type','')
          WHEN 'contracts_scotland' THEN NULLIF(t.status::text,'')
          WHEN 'cf'  THEN NULLIF(t.raw_json->'tender'->>'status','')
          ELSE NULLIF(t.status::text,'')
        END
      ),
      derived_status = CASE
        WHEN t.source = 'fts' AND (t.raw_json->>'tag') ILIKE '%tendercancellation%' THEN 'cancelled'
        WHEN t.source = 'fts' AND ((t.raw_json->>'tag') ILIKE '%withdrawn%' OR (t.raw_json->>'tag') ILIKE '%tenderwithdrawal%') THEN 'withdrawn'
        WHEN t.source = 'fts' AND ((t.raw_json->>'tag') ILIKE '%award%' OR (t.raw_json->>'tag') ILIKE '%contract%') THEN 'complete'
        WHEN t.source = 'fts' AND (t.raw_json->>'tag') ILIKE '%planning%' THEN 'planned'
        WHEN t.source = 'ted' AND lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'cancel%' THEN 'cancelled'
        WHEN t.source = 'ted' AND lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'withdraw%' THEN 'withdrawn'
        WHEN t.source = 'ted' AND lower(coalesce(t.raw_json->>'notice-type','')) IN ('can','can-soc','can-modif','can-desg','can-tend','compl') THEN 'complete'
        WHEN t.source = 'ted' AND lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'pin%' THEN 'planned'
        WHEN public.normalize_status_string(t.status::text) IS NOT NULL THEN public.normalize_status_string(t.status::text)
        WHEN t.award_date IS NOT NULL THEN 'complete'
        WHEN t.deadline_at IS NOT NULL AND t.deadline_at > now() THEN 'active'
        WHEN t.deadline_at IS NOT NULL THEN 'complete'
        WHEN t.published_at IS NOT NULL AND t.published_at < now() - interval '180 days' THEN 'complete'
        WHEN t.source = 'ted' AND lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'cn%' THEN 'active'
        ELSE 'unknown'
      END
    FROM batch WHERE t.id = batch.id
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $function$;