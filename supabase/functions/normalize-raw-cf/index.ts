// Normalizes raw Contracts Finder OCDS releases (raw_contracts_finder) into
// tenders / notices / awards / suppliers using the shared OCDS helpers.
//
// The historical backfill (backfill-raw-cf) only writes to raw_contracts_finder.
// The daily ingest-cf job only processes the last 24h AND filters by CPV, so
// historical CF award notices (like Rplus Analytics Sep-2024) never made it
// into the app tables. This function walks raw_contracts_finder in reverse-
// chronological monthly windows and pushes releases through the same pipeline
// used by ingest-cf, but WITHOUT the CPV whitelist so awards from every sector
// are surfaced. Resumable via backfill_state (source='normalize_cf').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertLinkedFromRelease } from "../_shared/ocds-linked.ts";
import { mirrorTendersToNotices } from "../_shared/notices-mirror.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const debugOcid = url.searchParams.get("ocid");
  const resetTo = url.searchParams.get("reset_to"); // "YYYY-MM"

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
      return Response.json({ ok: true, mode: "debug_ocid", scanned, processed, errors }, { headers: corsHeaders });
    }

    if (resetTo) {
      const [y, m] = resetTo.split("-").map(Number);
      await saveState(y, m, false);
    }

    let state = await getState();
    let { year, month0: month, completed } = state as any;
    if (completed) {
      return Response.json({ ok: true, completed: true, message: "Normalization already complete" }, { headers: corsHeaders });
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

    return Response.json(
      {
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
      },
      { headers: corsHeaders },
    );
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
    return new Response(JSON.stringify({ ok: false, errors: errors.slice(0, 10) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
