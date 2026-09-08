// Backfills Contracts Finder native API into raw_cf_native.
// Walks EXACTLY 1 week per tick (no parallel, no skip-ahead).
// Resumable via backfill_state.cursor_date.
//
// Ported from supabase/functions/ingest-cf-native (Deno) as an EventBridge Lambda.
// The date arithmetic, the advisory-lock protocol, the state-reconciliation
// warnings, MAX_WEEKS_PER_TICK, the fast-forward-only-when-redundant rule and
// the optimistic cursor check in saveState are all byte-identical.
//
// TIMEOUT: MAX_RUNTIME_MS is 50_000 and LOCK_MS is 120_000 — both tuned to
// Supabase's edge wall clock, NOT to Lambda's. Lambda allows 900s. Raising
// MAX_RUNTIME_MS would let each tick cover more weeks, but LOCK_MS must then
// rise with it or a long tick outlives its own lock and a second tick starts.
// Left unchanged here; see aws-backend/README.md § Timeouts before tuning.

import type { ScheduledEvent } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";

const supabase = createDbClient();


const SOURCE = "cf_native";
const ENDPOINT = "https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json";
const START_DATE = new Date(Date.UTC(2015, 0, 1));
const COMPLETION_YEAR = 2026;
const PAGE_SIZE = 100;
const MAX_RUNTIME_MS = 50_000;
const LOCK_MS = 120_000;

function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function monthStart(year: number, month0: number) { return new Date(Date.UTC(year, month0, 1)); }
function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
function completionThreshold(now = new Date()) {
  return new Date(Date.UTC(COMPLETION_YEAR, now.getUTCMonth(), 1));
}
function isAtCompletionCursor(cursor: Date, now = new Date()) {
  return cursor.getUTCFullYear() >= COMPLETION_YEAR && cursor.getUTCMonth() >= now.getUTCMonth();
}

async function acquireRunLock(runId: string) {
  const lockUntil = new Date(Date.now() + LOCK_MS).toISOString();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from("backfill_state")
    .update({ lock_until: lockUntil })
    .eq("source", SOURCE)
    .or(`lock_until.is.null,lock_until.lt.${nowIso}`)
    .select("source")
    .maybeSingle();
  if (error) throw new Error(`backfill_state lock: ${error.message}`);
  if (!data) {
    await supabase.from("ingest_runs").update({
      finished_at: new Date().toISOString(),
      count: 0,
      errors: [{ note: "skipped because another cf_native tick is already running" }],
      duration_ms: 0,
    }).eq("id", runId);
    return false;
  }
  return true;
}

async function releaseRunLock() {
  await supabase.from("backfill_state").update({ lock_until: null }).eq("source", SOURCE);
}

async function getState(): Promise<{ cursor: Date; completed: boolean; warnings: any[] }> {
  const { data } = await supabase.from("backfill_state").select("*").eq("source", SOURCE).maybeSingle();
  const warnings: any[] = [];
  if (data?.cursor_date) {
    const storedCursor = new Date(data.cursor_date + "T00:00:00Z");
    const fieldsCursor = monthStart(Number(data.year), Number(data.month0));
    const fieldDriftDays = Math.abs(daysBetween(fieldsCursor, storedCursor));

    // `cursor_date` is the exact weekly cursor. `year/month0` are kept in sync
    // for visibility, but users sometimes reset only year/month0. Treat that
    // explicit reset to 2015-01 as authoritative; otherwise never allow a
    // stale mixed state to skip months or years silently.
    if (!data.completed && data.year === 2015 && data.month0 === 0 && fieldDriftDays > 30) {
      warnings.push({ state_reconciled: "year/month0 reset overrides stale cursor_date", stale_cursor_date: ymd(storedCursor) });
      await supabase.from("backfill_state").update({
        cursor_date: ymd(START_DATE),
        last_run_at: new Date().toISOString(),
      }).eq("source", SOURCE);
      return { cursor: new Date(START_DATE), completed: false, warnings };
    }

    if (fieldDriftDays > 30) {
      warnings.push({ state_warning: "year/month0 disagrees with cursor_date by more than 30 days", year: data.year, month0: data.month0, cursor_date: ymd(storedCursor) });
    }

    const completed = !!data.completed && isAtCompletionCursor(storedCursor);
    if (data.completed && !completed) {
      warnings.push({ state_reconciled: "ignored premature completed=true because cursor is before current-month threshold", cursor_date: ymd(storedCursor) });
      await supabase.from("backfill_state").update({
        completed: false,
        last_run_at: new Date().toISOString(),
      }).eq("source", SOURCE);
    }
    return { cursor: storedCursor, completed, warnings };
  }
  await supabase.from("backfill_state").upsert(
    { source: SOURCE, year: START_DATE.getUTCFullYear(), month0: START_DATE.getUTCMonth(), cursor_date: ymd(START_DATE), completed: false },
    { onConflict: "source" },
  );
  return { cursor: new Date(START_DATE), completed: false, warnings };
}

