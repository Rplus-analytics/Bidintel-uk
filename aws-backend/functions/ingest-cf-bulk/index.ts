// Ingests bulk Contracts Finder data.
// Primary: data.gov.uk CKAN dataset (one CSV per day in a monthly dataset).
// Fallback: Contracts Finder OCDS Search endpoint (paginated JSON for the whole month).
//
// EventBridge detail payloads (were POST bodies):
//   { "day": "2024-01-15" }               -> ingest a single day's CSV (CKAN)
//   { "month": "2024-01" }                -> fan-out: one invocation per day
//   { "month": "2024-01", "sync": true }  -> whole month sequentially in one call
//
// Ported from supabase/functions/ingest-cf-bulk (Deno). nestRow, the CKAN
// dataset-id candidates, fetchWithRetry's 30/60/120s ladder, the OCDS rate-limit
// pacing constants, upsertBatch chunking and the whole sync-mode metrics block
// are byte-identical.
//
// TWO PORTING PROBLEMS, both flagged in aws-backend/README.md:
//
// 1. CSV PARSER. Deno's std/csv is unavailable. Replaced with `csv-parse`
//    (`columns: true` is the direct equivalent of `skipFirstRow: true`) behind a
//    shim that keeps every call site unchanged. Not verified against a real CKAN
//    CSV — that is the one behavioural difference worth testing first.
//
// 2. EdgeRuntime.waitUntil IS GONE. The fan-out branch used it to keep firing
//    per-day requests AFTER the response was returned. Lambda FREEZES the
//    execution environment the moment the handler resolves, so background work
//    there is silently dropped — it would look like a success and ingest nothing.
//    The AWS equivalent of "fire and forget" is an async self-invoke
//    (InvocationType: "Event"), stubbed below as invokeSelfAsync().
//
// TIMEOUT: timeoutBudgetMs is 135_000 and CKAN_DAY_BUDGET_MS is 110_000 — both
// tuned to Supabase's ~150s ceiling, and both now needlessly tight given
// Lambda's 900s. They are left unchanged; raising them is a deliberate decision.

import type { ScheduledEvent } from "aws-lambda";
import { parse as parseCsvSync } from "csv-parse/sync";
import { createDbClient, isDbConfigured } from "../_shared/db";
import { USER_AGENT } from "../_shared/user-agent";

const supabase = createDbClient();

/**
 * Stand-in for Deno's `parse(text, { skipFirstRow: true })` from std/csv, which
 * treats the first row as headers and yields objects keyed by them. csv-parse's
 * `columns: true` is the same contract. Kept async so the call site below is
 * unchanged from the original.
 */
async function parseCsv(
  text: string,
  _opts: { skipFirstRow: true },
): Promise<Record<string, string>[]> {
  return parseCsvSync(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];
}

/**
 * TODO(fanout): the AWS replacement for EdgeRuntime.waitUntil + self-HTTP-POST.
 * An async Lambda self-invoke returns immediately and runs in a separate
 * execution environment, which is exactly the original's fire-and-forget shape:
 *
 *   import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
 *   const lambda = new LambdaClient({});
 *   await lambda.send(new InvokeCommand({
 *     FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
 *     InvocationType: "Event",                       // async — do not await the work
 *     Payload: Buffer.from(JSON.stringify({ detail: { day } })),
 *   }));
 *
 * The execution role then needs lambda:InvokeFunction on itself. For a month of
 * 31 days an SQS queue with the function as its consumer is the better shape —
 * it gives retries, a DLQ and concurrency control that a self-invoke does not.
 */
async function invokeSelfAsync(_day: string): Promise<void> {
  throw new Error(
    "invokeSelfAsync not implemented — see TODO(fanout) in ingest-cf-bulk/index.ts. " +
    "Use { month, sync: true } for now, which needs no fan-out.",
  );
}


const CKAN = "https://ckan.publishing.service.gov.uk/api/3/action/package_show";
const OCDS_SEARCH = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search";
// Honest already, but it named the platform being migrated away from — an
// operator trying to reach us about this traffic would have contacted Lovable.
const UA = USER_AGENT;

