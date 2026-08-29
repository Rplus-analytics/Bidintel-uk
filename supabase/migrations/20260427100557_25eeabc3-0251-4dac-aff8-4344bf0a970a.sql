CREATE TABLE public.notices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  buyer TEXT,
  description TEXT,
  value NUMERIC,
  value_high NUMERIC,
  currency TEXT,
  status TEXT,
  published_date TIMESTAMPTZ,
  deadline_date TIMESTAMPTZ,
  region TEXT,
  sector TEXT,
  cpv_code TEXT,
  notice_type TEXT,
  link TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX idx_notices_published_date ON public.notices (published_date DESC);
CREATE INDEX idx_notices_source ON public.notices (source);
CREATE INDEX idx_notices_buyer ON public.notices (buyer);
CREATE INDEX idx_notices_status ON public.notices (status);

ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users view notices"
  ON public.notices FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER trg_notices_updated_at
  BEFORE UPDATE ON public.notices
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.notices_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

ALTER TABLE public.notices_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users view sync log"
  ON public.notices_sync_log FOR SELECT
  TO authenticated
  USING (true);