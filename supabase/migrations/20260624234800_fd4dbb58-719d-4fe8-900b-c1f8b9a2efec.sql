DROP FUNCTION IF EXISTS public.search_tenders_hybrid(vector, text, integer, timestamp with time zone, text, text[], text[], double precision, double precision, double precision, text[], text[], boolean);

CREATE OR REPLACE FUNCTION public.search_tenders_hybrid(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 200,
  since_ts timestamp with time zone DEFAULT (now() - interval '365 days'),
  cpv_prefix text DEFAULT NULL,
  expansion_terms text[] DEFAULT NULL,
  cpv_prefixes text[] DEFAULT NULL,
  w_keyword double precision DEFAULT 0.5,
  w_cpv double precision DEFAULT 0.3,
  w_semantic double precision DEFAULT 0.2,
  core_terms text[] DEFAULT NULL,
  context_terms text[] DEFAULT NULL,
  active_only boolean DEFAULT true
)
RETURNS TABLE(
  id uuid, source text, external_id text, title text, buyer_name text,
  semantic_score double precision, keyword_score double precision, cpv_score double precision,
  bonus_score double precision, penalty_score double precision, hybrid_score double precision,
  matched_terms text[], matched_cpvs text[],
  source_bonus double precision, status_bonus double precision,
  derived_status text, final_display_status text, match_quality text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  pool_size int := least(greatest(match_count, 200), 500);
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
      AND (NOT active_only OR t.derived_status IS NULL OR t.derived_status IN ('active','planned','unknown'))
    ORDER BY t.embedding <=> query_embedding LIMIT pool_size
  ),
  kw AS (
    SELECT t.id AS tid FROM public.tenders t
    WHERE tsq IS NOT NULL AND t.search_tsv @@ tsq AND t.published_at >= since_ts
      AND (NOT active_only OR t.derived_status IS NULL OR t.derived_status IN ('active','planned','unknown'))
    ORDER BY ts_rank(t.search_tsv, tsq) DESC LIMIT pool_size
  ),
  cpv AS (
    SELECT t.id AS tid FROM public.tenders t
    WHERE array_length(all_cpvs,1) > 0 AND t.published_at >= since_ts
      AND (NOT active_only OR t.derived_status IS NULL OR t.derived_status IN ('active','planned','unknown'))
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
      t.derived_status AS s_derived,
      CASE
        WHEN t.derived_status IS NOT NULL AND t.derived_status <> 'unknown' THEN t.derived_status
        WHEN t.award_date IS NOT NULL THEN 'complete'
        WHEN t.deadline_at IS NOT NULL AND t.deadline_at > now() THEN 'active'
        WHEN t.deadline_at IS NOT NULL THEN 'complete'
        WHEN t.published_at IS NOT NULL AND t.published_at < now() - interval '180 days' THEN 'complete'
        ELSE 'unknown'
      END AS s_status,
      t.deadline_at AS s_deadline,
      lower(coalesce(t.title,'') || ' ' || coalesce(t.buyer_name,'') || ' ' || coalesce(t.description,'')) AS hay,
      (CASE WHEN t.embedding IS NULL OR query_embedding IS NULL THEN 0
            ELSE 1 - (t.embedding <=> query_embedding) END)::float AS s_sem,
      (CASE
        WHEN tsq IS NULL THEN 0
        WHEN t.search_tsv @@ tsq THEN least(1.0, ts_rank(t.search_tsv, tsq)::float * 5)
        ELSE 0
      END)::float AS s_kw,
      -- CPV score now weighted by prefix specificity: short parent prefixes
      -- (e.g. "72") are treated as low-confidence and capped, while child
      -- CPVs (>=5 digit overlap) get the full bonus. This stops parent CPVs
      -- like 72000000 dominating unrelated searches.
      (
        SELECT coalesce(max(
          CASE
            WHEN match_kind = 'primary' AND prefix_len >= 5 THEN 1.0
            WHEN match_kind = 'primary' AND prefix_len = 4  THEN 0.70
            WHEN match_kind = 'primary' AND prefix_len = 3  THEN 0.40
            WHEN match_kind = 'primary'                      THEN 0.20
            WHEN match_kind = 'code'    AND prefix_len >= 5 THEN 0.70
            WHEN match_kind = 'code'    AND prefix_len = 4  THEN 0.50
            WHEN match_kind = 'code'    AND prefix_len = 3  THEN 0.30
            ELSE 0.15
          END
        ), 0)
        FROM (
          SELECT 'primary'::text AS match_kind, length(p) AS prefix_len
          FROM unnest(all_cpvs) p
          WHERE coalesce(t.primary_cpv,'') LIKE p || '%'
          UNION ALL
          SELECT 'code'::text, length(p)
          FROM unnest(all_cpvs) p
          WHERE EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE p || '%')
        ) m
      )::float AS s_cpv,
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
      (CASE
         WHEN e.s_source IN ('cf','contracts_finder','contracts-finder') THEN 0.35
         WHEN e.s_source IN ('fts','find_a_tender','find-a-tender') THEN 0.35
         WHEN e.s_source IN ('contracts_scotland','contracts-scotland','sell2wales','etenders-ireland','etenders-ni') THEN 0.25
         WHEN e.s_source IN ('ted','ted-eu','ted_eu') THEN -0.10
         ELSE 0
       END)::float AS src_bonus,
      (CASE
         WHEN (e.core_hits_title > 0 OR e.s_cpv >= 1.0 OR e.s_kw >= 0.2) THEN
           CASE
             WHEN e.s_status = 'active' AND e.s_deadline IS NOT NULL
                  AND e.s_deadline BETWEEN now() AND now() + interval '14 days' THEN 0.35
             WHEN e.s_status = 'active' THEN 0.40
             WHEN e.s_status = 'planned' THEN 0.25
             ELSE 0
           END
         ELSE
           CASE WHEN e.s_status IN ('active','planned') THEN 0.10 ELSE 0 END
       END)::float AS st_bonus,
      (CASE WHEN e.s_cpv >= 1.0 THEN 0.5
            WHEN e.s_cpv >= 0.7 THEN 0.10
            ELSE 0 END
       + CASE WHEN e.core_hits_title > 0 THEN 0.4
              WHEN e.core_hits > 0 THEN 0.15
              ELSE 0 END
      )::float AS rel_bonus,
      (CASE WHEN e.core_hits = 0 AND e.s_cpv = 0 AND e.ctx_hits > 0 THEN 0.45 ELSE 0 END
       + CASE WHEN e.s_cpv > 0 AND e.s_cpv < 1.0 AND e.core_hits_title = 0 AND e.s_kw < 0.1 THEN 0.40 ELSE 0 END
       + CASE e.s_status
           WHEN 'complete'  THEN 0.50
           WHEN 'cancelled' THEN 1.00
           WHEN 'withdrawn' THEN 1.00
           WHEN 'unknown'   THEN 0.20
           ELSE 0
         END
      )::float AS penalty,
      (CASE
         WHEN e.core_hits_title > 0 AND (e.s_cpv >= 1.0 OR e.s_kw >= 0.4) THEN 'strong'
         WHEN e.core_hits_title > 0 OR e.s_cpv >= 1.0 OR e.s_kw >= 0.3 THEN 'good'
         WHEN e.s_cpv >= 0.7 OR e.core_hits > 0 OR e.s_kw >= 0.15 THEN 'medium'
         ELSE 'weak'
       END) AS quality
    FROM enriched e
  )
  SELECT
    f.s_id, f.s_source, f.s_ext, f.s_title, f.s_buyer,
    f.s_sem, f.s_kw, f.s_cpv,
    (f.src_bonus + f.st_bonus + f.rel_bonus)::float AS bonus,
    f.penalty,
    (f.s_kw * w_keyword + f.s_cpv * w_cpv + f.s_sem * w_semantic + f.src_bonus + f.st_bonus + f.rel_bonus - f.penalty)::float AS hybrid,
    f.s_mterms, f.s_mcpvs,
    f.src_bonus, f.st_bonus,
    f.s_derived, f.s_status, f.quality
  FROM final f
  WHERE (f.s_kw + f.s_cpv + f.s_sem) > 0
  ORDER BY (f.s_kw * w_keyword + f.s_cpv * w_cpv + f.s_sem * w_semantic + f.src_bonus + f.st_bonus + f.rel_bonus - f.penalty) DESC
  LIMIT match_count;
END;
$function$;