// 30s, 60s, 120s
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
// CKAN CSV is not rate-limited — keep a tiny breather between day downloads.
const BETWEEN_CSV_DELAY_MS = 500;
const OCDS_PAGE_LIMIT = 50;
// OCDS Search API is rate-limited to 12 req/min (~5s/req). 3s between requests
// (20 req/min) is slightly above the documented limit but the server tolerates
// short bursts; we cap pages per tick to keep total request count modest.
const OCDS_CONCURRENCY = 1;
const OCDS_BETWEEN_PAGE_DELAY_MS = 3_000;
const OCDS_PAGES_PER_TICK = 20;
// No per-tick row cap for CKAN CSV path. OCDS fallback uses this as a soft
// page-budget so a single tick still finishes within the edge function timeout.
const MAX_ROWS_PER_TICK = 100_000;
// Stop launching new CKAN day downloads once we've burned this much wall-clock
// in the day loop, so the tick can checkpoint progress and exit cleanly.
const CKAN_DAY_BUDGET_MS = 110_000;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithRetry(url: string, init: RequestInit = {}, label = url): Promise<Response> {
  const headers = { "User-Agent": UA, Accept: "application/json,text/csv,*/*", ...(init.headers ?? {}) };
  let lastStatus = 0;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const r = await fetch(url, { ...init, headers });
    if (r.ok) return r;
    lastStatus = r.status;
    const retriable = r.status === 403 || r.status === 429 || r.status >= 500;
    if (!retriable || attempt === RETRY_DELAYS_MS.length) return r;
    const wait = RETRY_DELAYS_MS[attempt];
    console.log(`[retry] ${label} got ${r.status}; sleeping ${wait}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
    await sleep(wait);
  }
  // Should not reach here
  return new Response("retry exhausted", { status: lastStatus || 599 });
}

function nestRow(row: Record<string, string>): any {
  const out: any = {};
  for (const [key, val] of Object.entries(row)) {
    if (val === "" || val == null) continue;
    const parts = key.split("/");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      const next = parts[i + 1];
      const isArr = /^\d+$/.test(next);
      if (cur[p] == null) cur[p] = isArr ? [] : {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return out;
}

async function fetchMonthResources(month: string): Promise<{ id: string; url: string; name: string; day: string }[]> {
  const [year, mm] = month.split("-");
  // Try primary dataset id, then a "2"-suffixed variant used for some older months.
  const candidates = [
    `contracts-finder-notices-${mm}-${year}`,
    `contracts-finder-notices-${mm}-${year}2`,
  ];
  let lastErr = "";
  for (const datasetId of candidates) {
    const r = await fetch(`${CKAN}?id=${datasetId}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) { lastErr = `CKAN ${r.status} for ${datasetId}`; continue; }
    const j: any = await r.json();
    const resources = (j.result?.resources ?? []).filter((x: any) => (x.format ?? "").toUpperCase() === "CSV");
    if (resources.length === 0) { lastErr = `CKAN 0 CSV resources for ${datasetId}`; continue; }
    return resources.map((x: any) => {
      const m = (x.name ?? "").match(/(\d{4}-\d{2}-\d{2})/);
      return { id: x.id, url: x.url, name: x.name, day: m ? m[1] : "" };
    });
  }
  throw new Error(lastErr || `CKAN no dataset for ${month}`);
}

function getMonthDays(month: string) {
  const [year, mm] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, idx) => `${month}-${String(idx + 1).padStart(2, "0")}`);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timedOut: boolean; result: T | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true, result: null }), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve({ timedOut: false, result });
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function upsertBatch(batch: any[]): Promise<{ upserted: number; errors: any[] }> {
  const errors: any[] = [];
  let upserted = 0;
  const CHUNK = 50;
  const DELAY_MS = 500;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    const { error } = await supabase.from("cf_bulk_upload")
      .upsert(slice, { onConflict: "notice_identifier" });
    if (error) errors.push({ chunk: i, error: error.message });
    else upserted += slice.length;
    if (i + CHUNK < batch.length) await sleep(DELAY_MS);
  }
  return { upserted, errors };
}

