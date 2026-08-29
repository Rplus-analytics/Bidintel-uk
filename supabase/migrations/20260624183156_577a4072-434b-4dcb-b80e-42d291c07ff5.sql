
CREATE OR REPLACE FUNCTION public.backfill_status_fts(p_limit int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH batch AS (
    SELECT id FROM public.tenders WHERE source='fts' AND source_status IS NULL LIMIT p_limit
  ), upd AS (
    UPDATE public.tenders t SET
      source_status = NULLIF(t.raw_json->'tender'->>'status',''),
      derived_status = CASE
        WHEN public.normalize_status_string(t.raw_json->'tender'->>'status') IS NOT NULL
          THEN public.normalize_status_string(t.raw_json->'tender'->>'status')
        WHEN (t.raw_json->>'tag') ILIKE '%tendercancellation%' THEN 'cancelled'
        WHEN (t.raw_json->>'tag') ILIKE '%withdrawn%' OR (t.raw_json->>'tag') ILIKE '%tenderwithdrawal%' THEN 'withdrawn'
        WHEN (t.raw_json->>'tag') ILIKE '%award%' OR (t.raw_json->>'tag') ILIKE '%contract%' THEN 'complete'
        WHEN (t.raw_json->>'tag') ILIKE '%planning%' THEN 'planned'
        WHEN t.award_date IS NOT NULL THEN 'complete'
        WHEN t.deadline_at > now() THEN 'active'
        WHEN t.deadline_at IS NOT NULL THEN 'complete'
        ELSE 'unknown'
      END
    FROM batch WHERE t.id = batch.id
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.backfill_status_ted(p_limit int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH batch AS (
    SELECT id FROM public.tenders WHERE source='ted' AND source_status IS NULL LIMIT p_limit
  ), upd AS (
    UPDATE public.tenders t SET
      source_status = NULLIF(t.raw_json->>'notice-type',''),
      derived_status = CASE
        WHEN lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'cancel%' THEN 'cancelled'
        WHEN lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'withdraw%' THEN 'withdrawn'
        WHEN lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'can%' THEN 'complete'
        WHEN lower(coalesce(t.raw_json->>'notice-type','')) = 'compl' THEN 'complete'
        WHEN lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'pin%' THEN 'planned'
        WHEN t.award_date IS NOT NULL THEN 'complete'
        WHEN t.deadline_at > now() THEN 'active'
        WHEN t.deadline_at IS NOT NULL THEN 'complete'
        WHEN lower(coalesce(t.raw_json->>'notice-type','')) LIKE 'cn%' THEN 'active'
        ELSE 'unknown'
      END
    FROM batch WHERE t.id = batch.id
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.backfill_status_cs()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH upd AS (
    UPDATE public.tenders SET
      source_status = NULLIF(status::text,''),
      derived_status = COALESCE(
        public.normalize_status_string(status::text),
        CASE WHEN award_date IS NOT NULL THEN 'complete'
             WHEN deadline_at > now() THEN 'active'
             WHEN deadline_at IS NOT NULL THEN 'complete'
             ELSE 'unknown' END
      )
    WHERE source='contracts_scotland' AND source_status IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.backfill_status_notices(p_limit int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH batch AS (
    SELECT id FROM public.notices WHERE source_status IS NULL LIMIT p_limit
  ), upd AS (
    UPDATE public.notices nx SET
      source_status = NULLIF(nx.status,''),
      derived_status = COALESCE(
        public.normalize_status_string(nx.status),
        CASE WHEN nx.deadline_date > now() THEN 'active'
             WHEN nx.deadline_date IS NOT NULL THEN 'complete'
             ELSE 'unknown' END
      )
    FROM batch WHERE nx.id = batch.id
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.backfill_status_fts(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_status_ted(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_status_cs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_status_notices(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_status_fts(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_status_ted(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_status_cs() TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_status_notices(int) TO service_role;
