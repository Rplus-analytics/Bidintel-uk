// Normalizes raw Contracts Finder OCDS releases (raw_contracts_finder) into
// tenders / notices / awards / suppliers using the shared OCDS helpers.
//
// Ported from supabase/functions/normalize-raw-cf (Deno) as an EventBridge Lambda.
// extractCpv, mapStatus, monthRange, prevMonth, getState, saveState and the
// whole processRelease row mapping are byte-identical.
//
// TIMEOUT: MAX_RUNTIME_MS is 50_000, tuned to Supabase. This walks
// raw_contracts_finder (~625k rows / 2.3 GB) in reverse-chronological monthly
// windows of 200, calling processRelease — which does an upsert plus a notices
// mirror plus upsertLinkedFromRelease — once PER RELEASE. That is several
// round trips per row, so this is by far the slowest function in the batch.
// Give it the full 900s and expect it to still need many ticks.

import type { ScheduledEvent } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";
import { upsertLinkedFromRelease } from "../_shared/ocds-linked";
import { mirrorTendersToNotices } from "../_shared/notices-mirror";

const supabase = createDbClient();


const SOURCE_STATE = "normalize_cf";
const EARLIEST_YEAR = 2015;
const EARLIEST_MONTH = 1;
const MAX_RUNTIME_MS = 50_000;
const PAGE_SIZE = 200;

function extractCpv(tender: any): string[] {
  const codes: string[] = [];
  const main = tender?.classification;
  if (main?.scheme === "CPV" && main?.id) codes.push(String(main.id));
  for (const ac of tender?.additionalClassifications ?? []) {
    if (ac?.scheme === "CPV" && ac?.id) codes.push(String(ac.id));
  }
  for (const item of tender?.items ?? []) {
    const ic = item?.classification;
    if (ic?.scheme === "CPV" && ic?.id) codes.push(String(ic.id));
    for (const ac of item?.additionalClassifications ?? []) {
      if (ac?.scheme === "CPV" && ac?.id) codes.push(String(ac.id));
    }
  }
  return Array.from(new Set(codes));
}

function mapStatus(s: any): string {
  switch (String(s ?? "").toLowerCase()) {
    case "active": return "active";
    case "complete":
    case "completed":
    case "unsuccessful": return "complete";
    case "cancelled":
    case "canceled": return "cancelled";
    case "withdrawn": return "withdrawn";
    case "planned":
    case "planning": return "planned";
    default: return "unknown";
  }
}

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

function prevMonth(year: number, month: number) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

async function getState() {
  const { data } = await supabase
    .from("backfill_state")
    .select("*")
    .eq("source", SOURCE_STATE)
    .maybeSingle();
  if (data) return data;
  const now = new Date();
  const init = {
    source: SOURCE_STATE,
    year: now.getUTCFullYear(),
    month0: now.getUTCMonth() + 1,
    completed: false,
    last_run_at: null as string | null,
  };
  await supabase.from("backfill_state").upsert(init, { onConflict: "source" });
  return init;
}

async function saveState(year: number, month: number, completed: boolean) {
  await supabase.from("backfill_state").upsert(
    {
      source: SOURCE_STATE,
      year,
      month0: month,
      completed,
      last_run_at: new Date().toISOString(),
    },
    { onConflict: "source" },
  );
}

