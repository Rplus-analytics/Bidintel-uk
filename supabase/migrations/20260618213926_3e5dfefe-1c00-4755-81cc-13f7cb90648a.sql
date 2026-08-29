
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS source text DEFAULT 'all';
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS buyer text;
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS supplier text;
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS min_value numeric;
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS max_value numeric;
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS published_from date;
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS published_to date;
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS cpv text;
ALTER TABLE public.saved_searches ADD COLUMN IF NOT EXISTS notice_type text;