async function saveState(prevCursor: Date, cursor: Date, completed: boolean) {
  const { data, error } = await supabase.from("backfill_state").update(
    { year: cursor.getUTCFullYear(), month0: cursor.getUTCMonth(),
      cursor_date: ymd(cursor), completed, last_run_at: new Date().toISOString(), lock_until: null },
  ).eq("source", SOURCE).eq("cursor_date", ymd(prevCursor)).select("source").maybeSingle();
  if (error) throw new Error(`backfill_state update: ${error.message}`);
  if (!data) throw new Error(`backfill_state cursor changed concurrently before save; expected ${ymd(prevCursor)}`);
}

async function fetchPage(from: string, to: string, startAt: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        searchCriteria: {
          publishedFrom: `${from}T00:00:00`,
          publishedTo: `${to}T23:59:59`,
        },
        size: PAGE_SIZE,
        startAt,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) return { ok: false, status: r.status, items: [] as any[], hitCount: 0 };
    const j: any = await r.json();
    const items = (j.noticeList ?? []).map((n: any) => n.item).filter(Boolean);
    return { ok: true, status: 200, items, hitCount: j.hitCount ?? 0 };
  } finally { clearTimeout(t); }
}

async function run(detail: Record<string, any>): Promise<any> {
  const start = Date.now();
  const { data: run } = await supabase.from("ingest_runs")
    .insert({ source: SOURCE, started_at: new Date().toISOString() }).select("id").single();
  const runId = run!.id;

  if (!(await acquireRunLock(runId))) {
    return { ok: true, skipped: true, reason: "another cf_native tick is already running" };
  }

  const errors: any[] = [];
  const weeksProcessed: any[] = [];
  let totalScanned = 0;
  let totalInsertedNew = 0;

  try {
    const state = await getState();
    let cursor = state.cursor;
    const now = new Date();
    const threshold = completionThreshold(now);
    errors.push(...state.warnings);

    if (state.completed) {
      await releaseRunLock();
      await supabase.from("ingest_runs").update({
        finished_at: new Date().toISOString(), count: 0,
        errors: [{ note: "already completed", cursor: ymd(cursor), completion_threshold: ymd(threshold) }], duration_ms: Date.now() - start,
      }).eq("id", runId);
      return { ok: true, completed: true, cursor: ymd(cursor) };
    }

    const MAX_WEEKS_PER_TICK = 3;
    let weekIdx = 0;
    let completed = false;

    while (weekIdx < MAX_WEEKS_PER_TICK && Date.now() - start < MAX_RUNTIME_MS) {
      const weekStart = cursor;
      const weekEnd = addDays(cursor, 6);
      const effectiveEnd = weekEnd > now ? now : weekEnd;
      const fromStr = ymd(weekStart);
      const toStr = ymd(effectiveEnd);

      let scanned = 0;
      let insertedNew = 0;
      let apiHitCount = 0;
      let startAt = 0;

      while (Date.now() - start < MAX_RUNTIME_MS) {
        const { ok, status, items, hitCount } = await fetchPage(fromStr, toStr, startAt);
        if (!ok) { errors.push({ from: fromStr, to: toStr, startAt, status }); break; }
        apiHitCount = hitCount;
        scanned += items.length;
        if (items.length === 0) break;

        const rows = items
          .filter((it: any) => it?.id)
          .map((it: any) => ({
            notice_id: String(it.id),
            payload: it,
            fetched_at: new Date().toISOString(),
          }));

        if (rows.length) {
          const ids = rows.map((r) => r.notice_id);
          const { data: existing, error: selErr } = await supabase
            .from("raw_cf_native")
            .select("notice_id")
            .in("notice_id", ids);
          if (selErr) errors.push({ from: fromStr, to: toStr, startAt, preselect: selErr.message });
          const existingSet = new Set((existing ?? []).map((r: any) => r.notice_id));
          const newRows = rows.filter((r) => !existingSet.has(r.notice_id));

          if (newRows.length) {
            const { error } = await supabase.from("raw_cf_native").insert(newRows);
            if (error) {
              errors.push({ from: fromStr, to: toStr, startAt, insert: error.message });
            } else {
              insertedNew += newRows.length;
            }
          }
        }

        startAt += items.length;
        if (items.length < PAGE_SIZE || startAt >= hitCount) break;
      }

      // Advance cursor by exactly 1 week
      const newCursor = addDays(cursor, 7);
      const advancedDays = daysBetween(cursor, newCursor);
      if (advancedDays !== 7) {
        errors.push({ fatal: `cursor advanced ${advancedDays} days; expected 7`, prev: ymd(cursor), next: ymd(newCursor) });
        break;
      }
      completed = isAtCompletionCursor(newCursor, now);
      await saveState(cursor, newCursor, completed);

      weeksProcessed.push({
        week: { from: fromStr, to: toStr },
        api_hit_count: apiHitCount,
        records_fetched: scanned,
        records_inserted_new: insertedNew,
        prev_cursor: ymd(cursor),
        next_cursor: ymd(newCursor),
      });
      totalScanned += scanned;
      totalInsertedNew += insertedNew;
      cursor = newCursor;
      weekIdx++;

      if (completed) break;
      // If this week added new rows, stop and let the next tick continue.
      // Only fast-forward when the week was fully redundant (0 new IDs).
      if (insertedNew > 0) break;
    }

    await supabase.from("ingest_runs").update({
      finished_at: new Date().toISOString(),
      count: totalInsertedNew,
      errors: [
        { weeks_processed: weeksProcessed.length, total_records_fetched: totalScanned, total_inserted_new: totalInsertedNew, completed, weeks: weeksProcessed },
        ...errors,
      ],
      duration_ms: Date.now() - start,
    }).eq("id", runId);

    console.log(JSON.stringify({ source: SOURCE, run_id: runId, weeks_processed: weeksProcessed.length, total_inserted_new: totalInsertedNew, total_records_fetched: totalScanned }));

    return {
      ok: true, run_id: runId,
      weeks_processed: weeksProcessed.length,
      total_records_fetched: totalScanned,
      total_inserted_new: totalInsertedNew,
      weeks: weeksProcessed,
      final_cursor: ymd(cursor),
      completed, errors,
      duration_ms: Date.now() - start,
    };
  } catch (e: any) {
    errors.push({ fatal: e.message });
    await releaseRunLock();
    await supabase.from("ingest_runs").update({
      finished_at: new Date().toISOString(), count: totalInsertedNew, errors,
      duration_ms: Date.now() - start,
    }).eq("id", runId);
    // The original returned HTTP 500. A scheduled Lambda must THROW so the
    // invocation is recorded as failed and reaches the DLQ.
    throw new Error(`cf_native tick failed: ${JSON.stringify(errors).slice(0, 800)}`);
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
      "ingest-cf-native is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};
