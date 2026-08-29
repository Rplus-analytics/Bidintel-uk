DROP FUNCTION IF EXISTS public.search_tenders_hybrid(vector,text,integer,timestamp with time zone,text,text[],text[],double precision,double precision,double precision,text[],text[]);

CREATE OR REPLACE FUNCTION public.search_tenders_hybrid(
  query_embedding vector, query_text text,
  match_count integer DEFAULT 200,
  since_ts timestamp with time zone DEFAULT (now() - '365 days'::interval),
  cpv_prefix text DEFAULT NULL,
  expansion_terms text[] DEFAULT NULL,
  cpv_prefixes text[] DEFAULT NULL,
  w_keyword double precision DEFAULT 0.5,
  w_cpv double precision DEFAULT 0.3,
  w_semantic double precision DEFAULT 0.2,
  core_terms text[] DEFAULT NULL,
  context_terms text[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid, source text, external_id text, title text, buyer_name text,
  semantic_score double precision, keyword_score double precision, cpv_score double precision,
  bonus_score double precision, penalty_score double precision,
  hybrid_score double precision,
  matched_terms text[], matched_cpvs text[]
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  pool_size int := least(greatest(match_count, 200), 400);
  tsq tsquery := NULL;
  all_terms text[];
  all_cpvs text[];
  core_lc text[];
  ctx_lc text[];
  expanded_query text;
BEGIN
  all_terms := ARRAY(
    SELECT DISTINCT lower(t) FROM unnest(
      coalesce(expansion_terms, ARRAY[]::text[]) || ARRAY[coalesce(query_text,'')]
    ) AS t WHERE coalesce(trim(t),'') <> ''
  );
  all_cpvs := ARRAY(
    SELECT DISTINCT c FROM unnest(
      coalesce(cpv_prefixes, ARRAY[]::text[]) ||
      CASE WHEN coalesce(cpv_prefix,'') <> '' THEN ARRAY[cpv_prefix] ELSE ARRAY[]::text[] END
    ) AS c WHERE coalesce(trim(c),'') <> ''
  );
  core_lc := ARRAY(SELECT DISTINCT lower(t) FROM unnest(coalesce(core_terms, ARRAY[]::text[])) t WHERE coalesce(trim(t),'') <> '');
  ctx_lc  := ARRAY(SELECT DISTINCT lower(t) FROM unnest(coalesce(context_terms, ARRAY[]::text[])) t WHERE coalesce(trim(t),'') <> '');

  expanded_query := array_to_string(all_terms, ' ');
  IF expanded_query <> '' THEN
    BEGIN tsq := plainto_tsquery('english', expanded_query);
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
  pool AS (SELECT tid FROM sem UNION SELECT tid FROM kw UNION SELECT tid FROM cpv),
  scored AS (
    SELECT
      t.id AS s_id, t.source AS s_source, t.external_id AS s_ext,
      t.title AS s_title, t.buyer_name AS s_buyer,
      lower(coalesce(t.title,'') || ' ' || coalesce(t.buyer_name,'') || ' ' || coalesce(t.description,'')) AS hay,
      (CASE WHEN t.embedding IS NULL OR query_embedding IS NULL THEN 0
            ELSE 1 - (t.embedding <=> query_embedding) END)::float AS s_sem,
      (CASE
        WHEN tsq IS NULL THEN 0
        WHEN t.search_tsv @@ tsq THEN least(1.0, ts_rank(t.search_tsv, tsq)::float * 5)
        ELSE 0
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
  ),
  enriched AS (
    SELECT s.*,
      (SELECT count(*) FROM unnest(core_lc) ct WHERE position(ct IN s.hay) > 0)::int AS core_hits,
      (SELECT count(*) FROM unnest(ctx_lc) ct WHERE position(ct IN s.hay) > 0)::int AS ctx_hits,
      (SELECT count(*) FROM unnest(core_lc) ct WHERE position(ct IN lower(coalesce(s.s_title,''))) > 0)::int AS core_hits_title
    FROM scored s
  ),
  final AS (
    SELECT e.*,
      (CASE WHEN e.s_cpv >= 1.0 THEN 0.5
            WHEN e.s_cpv >= 0.7 THEN 0.3
            ELSE 0 END
       + CASE WHEN e.core_hits_title > 0 THEN 0.4
              WHEN e.core_hits > 0 THEN 0.2
              ELSE 0 END)::float AS bonus,
      (CASE WHEN e.core_hits = 0 AND e.s_cpv = 0 AND e.ctx_hits > 0 THEN 0.45 ELSE 0 END)::float AS penalty
    FROM enriched e
  )
  SELECT
    f.s_id, f.s_source, f.s_ext, f.s_title, f.s_buyer,
    f.s_sem, f.s_kw, f.s_cpv,
    f.bonus, f.penalty,
    greatest(0, (f.s_kw * w_keyword + f.s_cpv * w_cpv + f.s_sem * w_semantic + f.bonus - f.penalty))::float AS hybrid,
    f.s_mterms, f.s_mcpvs
  FROM final f
  WHERE (f.s_kw + f.s_cpv + f.s_sem + f.bonus) > 0
    AND NOT (f.core_hits = 0 AND f.s_cpv = 0 AND f.ctx_hits > 0 AND array_length(core_lc,1) > 0
             AND EXISTS (SELECT 1 FROM final f2 WHERE f2.core_hits > 0 OR f2.s_cpv > 0))
  ORDER BY greatest(0, (f.s_kw * w_keyword + f.s_cpv * w_cpv + f.s_sem * w_semantic + f.bonus - f.penalty)) DESC
  LIMIT match_count;
END;
$function$;