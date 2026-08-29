// Walks backfill_state cursor for source='cf_bulk' month-by-month and invokes ingest-cf-bulk.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const SOURCE = "cf_bulk";

function fmt(y: number, m0: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}
function isAtOrAfterNow(y: number, m0: number) {
  const now = new Date();
  return y > now.getUTCFullYear() || (y === now.getUTCFullYear() && m0 >= now.getUTCMonth());
}

function normalizeMetrics(invokeBody: any, month: string) {
  const metrics = invokeBody?.metrics ?? {};
  return {
    month,
    ckan_rows: Number(metrics.ckan_rows ?? 0),
    ocds_rows: Number(metrics.ocds_rows ?? 0),
    ckan_403_days: Number(metrics.ckan_403_days ?? 0),
    pages_fetched: Number(metrics.pages_fetched ?? 0),
    timed_out: Boolean(metrics.timed_out ?? false),
    day_offset_start: Number(metrics.day_offset_start ?? 0),
    day_offset_end: Number(metrics.day_offset_end ?? metrics.day_offset ?? 0),
    month_complete: Boolean(metrics.month_complete ?? false),
    fallback_used: metrics.fallback_used ?? "none",
    total_upserted: Number(metrics.total_upserted ?? 0),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const start = Date.now();

  const { data: run, error: runErr } = await supabase.from("ingest_runs")
    .insert({ source: "cf_bulk_tick", started_at: new Date().toISOString() })
    .select("id").maybeSingle();
  if (runErr) throw new Error(`run insert: ${runErr.message}`);
  const runId = run?.id ?? null;

  try {
    const { data: state, error: stateErr } = await supabase.from("backfill_state")
      .select("*").eq("source", SOURCE).maybeSingle();
    if (stateErr) throw new Error(`state read: ${stateErr.message}`);
    if (!state) throw new Error("no backfill_state row for cf_bulk; insert one first");

    const MIN_ROWS = 500_000;
    // Hard gate: completed=true is only valid if cf_bulk_upload has >= MIN_ROWS.
    // Otherwise force-reset cursor back to 2015-01 and keep ingesting.
    const { count: preTotalRows } = await supabase
      .from("cf_bulk_upload")
      .select("*", { count: "exact", head: true });
    if (state.completed && (preTotalRows ?? 0) < MIN_ROWS) {
      await supabase.from("backfill_state").update({
        completed: false, year: 2015, month0: 0, day_offset: 0,
        cursor_date: "2015-01-01", last_run_at: new Date().toISOString(),
      }).eq("source", SOURCE);
      state.completed = false; state.year = 2015; state.month0 = 0; state.day_offset = 0;
    }

    if (state.completed) {
      if (runId) await supabase.from("ingest_runs").update({
        finished_at: new Date().toISOString(), count: 0,
        errors: [{ note: "already completed", rows: preTotalRows, cursor: fmt(state.year, state.month0) }],
        duration_ms: Date.now() - start,
      }).eq("id", runId);
      return Response.json({ ok: true, completed: true, rows: preTotalRows, cursor: fmt(state.year, state.month0) }, { headers: corsHeaders });
    }

    const year = Number(state.year);
    const month0 = Number(state.month0);
    const dayOffset = Number(state.day_offset ?? 0);
    const month = fmt(year, month0);

    // Fire ingest-cf-bulk. If month completes quickly, fire a second invocation for next month (up to 2 months/tick).
    const invocations: any[] = [];
    let curY = year, curM = month0, curDayOffset = dayOffset;
    let invokeStatus = 0; let invokeBody: any = null;
    let metrics = normalizeMetrics(null, month);

    for (let i = 0; i < 2; i++) {
      const monthStr = fmt(curY, curM);
      if (isAtOrAfterNow(curY, curM)) break;
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/ingest-cf-bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ month: monthStr, sync: true, day_offset: curDayOffset, max_rows: 5000 }),
        });
        invokeStatus = r.status;
        invokeBody = await r.json().catch(() => null);
      } catch (e: any) {
        invokeBody = { error: e.message };
      }
      metrics = normalizeMetrics(invokeBody, monthStr);
      invocations.push({ month: monthStr, invoke_status: invokeStatus, upserted: metrics.total_upserted, complete: metrics.month_complete });

      if (!metrics.month_complete) {
        curDayOffset = metrics.day_offset_end;
        break;
      }
      curM += 1; curDayOffset = 0;
      if (curM > 11) { curM = 0; curY += 1; }
      if (Date.now() - start > 90_000) break;
    }

    let nextY = curY;
    let nextM = curM;
    let nextDayOffset = Math.max(0, curDayOffset);
    let reachedEnd = isAtOrAfterNow(nextY, nextM);

    const { count: totalRows } = await supabase
      .from("cf_bulk_upload")
      .select("*", { count: "exact", head: true });
    const enoughRows = (totalRows ?? 0) >= MIN_ROWS;
    let completed = reachedEnd && enoughRows;
    if (reachedEnd && !enoughRows) {
      nextY = 2015; nextM = 0; nextDayOffset = 0;
    }

    const { error: updErr } = await supabase.from("backfill_state").update({
      year: nextY, month0: nextM, day_offset: nextDayOffset,
      cursor_date: `${nextY}-${String(nextM + 1).padStart(2, "0")}-01`,
      completed, last_run_at: new Date().toISOString(),
    }).eq("source", SOURCE).eq("year", year).eq("month0", month0);
    if (updErr) throw new Error(`state update: ${updErr.message}`);

    if (runId) await supabase.from("ingest_runs").update({
      finished_at: new Date().toISOString(),
      count: invocations.reduce((s, x) => s + (x.upserted ?? 0), 0),
       errors: [{
        month,
        invocations,
        months_processed: invocations.length,
        total_row_count: totalRows,
        invoke_status: invokeStatus,
        prev: fmt(year, month0),
        next: fmt(nextY, nextM),
        completed,
        ...metrics,
      }],
      duration_ms: Date.now() - start,
    }).eq("id", runId);

    return Response.json({
      ok: true, run_id: runId, month, invocations, total_rows: totalRows,
      next_cursor: fmt(nextY, nextM), next_day_offset: nextDayOffset, completed, duration_ms: Date.now() - start,
    }, { headers: corsHeaders });
  } catch (e: any) {
    if (runId) await supabase.from("ingest_runs").update({
      finished_at: new Date().toISOString(), count: 0,
      errors: [{ fatal: e.message }], duration_ms: Date.now() - start,
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
