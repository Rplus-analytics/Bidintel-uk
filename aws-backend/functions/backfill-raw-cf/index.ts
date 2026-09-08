// Backfills ALL historical Contracts Finder OCDS releases into raw_contracts_finder.
// Resumable: walks backwards from now in monthly windows, persisting progress in
// backfill_state (source = 'raw_cf'). Each invocation runs for up to ~50s and
// returns; call repeatedly (or via cron) until completed=true.
//
// TRIGGER: CRON -> EventBridge. The header comment says "call repeatedly (or via
// cron)", it has no frontend caller, and it keeps its own backfill_state cursor.
//
// SECURITY NOTE ON THE ORIGINAL: config.toml sets verify_jwt = false for this
// function AND it has no in-code auth check — only the comment "Public endpoint:
// only writes Contracts Finder OCDS data (already public)". It is therefore a
// genuinely unauthenticated, write-capable URL on the Supabase side. Moving it to
// EventBridge removes the HTTP surface entirely, which is a security improvement,
// not just a re-platforming.
//
// Ported from supabase/functions/backfill-raw-cf (Deno). monthRange, prevMonth,
// getState, saveState, the month-walk and the ocid,release_id upsert are
// byte-identical.
//
// TIMEOUT: MAX_RUNTIME_MS is 50_000, tuned to Supabase, with a 25s per-page fetch
// abort inside it. Lambda allows 900s. See README § Timeouts before raising it.

import type { ScheduledEvent } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";

const supabase = createDbClient();


const SOURCE = "raw_cf";
// Contracts Finder launched ~Feb 2015. Stop once we walk past this.
const EARLIEST_YEAR = 2015;
const EARLIEST_MONTH = 1; // January
const MAX_RUNTIME_MS = 50_000;
const PAGE_LIMIT = 100;

function monthRange(year: number, month: number) {
  // month is 1-12
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    from: from.toISOString().slice(0, 19),
    to: to.toISOString().slice(0, 19),
  };
}

function prevMonth(year: number, month: number) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

async function getState() {
  const { data } = await supabase
    .from("backfill_state")
    .select("*")
    .eq("source", SOURCE)
    .maybeSingle();
  if (data) return data;
  const now = new Date();
  const init = {
    source: SOURCE,
    year: now.getUTCFullYear(),
    month0: now.getUTCMonth() + 1, // store 1-12
    completed: false,
    last_run_at: null as string | null,
  };
  await supabase.from("backfill_state").upsert(init, { onConflict: "source" });
  return init;
}

async function saveState(year: number, month: number, completed: boolean) {
  await supabase.from("backfill_state").upsert(
    {
      source: SOURCE,
      year,
      month0: month,
      completed,
      last_run_at: new Date().toISOString(),
    },
    { onConflict: "source" },
  );
}

async function run(detail: Record<string, any>): Promise<any> {


  const start = Date.now();
  const { data: run } = await supabase
    .from("ingest_runs")
    .insert({ source: SOURCE, started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = run!.id;

  const errors: any[] = [];
  let totalUpserted = 0;
  let monthsProcessed = 0;
  let scanned = 0;

  try {
    let state = await getState();
    let { year, month0: month, completed } = state as { year: number; month0: number; completed: boolean };

    if (completed) {
      return { ok: true, completed: true, message: "Backfill already complete" };
    }

    while (Date.now() - start < MAX_RUNTIME_MS) {
      if (year < EARLIEST_YEAR || (year === EARLIEST_YEAR && month < EARLIEST_MONTH)) {
        await saveState(year, month, true);
        completed = true;
        break;
      }

      const { from, to } = monthRange(year, month);
      let nextUrl: string | null =
        `https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search` +
        `?publishedFrom=${from}&publishedTo=${to}&limit=${PAGE_LIMIT}`;

      let pages = 0;
      while (nextUrl && Date.now() - start < MAX_RUNTIME_MS) {
        pages++;
        let res: Response;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 25_000);
          res = await fetch(nextUrl, { headers: { Accept: "application/json" }, signal: ctrl.signal });
          clearTimeout(t);
        } catch (e: any) {
          errors.push({ year, month, page: pages, fetch: e.message });
          break;
        }
        if (!res.ok) {
          errors.push({ year, month, page: pages, status: res.status });
          break;
        }
        const json: any = await res.json();
        const releases: any[] = json.releases ?? [];
        scanned += releases.length;
        if (releases.length === 0) break;

        const rows = releases
          .filter((r) => r?.ocid && r?.id)
          .map((r) => ({
            ocid: String(r.ocid),
            release_id: String(r.id),
            published_date: r.date ? new Date(r.date).toISOString() : null,
            payload: r,
          }));

        if (rows.length) {
          const { error } = await supabase
            .from("raw_contracts_finder")
            .upsert(rows, { onConflict: "ocid,release_id" });
          if (error) errors.push({ year, month, page: pages, upsert: error.message });
          else totalUpserted += rows.length;
        }

        nextUrl = json.links?.next ?? null;
      }

      monthsProcessed++;
      const prev = prevMonth(year, month);
      year = prev.year;
      month = prev.month;
      await saveState(year, month, false);
    }

    await supabase
      .from("ingest_runs")
      .update({
        finished_at: new Date().toISOString(),
        count: totalUpserted,
        errors: errors.length ? errors : null,
        duration_ms: Date.now() - start,
      })
      .eq("id", runId);

    return {
        ok: true,
        run_id: runId,
        scanned,
        upserted: totalUpserted,
        months_processed: monthsProcessed,
        next_cursor: { year, month },
        completed,
        errors,
        duration_ms: Date.now() - start,
      };
  } catch (e: any) {
    errors.push({ fatal: e.message });
    await supabase
      .from("ingest_runs")
      .update({
        finished_at: new Date().toISOString(),
        count: totalUpserted,
        errors,
        duration_ms: Date.now() - start,
      })
      .eq("id", runId);
    // The original returned HTTP 500; a scheduled Lambda must throw so the
    // invocation is recorded as failed and reaches the DLQ.
    throw new Error(`backfill-raw-cf failed: ${JSON.stringify(errors).slice(0, 800)}`);
  }
}

/**
 * EventBridge entry point. A scheduled Lambda has no HTTP response: the return
 * value is the invocation result (visible in CloudWatch / Step Functions) and a
 * throw is what marks the invocation failed so it reaches the DLQ and the
 * Errors metric. The Deno original's `return new Response(..., {status:500})`
 * would have been silently recorded as a SUCCESSFUL invocation here.
 */
export const handler = async (event: ScheduledEvent | { detail?: Record<string, any> }): Promise<any> => {
  const detail = (event as any)?.detail ?? {};

  if (!isDbConfigured()) {
    const message =
      "backfill-raw-cf is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};

// Exported for offline verification of the reverse-chronological month walk.
export { monthRange, prevMonth };