async function processRelease(r: any, errors: any[]): Promise<boolean> {
  const t = r?.tender ?? {};
  const ext = r?.id ?? r?.ocid;
  if (!ext || !t?.title) return false;
  const cpv = extractCpv(t);
  const v = t.value ?? {};
  const row = {
    source: "cf",
    external_id: String(ext),
    title: t.title ?? null,
    description: t.description ?? null,
    cpv_codes: cpv,
    primary_cpv: cpv[0] ?? null,
    buyer_name: r?.buyer?.name ?? null,
    value_min: typeof v.amount === "number" ? v.amount : null,
    value_max: typeof v.amount === "number" ? v.amount : null,
    currency: v.currency ?? "GBP",
    source_url:
      t.documents?.[0]?.url ??
      `https://www.contractsfinder.service.gov.uk/Notice/${String(ext).replace(/-\d+$/, "")}`,
    published_at: r?.date ? new Date(r.date).toISOString() : null,
    deadline_at: t?.tenderPeriod?.endDate
      ? new Date(t.tenderPeriod.endDate).toISOString()
      : null,
    contract_start: (r?.awards?.[0]?.contractPeriod?.startDate ?? t?.contractPeriod?.startDate)
      ? new Date(r.awards?.[0]?.contractPeriod?.startDate ?? t.contractPeriod.startDate).toISOString()
      : null,
    contract_end: (r?.awards?.[0]?.contractPeriod?.endDate ?? t?.contractPeriod?.endDate)
      ? new Date(r.awards?.[0]?.contractPeriod?.endDate ?? t.contractPeriod.endDate).toISOString()
      : null,
    status: mapStatus(t.status),
    raw_json: r,
    ocid: r?.ocid ?? null,
  };

  const { data: upserted, error } = await supabase
    .from("tenders")
    .upsert([row], { onConflict: "source,external_id" })
    .select("id,source,external_id")
    .single();
  if (error) { errors.push({ upsert: error.message, ext }); return false; }

  const mr = await mirrorTendersToNotices(supabase, [row]);
  if (mr.error) errors.push({ mirror: mr.error, ext });

  const { errors: linkErrs } = await upsertLinkedFromRelease(supabase, "cf", r, upserted.id, "GB");
  if (linkErrs.length) errors.push({ ext, linked: linkErrs });
  return true;
}

async function run(detail: Record<string, any>): Promise<any> {
  // EventBridge passes parameters in the rule's `detail` payload rather than a
  // query string. { "ocid": "..." } and { "reset_to": "YYYY-MM" } behave exactly
  // as the original's ?ocid= and ?reset_to= did.
  const debugOcid: string | null = detail.ocid ?? null;
  const resetTo: string | null = detail.reset_to ?? null; // "YYYY-MM"

  const start = Date.now();
  const { data: run } = await supabase
    .from("ingest_runs")
    .insert({ source: SOURCE_STATE, started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = run!.id;

  const errors: any[] = [];
  let processed = 0;
  let scanned = 0;
  let monthsProcessed = 0;

  try {
    // Debug: normalize a single ocid immediately.
    if (debugOcid) {
      const { data: rows } = await supabase
        .from("raw_contracts_finder")
        .select("payload")
        .eq("ocid", debugOcid);
      for (const row of rows ?? []) {
        scanned++;
        if (await processRelease(row.payload, errors)) processed++;
      }
      return { ok: true, mode: "debug_ocid", scanned, processed, errors };
    }

    if (resetTo) {
      const [y, m] = resetTo.split("-").map(Number);
      await saveState(y, m, false);
    }

    let state = await getState();
    let { year, month0: month, completed } = state as any;
    if (completed) {
      return { ok: true, completed: true, message: "Normalization already complete" };
    }

    while (Date.now() - start < MAX_RUNTIME_MS) {
      if (year < EARLIEST_YEAR || (year === EARLIEST_YEAR && month < EARLIEST_MONTH)) {
        await saveState(year, month, true);
        completed = true;
        break;
      }

      const { from, to } = monthRange(year, month);
      let offset = 0;
      while (Date.now() - start < MAX_RUNTIME_MS) {
        const { data: rows, error } = await supabase
          .from("raw_contracts_finder")
          .select("payload,published_date")
          .gte("published_date", from)
          .lt("published_date", to)
          .order("published_date", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) { errors.push({ year, month, offset, fetch: error.message }); break; }
        if (!rows || rows.length === 0) break;
        scanned += rows.length;
        for (const r of rows) {
          if (await processRelease(r.payload, errors)) processed++;
        }
        if (rows.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
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
        count: processed,
        errors: errors.length ? errors.slice(0, 50) : null,
        duration_ms: Date.now() - start,
      })
      .eq("id", runId);

    return {
        ok: true,
        run_id: runId,
        scanned,
        processed,
        months_processed: monthsProcessed,
        next_cursor: { year, month },
        completed,
        error_sample: errors.slice(0, 5),
        error_count: errors.length,
        duration_ms: Date.now() - start,
      };
  } catch (e: any) {
    errors.push({ fatal: e.message });
    await supabase
      .from("ingest_runs")
      .update({
        finished_at: new Date().toISOString(),
        count: processed,
        errors: errors.slice(0, 50),
        duration_ms: Date.now() - start,
      })
      .eq("id", runId);
    // The original returned HTTP 500; a scheduled Lambda must throw.
    throw new Error(`normalize-raw-cf failed: ${JSON.stringify(errors.slice(0, 10))}`);
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
      "normalize-raw-cf is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};
