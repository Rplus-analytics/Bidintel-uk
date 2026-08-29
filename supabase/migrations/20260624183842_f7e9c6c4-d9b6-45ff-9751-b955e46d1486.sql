
CREATE OR REPLACE FUNCTION public.search_tenders_hybrid(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 200,
  since_ts timestamp with time zone DEFAULT (now() - '365 days'::interval),
  cpv_prefix text DEFAULT NULL::text
)
RETURNS TABLE(id uuid, source text, external_id text, title text, buyer_name text,
              semantic_score double precision, keyword_score double precision,
              cpv_score double precision, hybrid_score double precision)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  pool_size int := least(greatest(match_count, 200), 400);
  tsq tsquery := NULL;
  qtext text := lower(coalesce(query_text, ''));
BEGIN
  IF qtext <> '' THEN
    BEGIN
      tsq := plainto_tsquery('english', query_text);
    EXCEPTION WHEN OTHERS THEN
      tsq := NULL;
    END;
  END IF;

  RETURN QUERY
  WITH sem AS (
    SELECT t.id AS tid
    FROM public.tenders t
    WHERE query_embedding IS NOT NULL AND t.embedding IS NOT NULL AND t.published_at >= since_ts
    ORDER BY t.embedding <=> query_embedding LIMIT pool_size
  ),
  kw AS (
    SELECT t.id AS tid FROM public.tenders t
    WHERE tsq IS NOT NULL AND t.search_tsv @@ tsq AND t.published_at >= since_ts
    ORDER BY ts_rank(t.search_tsv, tsq) DESC LIMIT pool_size
  ),
  cpv AS (
    SELECT t.id AS tid FROM public.tenders t
    WHERE cpv_prefix IS NOT NULL AND cpv_prefix <> '' AND t.published_at >= since_ts
      AND (coalesce(t.primary_cpv, '') LIKE cpv_prefix || '%'
           OR EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE cpv_prefix || '%'))
    LIMIT pool_size
  ),
  pool AS (
    SELECT tid FROM sem UNION SELECT tid FROM kw UNION SELECT tid FROM cpv
  ),
  scored AS (
    SELECT
      t.id AS s_id, t.source AS s_source, t.external_id AS s_ext,
      t.title AS s_title, t.buyer_name AS s_buyer,
      (CASE WHEN t.embedding IS NULL OR query_embedding IS NULL THEN 0
            ELSE 1 - (t.embedding <=> query_embedding) END)::float AS s_sem,
      (CASE
        WHEN tsq IS NULL THEN 0
        WHEN t.search_tsv @@ tsq THEN least(1.0, ts_rank(t.search_tsv, tsq)::float * 5)
        WHEN qtext <> '' AND position(qtext IN lower(coalesce(t.title,'') || ' ' || coalesce(t.buyer_name,''))) > 0 THEN 0.4
        ELSE 0
      END)::float AS s_kw,
      (CASE
        WHEN cpv_prefix IS NULL OR cpv_prefix = '' THEN 0
        WHEN coalesce(t.primary_cpv, '') LIKE cpv_prefix || '%' THEN 1.0
        WHEN EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE cpv_prefix || '%') THEN 0.7
        ELSE 0
      END)::float AS s_cpv
    FROM public.tenders t
    WHERE t.id IN (SELECT p.tid FROM pool p)
  )
  SELECT
    s.s_id, s.s_source, s.s_ext, s.s_title, s.s_buyer,
    s.s_sem, s.s_kw, s.s_cpv,
    (s.s_kw * 0.4 + s.s_cpv * 0.3 + s.s_sem * 0.3)::float AS hybrid
  FROM scored s
  WHERE (s.s_kw + s.s_cpv + s.s_sem) > 0
  ORDER BY (s.s_kw * 0.4 + s.s_cpv * 0.3 + s.s_sem * 0.3) DESC
  LIMIT match_count;
END;
$function$;

-- Supporting indexes (no-ops if they already exist)
CREATE INDEX IF NOT EXISTS idx_tenders_published_at ON public.tenders(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_search_tsv ON public.tenders USING GIN(search_tsv);
CREATE INDEX IF NOT EXISTS idx_tenders_primary_cpv ON public.tenders(primary_cpv text_pattern_ops);
