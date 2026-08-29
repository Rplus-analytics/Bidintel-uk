
CREATE OR REPLACE FUNCTION public.normalize_status_string(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(s, ''))
    WHEN 'active'       THEN 'active'
    WHEN 'open'         THEN 'active'
    WHEN 'awarded'      THEN 'complete'
    WHEN 'complete'     THEN 'complete'
    WHEN 'completed'    THEN 'complete'
    WHEN 'unsuccessful' THEN 'complete'
    WHEN 'cancelled'    THEN 'cancelled'
    WHEN 'canceled'     THEN 'cancelled'
    WHEN 'withdrawn'    THEN 'withdrawn'
    WHEN 'planned'      THEN 'planned'
    WHEN 'planning'     THEN 'planned'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.compute_derived_status(
  p_source text,
  p_raw_json jsonb,
  p_notice_type text,
  p_source_status text,
  p_deadline_at timestamptz,
  p_award_date timestamptz
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  normalized text;
  tags text[];
  nt text;
  joined text;
BEGIN
  normalized := public.normalize_status_string(p_source_status);
  IF normalized IS NOT NULL THEN
    RETURN normalized;
  END IF;

  IF p_raw_json IS NOT NULL THEN
    BEGIN
      SELECT array_agg(lower(t)) INTO tags FROM (
        SELECT jsonb_array_elements_text(p_raw_json->'tag') AS t
        UNION ALL
        SELECT jsonb_array_elements_text(p_raw_json->'tender'->'tag') AS t
      ) x WHERE t IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      tags := NULL;
    END;
  END IF;
  joined := coalesce(array_to_string(tags, ','), '');

  nt := lower(coalesce(p_notice_type, p_raw_json->>'notice-type', ''));

  IF joined LIKE '%tendercancellation%' OR nt LIKE 'cancel%' THEN
    RETURN 'cancelled';
  END IF;
  IF joined LIKE '%withdrawn%' OR joined LIKE '%tenderwithdrawal%' OR nt LIKE 'withdraw%' THEN
    RETURN 'withdrawn';
  END IF;
  IF joined LIKE '%awardupdate%' OR joined LIKE '%contractupdate%'
     OR joined LIKE '%contractamendment%' OR joined LIKE '%contracttermination%'
     OR joined ~ '(^|,)award(,|$)' OR joined ~ '(^|,)contract(,|$)'
     OR nt LIKE 'can%' OR nt = 'compl' THEN
    RETURN 'complete';
  END IF;
  IF joined LIKE '%planning%' OR nt LIKE 'pin%' THEN
    RETURN 'planned';
  END IF;

  IF p_award_date IS NOT NULL THEN
    RETURN 'complete';
  END IF;
  IF p_deadline_at IS NOT NULL THEN
    IF p_deadline_at > now() THEN
      RETURN 'active';
    ELSE
      RETURN 'complete';
    END IF;
  END IF;

  IF nt LIKE 'cn%' THEN
    RETURN 'active';
  END IF;

  RETURN 'unknown';
END;
$$;

CREATE OR REPLACE FUNCTION public.tenders_set_derived_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.derived_status := public.compute_derived_status(
    NEW.source, NEW.raw_json, NEW.notice_type, NEW.source_status,
    NEW.deadline_at, NEW.award_date
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenders_derived_status ON public.tenders;
CREATE TRIGGER trg_tenders_derived_status
BEFORE INSERT OR UPDATE OF source_status, raw_json, notice_type, deadline_at, award_date, source
ON public.tenders
FOR EACH ROW EXECUTE FUNCTION public.tenders_set_derived_status();

CREATE OR REPLACE FUNCTION public.notices_set_derived_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.derived_status := public.compute_derived_status(
    NEW.source, NULL::jsonb, NEW.notice_type, NEW.source_status,
    NEW.deadline_date, NULL::timestamptz
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notices_derived_status ON public.notices;
CREATE TRIGGER trg_notices_derived_status
BEFORE INSERT OR UPDATE OF source_status, notice_type, deadline_date, source
ON public.notices
FOR EACH ROW EXECUTE FUNCTION public.notices_set_derived_status();

DROP VIEW IF EXISTS public.v_status_coverage;
CREATE VIEW public.v_status_coverage
WITH (security_invoker = on) AS
SELECT
  count(*)::int AS total,
  count(*) FILTER (WHERE source_status IS NOT NULL AND source_status <> '')::int AS with_source_status,
  count(*) FILTER (WHERE derived_status IS NOT NULL AND derived_status <> 'unknown')::int AS with_derived_status,
  count(*) FILTER (WHERE derived_status = 'unknown' OR derived_status IS NULL)::int AS unknown_count
FROM public.tenders;

DROP VIEW IF EXISTS public.v_status_coverage_by_source;
CREATE VIEW public.v_status_coverage_by_source
WITH (security_invoker = on) AS
SELECT
  source,
  count(*)::int AS total,
  count(*) FILTER (WHERE derived_status = 'unknown' OR derived_status IS NULL)::int AS unknown_count
FROM public.tenders
GROUP BY source
ORDER BY source;

GRANT SELECT ON public.v_status_coverage TO authenticated, anon;
GRANT SELECT ON public.v_status_coverage_by_source TO authenticated, anon;
