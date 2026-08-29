
ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz DEFAULT now();
