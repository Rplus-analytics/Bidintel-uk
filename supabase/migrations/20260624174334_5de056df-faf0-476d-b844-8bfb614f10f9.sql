
CREATE OR REPLACE FUNCTION public.search_tenders_hybrid(
  query_embedding vector(1536),
  query_text text,
  match_count int DEFAULT 200,
  since_ts timestamptz DEFAULT (now() - interval '365 days'),
  cpv_prefix text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  source text,
  external_id text,
  title text,
  buyer_name text,
  semantic_score float,
  keyword_score float,
  cpv_score float,
  hybrid_score float
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  pool_size int := greatest(match_count * 2, 400);
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
    SELECT t.id
    FROM public.tenders t
    WHERE query_embedding IS NOT NULL
      AND t.embedding IS NOT NULL
      AND t.published_at >= since_ts
    ORDER BY t.embedding <=> query_embedding
    LIMIT pool_size
  ),
  kw AS (
    SELECT t.id
    FROM public.tenders t
    WHERE tsq IS NOT NULL
      AND t.search_tsv @@ tsq
      AND t.published_at >= since_ts
    ORDER BY ts_rank(t.search_tsv, tsq) DESC
    LIMIT pool_size
  ),
  cpv AS (
    SELECT t.id
    FROM public.tenders t
    WHERE cpv_prefix IS NOT NULL AND cpv_prefix <> ''
      AND t.published_at >= since_ts
      AND (coalesce(t.primary_cpv, '') LIKE cpv_prefix || '%'
           OR EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE cpv_prefix || '%'))
    LIMIT pool_size
  ),
  pool AS (
    SELECT id FROM sem
    UNION
    SELECT id FROM kw
    UNION
    SELECT id FROM cpv
  ),
  scored AS (
    SELECT
      t.id, t.source, t.external_id, t.title, t.buyer_name,
      CASE WHEN t.embedding IS NULL OR query_embedding IS NULL THEN 0
           ELSE 1 - (t.embedding <=> query_embedding) END AS semantic_score,
      CASE
        WHEN tsq IS NULL THEN 0
        WHEN t.search_tsv @@ tsq THEN least(1.0, ts_rank(t.search_tsv, tsq)::float * 5)
        WHEN qtext <> '' AND
             position(qtext IN lower(coalesce(t.title,'') || ' ' || coalesce(t.buyer_name,''))) > 0
          THEN 0.4
        ELSE 0
      END AS keyword_score,
      CASE
        WHEN cpv_prefix IS NULL OR cpv_prefix = '' THEN 0
        WHEN coalesce(t.primary_cpv, '') LIKE cpv_prefix || '%' THEN 1.0
        WHEN EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE cpv_prefix || '%') THEN 0.7
        ELSE 0
      END AS cpv_score
    FROM public.tenders t
    WHERE t.id IN (SELECT id FROM pool)
  )
  SELECT
    s.id, s.source, s.external_id, s.title, s.buyer_name,
    s.semantic_score, s.keyword_score, s.cpv_score,
    (s.keyword_score * 0.4 + s.cpv_score * 0.3 + s.semantic_score * 0.3) AS hybrid_score
  FROM scored s
  WHERE (s.keyword_score + s.cpv_score + s.semantic_score) > 0
  ORDER BY hybrid_score DESC
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_tenders_hybrid(vector, text, int, timestamptz, text) TO authenticated, anon, service_role;
