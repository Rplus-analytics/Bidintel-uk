
CREATE OR REPLACE FUNCTION public.search_tenders_hybrid(
  query_embedding vector,
  query_text text,
  match_count int DEFAULT 200,
  since_ts timestamptz DEFAULT (now() - interval '365 days'),
  cpv_prefix text DEFAULT NULL,
  expansion_terms text[] DEFAULT NULL,
  cpv_prefixes text[] DEFAULT NULL,
  w_keyword float DEFAULT 0.5,
  w_cpv float DEFAULT 0.3,
  w_semantic float DEFAULT 0.2
)
RETURNS TABLE(
  id uuid, source text, external_id text, title text, buyer_name text,
  semantic_score float, keyword_score float, cpv_score float, hybrid_score float,
  matched_terms text[], matched_cpvs text[]
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $$
DECLARE
  pool_size int := least(greatest(match_count, 200), 400);
  tsq tsquery := NULL;
  qtext text := lower(coalesce(query_text, ''));
  all_terms text[];
  all_cpvs text[];
  expanded_query text;
BEGIN
  -- Build full term list (original + expansions, deduped, lowercase)
  all_terms := ARRAY(
    SELECT DISTINCT lower(t) FROM unnest(
      coalesce(expansion_terms, ARRAY[]::text[]) || ARRAY[coalesce(query_text,'')]
    ) AS t WHERE coalesce(trim(t),'') <> ''
  );

  -- Build CPV list (single prefix + array, deduped)
  all_cpvs := ARRAY(
    SELECT DISTINCT c FROM unnest(
      coalesce(cpv_prefixes, ARRAY[]::text[]) ||
      CASE WHEN coalesce(cpv_prefix,'') <> '' THEN ARRAY[cpv_prefix] ELSE ARRAY[]::text[] END
    ) AS c WHERE coalesce(trim(c),'') <> ''
  );

  expanded_query := array_to_string(all_terms, ' ');
  IF expanded_query <> '' THEN
    BEGIN
      tsq := plainto_tsquery('english', expanded_query);
    EXCEPTION WHEN OTHERS THEN tsq := NULL; END;
  END IF;

  RETURN QUERY
  WITH sem AS (
    SELECT t.id AS tid FROM public.tenders t
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
    WHERE array_length(all_cpvs,1) > 0 AND t.published_at >= since_ts
      AND EXISTS (
        SELECT 1 FROM unnest(all_cpvs) p
        WHERE coalesce(t.primary_cpv,'') LIKE p || '%'
           OR EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE p || '%')
      )
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
        ELSE (
          SELECT CASE WHEN count(*) > 0 THEN 0.4 ELSE 0 END
          FROM unnest(all_terms) term
          WHERE position(term IN lower(coalesce(t.title,'') || ' ' || coalesce(t.buyer_name,'') || ' ' || coalesce(t.description,''))) > 0
        )
      END)::float AS s_kw,
      (CASE
        WHEN array_length(all_cpvs,1) IS NULL THEN 0
        WHEN EXISTS (SELECT 1 FROM unnest(all_cpvs) p WHERE coalesce(t.primary_cpv,'') LIKE p || '%') THEN 1.0
        WHEN EXISTS (
          SELECT 1 FROM unnest(all_cpvs) p
          JOIN unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c ON c LIKE p || '%'
        ) THEN 0.7
        ELSE 0
      END)::float AS s_cpv,
      -- which input terms appear in the row (for explainability)
      ARRAY(
        SELECT DISTINCT term FROM unnest(all_terms) term
        WHERE position(term IN lower(coalesce(t.title,'') || ' ' || coalesce(t.buyer_name,'') || ' ' || coalesce(t.description,''))) > 0
      ) AS s_mterms,
      ARRAY(
        SELECT DISTINCT p FROM unnest(all_cpvs) p
        WHERE coalesce(t.primary_cpv,'') LIKE p || '%'
           OR EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE p || '%')
      ) AS s_mcpvs
    FROM public.tenders t
    WHERE t.id IN (SELECT p.tid FROM pool p)
  )
  SELECT
    s.s_id, s.s_source, s.s_ext, s.s_title, s.s_buyer,
    s.s_sem, s.s_kw, s.s_cpv,
    (s.s_kw * w_keyword + s.s_cpv * w_cpv + s.s_sem * w_semantic)::float AS hybrid,
    s.s_mterms, s.s_mcpvs
  FROM scored s
  WHERE (s.s_kw + s.s_cpv + s.s_sem) > 0
  ORDER BY (s.s_kw * w_keyword + s.s_cpv * w_cpv + s.s_sem * w_semantic) DESC
  LIMIT match_count;
END;
$$;
