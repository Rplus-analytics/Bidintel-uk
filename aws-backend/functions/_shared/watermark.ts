// ============================================================================
// Resume points for the rolling daily ingesters
// ============================================================================
//
// Replaces `from = now - 24h`, which loses any outage longer than a day
// permanently: the next run asks only for yesterday, succeeds, and the missing
// days are never requested again. See schema/07-ingest-watermark.sql.
//
// Three properties, none of which the 24-hour window had:
//
//   SELF-HEALING  the window starts where the last SUCCESSFUL run ended, so
//                 after an outage the next run asks for everything missed.
//   OVERLAPPING   it rewinds by OVERLAP_HOURS. Upstream publishers backdate
//                 notices, and both feeds are idempotent on their conflict key,
//                 so re-fetching a little is free and missing a late arrival is
//                 not.
//   BOUNDED       a single run covers at most MAX_SPAN_HOURS. A month-long
//                 outage would otherwise turn the first recovery run into an
//                 unbounded scrape that times out — and a worker that times out
//                 never advances the watermark, so it would retry the same
//                 impossible window forever. Instead it walks back in chunks,
//                 advancing every run.

import type { DbClient } from "./db";

/** Re-fetch this much before the last watermark, to catch backdated notices. */
const OVERLAP_HOURS = 48;

/** Most a single run will ask for. Longer gaps are closed over several runs. */
const MAX_SPAN_HOURS = 24 * 14;

/** Used only when a source has no watermark row at all. */
const COLD_START_HOURS = 24 * 7;

export interface Window {
  from: Date;
  to: Date;
  /** True when the gap was larger than MAX_SPAN_HOURS and this is a partial catch-up. */
  partial: boolean;
  spanHours: number;
}

/**
 * The window this run should fetch.
 *
 * `to` is capped at now; `from` is the last successful end minus the overlap.
 */
export async function nextWindow(db: DbClient, source: string, now = new Date()): Promise<Window> {
  const { data, error } = await db
    .from("ingest_watermark")
    .select("window_end")
    .eq("source", source)
    .maybeSingle();

  if (error) {
    // Do NOT fall back to a 24-hour window here. That is the behaviour this
    // module exists to remove, and silently reverting to it on a transient read
    // error would reintroduce the same permanent gap.
    throw new Error(`watermark read failed for ${source}: ${error.message}`);
  }

  const last = data?.window_end ? new Date(data.window_end) : new Date(now.getTime() - COLD_START_HOURS * 3600_000);
  let from = new Date(last.getTime() - OVERLAP_HOURS * 3600_000);

  // Guard against a watermark in the future (clock skew, or a manual edit).
  if (from.getTime() > now.getTime()) from = new Date(now.getTime() - OVERLAP_HOURS * 3600_000);

  const fullSpan = (now.getTime() - from.getTime()) / 3600_000;
  const partial = fullSpan > MAX_SPAN_HOURS;
  const to = partial ? new Date(from.getTime() + MAX_SPAN_HOURS * 3600_000) : now;

  return { from, to, partial, spanHours: (to.getTime() - from.getTime()) / 3600_000 };
}

/**
 * Advance the watermark. Call ONLY after the window has been fully processed.
 *
 * A run that throws, times out, or reports upstream errors must leave the
 * watermark alone so the next run retries that window. That is the whole point:
 * the 403s that caused the September gap produced runs that "succeeded" while
 * fetching nothing, and a watermark advanced on such a run would bake the loss
 * in exactly as before.
 */
export async function commitWindow(db: DbClient, source: string, w: Window): Promise<void> {
  const { error } = await db.from("ingest_watermark").upsert(
    [{
      source,
      window_end: w.to.toISOString(),
      last_run_at: new Date().toISOString(),
      last_span_hours: Number(w.spanHours.toFixed(2)),
    }],
    { onConflict: "source" },
  );
  if (error) throw new Error(`watermark commit failed for ${source}: ${error.message}`);
}
