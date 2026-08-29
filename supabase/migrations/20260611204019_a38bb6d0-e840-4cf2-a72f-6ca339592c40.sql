CREATE INDEX IF NOT EXISTS idx_tenders_source_published_at ON public.tenders (source, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_tenders_published_at ON public.tenders (published_at DESC NULLS LAST);
ANALYZE public.tenders;
ANALYZE public.notices;