async function ingestCsv(url: string, retry = true): Promise<{ rows: number; upserted: number; errors: any[]; status: number }> {
  const r = retry
    ? await fetchWithRetry(url, {}, `CSV ${url}`)
    : await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json,text/csv,*/*" } });
  if (!r.ok) return { rows: 0, upserted: 0, errors: [{ url, status: r.status }], status: r.status };
  const text = await r.text();
  const records = await parseCsv(text, { skipFirstRow: true }) as Record<string, string>[];
  const seen = new Set<string>();
  const batch: any[] = [];
  for (const row of records) {
    const nested = nestRow(row);
    const release = nested?.releases?.[0] ?? {};
    const noticeId = release.id || nested.uri;
    if (!noticeId || seen.has(noticeId)) continue;
    seen.add(noticeId);
    batch.push({
      notice_identifier: String(noticeId),
      ocid: release.ocid ?? null,
      published_date: nested.publishedDate ?? release.date ?? null,
      payload: nested,
      source: "cf_bulk",
      fetched_at: new Date().toISOString(),
    });
  }
  const { upserted, errors } = await upsertBatch(batch);
  return { rows: records.length, upserted, errors, status: 200 };
}

type OcdsPageResult = { releases: any[]; nextUrl: string | null; url: string; status: number };

async function fetchOcdsPage(url: string, label: string): Promise<OcdsPageResult> {
  const r = await fetchWithRetry(url, {}, label);
  if (!r.ok) return { releases: [], nextUrl: null, url, status: r.status };
  const j = await r.json().catch(() => null) as any;
  return {
    releases: Array.isArray(j?.releases) ? j.releases : Array.isArray(j?.results) ? j.results : [],
    nextUrl: typeof j?.links?.next === "string" ? j.links.next : null,
    url,
    status: 200,
  };
}

// Fallback: paginate OCDS Search for the whole month and insert as cf_bulk rows.
async function ingestMonthDirect(month: string, maxRows = MAX_ROWS_PER_TICK, startDayOffset = 0): Promise<{ rows: number; upserted: number; errors: any[]; status: number; pages: number; month_complete: boolean; next_day_offset: number }> {
  const monthDays = getMonthDays(month);
  const from = monthDays[Math.min(startDayOffset, monthDays.length - 1)];
  const to = monthDays[monthDays.length - 1];
  const errors: any[] = [];
  let rows = 0;
  let upserted = 0;
  let pages = 0;
  let monthComplete = false;
  let nextDayOffset = startDayOffset;
  let frontier: string[] = [`${OCDS_SEARCH}?${new URLSearchParams({ publishedFrom: from, publishedTo: to, limit: String(OCDS_PAGE_LIMIT) }).toString()}`];

  while (frontier.length > 0 && rows < maxRows && pages < OCDS_PAGES_PER_TICK) {
    const batchUrls = frontier.splice(0, OCDS_CONCURRENCY);
    if (pages > 0) await sleep(OCDS_BETWEEN_PAGE_DELAY_MS);
    const pageResults = await Promise.all(
      batchUrls.map((url, idx) => fetchOcdsPage(url, `OCDS ${from}..${to} p${pages + idx}`)),
    );

    for (const page of pageResults) {
      if (page.status !== 200) {
        errors.push({ ocds_page: pages, status: page.status, url: page.url });
        return { rows, upserted, errors, status: page.status, pages, month_complete: false, next_day_offset: nextDayOffset };
      }
      pages++;
      if (page.releases.length === 0) {
        monthComplete = true;
        continue;
      }

      const remaining = Math.max(0, maxRows - rows);
      const slice = remaining < page.releases.length ? page.releases.slice(0, remaining) : page.releases;
      const batch: any[] = [];
      const seen = new Set<string>();
      for (const rel of slice) {
        const noticeId = rel?.id || rel?.ocid;
        if (!noticeId || seen.has(noticeId)) continue;
        seen.add(noticeId);
        batch.push({
          notice_identifier: String(noticeId),
          ocid: rel.ocid ?? null,
          published_date: rel.date ?? null,
          payload: { releases: [rel], publishedDate: rel.date },
          source: "cf_bulk",
          fetched_at: new Date().toISOString(),
        });
      }
      rows += slice.length;
      const lastDate = slice.at(-1)?.date;
      if (typeof lastDate === "string") {
        const day = lastDate.slice(0, 10);
        const idx = monthDays.indexOf(day);
        if (idx >= 0) nextDayOffset = Math.max(nextDayOffset, idx);
      }
      const { upserted: u, errors: e } = await upsertBatch(batch);
      upserted += u;
      errors.push(...e);

      if (page.nextUrl && rows < maxRows) frontier.push(page.nextUrl);
      if (slice.length < page.releases.length) {
        monthComplete = false;
        return { rows, upserted, errors, status: 200, pages, month_complete: false, next_day_offset: nextDayOffset };
      }
    }
  }

  if (frontier.length === 0) {
    monthComplete = true;
    nextDayOffset = monthDays.length;
  }
  return { rows, upserted, errors, status: 200, pages, month_complete: monthComplete, next_day_offset: nextDayOffset };
}

async function findDayResource(day: string) {
  const month = day.slice(0, 7);
  const resources = await fetchMonthResources(month);
  return resources.find((r) => r.day === day);
}

async function run(detail: Record<string, any>): Promise<any> {
  const start = Date.now();
  const body = detail;
  const { data: run } = await supabase.from("ingest_runs")
    .insert({ source: "cf_bulk", started_at: new Date().toISOString() }).select("id").single();
  const runId = run!.id;

  try {
    // Single-day path (CKAN)
    if (typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day)) {
      const res = await findDayResource(body.day);
      if (!res) throw new Error(`no CSV resource found for ${body.day}`);
      const { rows, upserted, errors, status } = await ingestCsv(res.url);
      await supabase.from("ingest_runs").update({
        finished_at: new Date().toISOString(),
        count: upserted,
        errors: [{ day: body.day, file: res.name, rows, upserted, status, url_format: "ckan_csv" }, ...errors],
        duration_ms: Date.now() - start,
      }).eq("id", runId);
      return { ok: true, day: body.day, rows, upserted, errors, status, url_format: "ckan_csv", duration_ms: Date.now() - start };
    }

    const month = body.month as string;
    const dayOffset = Math.max(0, Number(body.day_offset ?? 0));
    const maxRows = Math.max(1, Math.min(MAX_ROWS_PER_TICK, Number(body.max_rows ?? MAX_ROWS_PER_TICK)));
    if (!/^\d{4}-\d{2}$/.test(month ?? "")) {
      throw new Error("provide day=YYYY-MM-DD or month=YYYY-MM");
    }

    // SYNC mode: try CKAN first; on 403/failure for the month dataset, fall back to OCDS Search direct.
    if (body.sync === true) {
      const timeoutBudgetMs = 135_000;
      let resources: { id: string; url: string; name: string; day: string }[] = [];
      let ckanError: any = null;
      try {
        resources = await fetchMonthResources(month);
      } catch (e: any) {
        ckanError = e.message;
      }

      // If CKAN dataset itself failed, go straight to fallback
      if (ckanError || resources.length === 0) {
        const monthDays = getMonthDays(month);
        const { timedOut, result } = await withTimeout(ingestMonthDirect(month, maxRows, dayOffset), timeoutBudgetMs);
        const direct = result ?? { rows: 0, upserted: 0, errors: [], status: 599, pages: 0, month_complete: false };
        const usedFallback = true;
        const skipped = direct.status !== 200;
        const metrics = {
          month,
          ckan_rows: 0,
          ocds_rows: direct.upserted,
          ckan_403_days: 0,
          pages_fetched: direct.pages,
          timed_out: timedOut,
          day_offset_start: dayOffset,
          day_offset_end: direct.month_complete ? monthDays.length : dayOffset,
          month_complete: direct.month_complete,
          fallback_used: "ocds_search",
          total_upserted: direct.upserted,
        };
        await supabase.from("ingest_runs").update({
          finished_at: new Date().toISOString(),
          count: direct.upserted,
          // @ts-ignore TS2783: duplicate key, PRE-EXISTING in the Deno original and behaviour-neutral — the spread of `metrics` re-supplies this exact same variable. Preserved rather than deduped to keep the diff against the original clean.
          errors: [{ month, url_format: "ocds_search", ckan_error: ckanError, fallback: usedFallback, skipped, ...metrics, ...direct }],
          duration_ms: Date.now() - start,
        }).eq("id", runId);
        return { ok: !skipped, month, url_format: "ocds_search", skipped, metrics, ...direct };
      }

      const monthDays = getMonthDays(month);
      const pendingDays = resources.filter((r) => monthDays.indexOf(r.day) >= dayOffset);
      if (pendingDays.length === 0) {
        const metrics = {
          month,
          ckan_rows: 0,
          ocds_rows: 0,
          ckan_403_days: 0,
          pages_fetched: 0,
          timed_out: false,
          day_offset_start: dayOffset,
          day_offset_end: monthDays.length,
          month_complete: true,
          fallback_used: "none",
          total_upserted: 0,
        };
        await supabase.from("ingest_runs").update({
          finished_at: new Date().toISOString(),
          count: 0,
          // @ts-ignore TS2783: duplicate key, PRE-EXISTING in the Deno original and behaviour-neutral — the spread of `metrics` re-supplies this exact same variable. Preserved rather than deduped to keep the diff against the original clean.
          errors: [{ month, skipped: false, per_file: [], ...metrics }],
          duration_ms: Date.now() - start,
        }).eq("id", runId);
        return { ok: true, month, files: 0, total_rows: 0, total_upserted: 0, ckan_403_days: 0, fallback_used: false, skipped: false, per_file: [], metrics };
      }
      let totalRows = 0, totalUpserted = 0;
      const perFile: any[] = []; const allErrors: any[] = [];
      let ckan403Days = 0;
      const failedDays: string[] = [];
      let nextDayOffset = dayOffset;
      let pagesFetched = 0;
      let fallbackUsed: "none" | "ocds_search" = "none";
      let monthComplete = false;

      const dayLoopStart = Date.now();
      let dayLoopTimedOut = false;
      for (let idx = 0; idx < pendingDays.length; idx++) {
        if (Date.now() - dayLoopStart > CKAN_DAY_BUDGET_MS) { dayLoopTimedOut = true; break; }
        const res = pendingDays[idx];
        try {
          const { rows, upserted, errors, status } = await ingestCsv(res.url);
          totalRows += rows; totalUpserted += upserted;
          perFile.push({ name: res.name, day: res.day, rows, upserted, status, errors: errors.length });
          allErrors.push(...errors);
          if (status === 403) { ckan403Days++; failedDays.push(res.day); }
        } catch (e: any) {
          perFile.push({ name: res.name, day: res.day, error: e.message });
          failedDays.push(res.day);
        }
        nextDayOffset = Math.max(nextDayOffset, monthDays.indexOf(res.day) + 1);
        if (idx < pendingDays.length - 1) await sleep(BETWEEN_CSV_DELAY_MS);
      }

      // Only fall back to OCDS Search when CKAN gave us literally nothing
      // (all days 403'd or yielded zero rows). CKAN CSV is faster and unrated.
      let fallback: any = null;
      const allDays403 = ckan403Days === pendingDays.length;
      if (allDays403 || totalUpserted === 0) {
        fallbackUsed = "ocds_search";
        const remainingRows = Math.max(1, maxRows - totalUpserted);
        const { timedOut, result } = await withTimeout(ingestMonthDirect(month, remainingRows, nextDayOffset), timeoutBudgetMs);
        fallback = result ?? { rows: 0, upserted: 0, errors: [], status: 599, pages: 0, month_complete: false };
        totalRows += fallback.rows;
        totalUpserted += fallback.upserted;
        pagesFetched += fallback.pages;
        allErrors.push(...(fallback.errors ?? []));
        if (timedOut) allErrors.push({ timed_out: true, month, stage: "ocds_search" });
        monthComplete = fallback.month_complete && nextDayOffset >= monthDays.length;
      } else {
        monthComplete = nextDayOffset >= monthDays.length;
      }

      const skipped = totalUpserted === 0;
      const metrics = {
        month,
        ckan_rows: totalUpserted - (fallback?.upserted ?? 0),
        ocds_rows: fallback?.upserted ?? 0,
        ckan_403_days: ckan403Days,
        pages_fetched: pagesFetched,
        timed_out: Boolean(allErrors.find((e: any) => e?.timed_out)),
        day_offset_start: dayOffset,
        day_offset_end: monthComplete ? monthDays.length : nextDayOffset,
        month_complete: monthComplete,
        fallback_used: fallbackUsed,
        total_upserted: totalUpserted,
      };
      await supabase.from("ingest_runs").update({
        finished_at: new Date().toISOString(), count: totalUpserted,
        errors: [{
          // @ts-ignore TS2783: duplicate key, PRE-EXISTING in the Deno original and behaviour-neutral — the spread of `metrics` re-supplies this exact same variable. Preserved rather than deduped to keep the diff against the original clean.
          month, url_format: fallback ? "ckan_csv+ocds_search" : "ckan_csv",
          // @ts-ignore TS2783: duplicate key, PRE-EXISTING in the Deno original and behaviour-neutral — the spread of `metrics` re-supplies this exact same variable. Preserved rather than deduped to keep the diff against the original clean.
          files: perFile.length, total_rows: totalRows, total_upserted: totalUpserted,
          // @ts-ignore TS2783: duplicate key, PRE-EXISTING in the Deno original and behaviour-neutral — the spread of `metrics` re-supplies this exact same variable. Preserved rather than deduped to keep the diff against the original clean.
          ckan_403_days: ckan403Days, failed_days: failedDays, fallback, skipped,
          per_file: perFile, ...metrics,
        }, ...allErrors],
        duration_ms: Date.now() - start,
      }).eq("id", runId);
      return { ok: true, month, files: perFile.length, total_rows: totalRows, total_upserted: totalUpserted, ckan_403_days: ckan403Days, fallback_used: fallbackUsed !== "none", skipped, per_file: perFile, metrics };
    }

    // Fan-out (async per-day)
    const resources = await fetchMonthResources(month);
    const days = resources.map((r) => r.day).filter(Boolean).sort();
    // PORTED, NOT EQUIVALENT: EdgeRuntime.waitUntil ran this AFTER the response
    // was sent. Lambda freezes on return, so the loop is awaited inline instead.
    // Each invokeSelfAsync is itself async (InvocationType "Event"), so the loop
    // only pays the dispatch cost, not each day's ingest.
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      try {
        await invokeSelfAsync(day);
      } catch (_) { /* ignore */ }
      if (i < days.length - 1) await sleep(BETWEEN_CSV_DELAY_MS);
    }
    await supabase.from("ingest_runs").update({
      finished_at: new Date().toISOString(), count: 0,
      errors: [{ month, fanned_out_days: days.length, note: "see per-day ingest_runs rows" }],
      duration_ms: Date.now() - start,
    }).eq("id", runId);

    return { ok: true, accepted: true, month, days: days.length, run_id: runId };
  } catch (e: any) {
    await supabase.from("ingest_runs").update({
      finished_at: new Date().toISOString(), count: 0,
      errors: [{ fatal: e.message }], duration_ms: Date.now() - start,
    }).eq("id", runId);
    // The original returned HTTP 500; a scheduled Lambda must throw.
    throw e;
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
      "ingest-cf-bulk is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};

// Exported for offline verification: nestRow is the CSV->OCDS shape mapping and
// parseCsv is the csv-parse shim standing in for Deno's std/csv.
export { nestRow, parseCsv, getMonthDays };
