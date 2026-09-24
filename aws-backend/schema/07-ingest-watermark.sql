-- ===========================================================================
-- Ingestion watermarks
-- ===========================================================================
--
-- WHY THIS TABLE EXISTS.
--
-- ingest-cf and ingest-fts computed their window as `now - 24 hours`, with no
-- cursor and no memory of the last successful run. That has one consequence
-- that matters more than any other:
--
--   AN OUTAGE LONGER THAN A DAY LOSES THOSE DAYS PERMANENTLY.
--
-- The next run asks only for the last 24 hours, succeeds, and reports success.
-- Nothing alarms, because from the worker's point of view nothing failed. The
-- missing days are simply never requested again.
--
-- That is precisely what happened between 8 and 24 September 2026: the upstream
-- APIs began returning 403 to the old platform's egress IP, every run "worked"
-- on a 24-hour window that returned nothing, and seventeen days went missing in
-- silence.
--
-- A watermark makes the window derive from what we actually have rather than
-- from the clock. After any outage the next successful run asks for everything
-- missed.
--
-- DELIBERATELY SEPARATE FROM backfill_state. That table is driven by
-- backfill-tick, which selects `completed = false` and would start walking any
-- row added here. These are different concepts — a rolling forward watermark
-- versus a historical walk — and merging them would make each harder to reason
-- about.

CREATE TABLE IF NOT EXISTS public.ingest_watermark (
  source        text PRIMARY KEY,

  -- End of the last window that COMPLETED successfully. The next run starts
  -- here (minus an overlap), never at `now - 24h`.
  window_end    timestamptz NOT NULL,

  -- Observability: how long the gap was when it was closed, so a silent stop
  -- leaves a trace even after it is fixed.
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  last_span_hours numeric,
  notes         text
);

COMMENT ON TABLE public.ingest_watermark IS
  'Resume points for the rolling daily ingesters. Updated ONLY after a window is fully processed, so a failed run leaves the watermark where it was and the next run retries that window.';

COMMENT ON COLUMN public.ingest_watermark.window_end IS
  'End of the last fully-successful window. Never advanced on partial failure.';

-- The workers connect as bidintel_app.
GRANT SELECT, INSERT, UPDATE ON public.ingest_watermark TO bidintel_app;

-- Seed both daily sources at the last date we know is good, so the first run
-- after deployment closes the 8-24 September gap rather than starting from now
-- and leaving it open forever.
INSERT INTO public.ingest_watermark (source, window_end, notes)
VALUES
  ('cf',  timestamptz '2026-09-07 00:00:00+00', 'seeded: newest published_at at migration; 403 outage began ~8 Sep'),
  ('fts', timestamptz '2026-09-07 00:00:00+00', 'seeded: newest published_at at migration; 403 outage began ~8 Sep')
ON CONFLICT (source) DO NOTHING;
