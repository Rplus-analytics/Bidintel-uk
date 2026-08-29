
ALTER TABLE public.tenders
  ADD COLUMN IF NOT EXISTS source_status text,
  ADD COLUMN IF NOT EXISTS derived_status text;

ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS source_status text,
  ADD COLUMN IF NOT EXISTS derived_status text;

CREATE INDEX IF NOT EXISTS idx_tenders_derived_status ON public.tenders(derived_status);
CREATE INDEX IF NOT EXISTS idx_tenders_source_derived_status ON public.tenders(source, derived_status);
CREATE INDEX IF NOT EXISTS idx_notices_derived_status ON public.notices(derived_status);
