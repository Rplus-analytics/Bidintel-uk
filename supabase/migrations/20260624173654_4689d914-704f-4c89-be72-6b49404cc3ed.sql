
-- Add embedding lifecycle columns
ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS embedding_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedding_error text;

-- Constrain status values
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_embedding_status_chk') THEN
    ALTER TABLE public.tenders
      ADD CONSTRAINT tenders_embedding_status_chk
      CHECK (embedding_status IN ('pending','processing','completed','failed','skipped'));
  END IF;
END $$;

-- Mark rows that somehow already have an embedding as completed
UPDATE public.tenders SET embedding_status = 'completed', embedded_at = COALESCE(embedded_at, now())
WHERE embedding IS NOT NULL AND embedding_status <> 'completed';

-- Index for worker picker (newest pending first)
CREATE INDEX IF NOT EXISTS tenders_embedding_status_pending_idx
  ON public.tenders (published_at DESC NULLS LAST)
  WHERE embedding_status = 'pending';

-- HNSW index for cosine similarity on the existing vector(1536) column
CREATE INDEX IF NOT EXISTS tenders_embedding_hnsw_idx
  ON public.tenders USING hnsw (embedding vector_cosine_ops);

-- Hybrid search RPC: returns external_id-based ranked results
-- keyword 40%, cpv 30%, semantic 30%
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      CASE WHEN coalesce(trim(query_text), '') = '' THEN NULL
           ELSE plainto_tsquery('english', query_text) END AS tsq,
      lower(coalesce(query_text, '')) AS qtext
  ),
  scored AS (
    SELECT
      t.id, t.source, t.external_id, t.title, t.buyer_name,
      -- semantic similarity (0..1); 0 if missing embedding
      CASE WHEN t.embedding IS NULL OR query_embedding IS NULL THEN 0
           ELSE 1 - (t.embedding <=> query_embedding) END AS semantic_score,
      -- keyword score: combine ts_rank and ilike fallback
      CASE
        WHEN (SELECT qtext FROM q) = '' THEN 0
        WHEN t.search_tsv IS NOT NULL AND (SELECT tsq FROM q) IS NOT NULL
          THEN least(1.0, ts_rank(t.search_tsv, (SELECT tsq FROM q))::float * 5)
        WHEN lower(coalesce(t.title,'') || ' ' || coalesce(t.description,'') || ' ' || coalesce(t.buyer_name,''))
             LIKE '%' || (SELECT qtext FROM q) || '%' THEN 0.5
        ELSE 0
      END AS keyword_score,
      -- cpv score
      CASE
        WHEN cpv_prefix IS NULL OR cpv_prefix = '' THEN 0
        WHEN coalesce(t.primary_cpv, '') LIKE cpv_prefix || '%' THEN 1.0
        WHEN EXISTS (SELECT 1 FROM unnest(coalesce(t.cpv_codes, ARRAY[]::text[])) c WHERE c LIKE cpv_prefix || '%') THEN 0.7
        ELSE 0
      END AS cpv_score
    FROM public.tenders t
    WHERE t.published_at >= since_ts
  )
  SELECT
    id, source, external_id, title, buyer_name,
    semantic_score, keyword_score, cpv_score,
    (keyword_score * 0.4 + cpv_score * 0.3 + semantic_score * 0.3) AS hybrid_score
  FROM scored
  WHERE (keyword_score + cpv_score + semantic_score) > 0
  ORDER BY hybrid_score DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.search_tenders_hybrid(vector, text, int, timestamptz, text) TO authenticated, anon, service_role;

-- Stats view for admin dashboard
CREATE OR REPLACE VIEW public.tender_embedding_stats AS
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE embedding_status = 'completed') AS completed,
  count(*) FILTER (WHERE embedding_status = 'pending') AS pending,
  count(*) FILTER (WHERE embedding_status = 'processing') AS processing,
  count(*) FILTER (WHERE embedding_status = 'failed') AS failed,
  count(*) FILTER (WHERE embedding_status = 'skipped') AS skipped,
  count(*) FILTER (WHERE embedding_status = 'completed' AND published_at >= now() - interval '365 days') AS completed_last_365d,
  count(*) FILTER (WHERE published_at >= now() - interval '365 days') AS total_last_365d
FROM public.tenders;

GRANT SELECT ON public.tender_embedding_stats TO authenticated, service_role;

-- Trigger so newly inserted tenders are picked up by the backfill worker
CREATE OR REPLACE FUNCTION public.tenders_reset_embedding_on_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.embedding IS NULL THEN
      NEW.embedding_status := 'pending';
    END IF;
    RETURN NEW;
  END IF;
  -- On UPDATE: if material text changed, requeue
  IF (NEW.title IS DISTINCT FROM OLD.title)
     OR (NEW.description IS DISTINCT FROM OLD.description) THEN
    NEW.embedding := NULL;
    NEW.embedding_status := 'pending';
    NEW.embedded_at := NULL;
    NEW.embedding_attempts := 0;
    NEW.embedding_error := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenders_embedding_lifecycle ON public.tenders;
CREATE TRIGGER trg_tenders_embedding_lifecycle
  BEFORE INSERT OR UPDATE ON public.tenders
  FOR EACH ROW EXECUTE FUNCTION public.tenders_reset_embedding_on_change();
