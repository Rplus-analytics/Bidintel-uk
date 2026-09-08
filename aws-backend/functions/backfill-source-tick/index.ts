// Per-minute backfill for source-specific tables (no CPV filter).
// Handles: fts_full -> tenders_fts, ted_full -> tenders_ted, pcs_full -> tenders_pcs.
// Caps at 200 rows per source per tick. Walks month-by-month for fts/ted,
// offset-by-offset for pcs (PCS API does not support date filtering).
//
// TRIGGER: CRON -> EventBridge. "Per-minute backfill", INGEST_SECRET-gated,
// no frontend caller, drives its own backfill_state cursors.
//
// Ported from supabase/functions/backfill-source-tick (Deno). backfillFts,
// backfillTed, backfillPcs, upsert() with its in-batch dedupe, parseTedDate,
// monthRange/nextMonth/isCurrentOrFuture, pcsWeekRange/pcsNextWeek, the
// fetchPcsJson three-tier fallback and the pcs_full legacy-cursor normalisation
// are byte-identical. The embedded Sectigo PEM was spliced from the original and
// diff-verified, not retyped.
//
// TLS: the Deno original installed the Sectigo intermediate via
// Deno.createHttpClient({ caCerts }). Node has no such API, so this uses an
// undici Agent as the fetch dispatcher with the cert APPENDED to
// tls.rootCertificates — the same treatment as contracts-scotland in batch 1.
// Appending matters: passing the intermediate alone REPLACES the default trust
// store and would break verification of the rest of the chain.
//
// TIMEOUT: no wall-clock budget — only MAX_ROWS_PER_TICK (500, despite the header
// comment saying 200) and page caps of 50. The three sources run CONCURRENTLY via
// Promise.all. fetchPcsJson can serially attempt three transports (direct+CA,
// plain direct, then a 30s r.jina.ai proxy) before giving up, so the PCS branch
// alone can burn over a minute on failure. Give it 900s.

import type { ScheduledEvent } from "aws-lambda";
import { Agent } from "undici";
import { rootCertificates } from "node:tls";
import { createDbClient, isDbConfigured } from "../_shared/db";

const MAX_ROWS_PER_TICK = 500;

const supabase = createDbClient();


function monthRange(year: number, month0: number) {
  const from = new Date(Date.UTC(year, month0, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}
function nextMonth(year: number, month0: number) {
  return month0 === 11 ? { year: year + 1, month0: 0 } : { year, month0: month0 + 1 };
}
function isCurrentOrFuture(year: number, month0: number) {
  const now = new Date();
  return year > now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month0 >= now.getUTCMonth());
}
function parseTedDate(v: any): string | null {
  if (!v) return null;
  let s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})([+\-]\d{2}:?\d{2}|Z)?$/);
  if (m) s = `${m[1]}T00:00:00${m[2] ?? "Z"}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function upsert(table: string, rows: any[]) {
  if (!rows.length) return 0;
  // Dedupe within batch on (source, external_id) to avoid
  // "ON CONFLICT DO UPDATE command cannot affect row a second time"
  const seen = new Map<string, any>();
  for (const r of rows) seen.set(`${r.source}::${r.external_id}`, r);
  const deduped = Array.from(seen.values());
  const { error } = await supabase
    .from(table)
    .upsert(deduped, { onConflict: "source,external_id" });
  if (error) throw new Error(`${table} upsert: ${error.message}`);
  return deduped.length;
}

// ---- FTS (Find a Tender) ---------------------------------------------------
async function backfillFts(from: string, to: string): Promise<number> {
  let nextUrl: string | null =
    `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages` +
    `?limit=100&updatedFrom=${from}T00:00:00&updatedTo=${to}T23:59:59`;
  let count = 0, pages = 0;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) break;
    const json: any = await res.json();
    const releases: any[] = json.releases ?? [];
    if (!releases.length) break;
    const rows: any[] = [];
    const rawRows: any[] = [];
    for (const r of releases) {
      const t = r.tender ?? {};
      const ext = r.id ?? r.ocid;
      if (!ext) continue;
      const items: any[] = t.items ?? [];
      const cpv = items.map((it) => it?.classification?.id).filter((x) => typeof x === "string");
      const v = t.value ?? {};
      const ocid = r.ocid ?? null;
      if (ocid) {
        rawRows.push({
          ocid: String(ocid),
          release_id: r.id ? String(r.id) : null,
          published_date: r.date ? new Date(r.date).toISOString() : null,
          payload: r,
        });
      }
      rows.push({
        source: "fts",
        external_id: String(ext),
        title: t.title ?? null,
        description: t.description ?? null,
        cpv_codes: cpv,
        primary_cpv: cpv[0] ?? null,
        buyer_name: r.buyer?.name ?? null,
        value_min: typeof v.amount === "number" ? v.amount : null,
        value_max: typeof v.amount === "number" ? v.amount : null,
        currency: v.currency ?? "GBP",
        source_url: `https://www.find-tender.service.gov.uk/Notice/${ext}`,
        published_at: r.date ? new Date(r.date).toISOString() : null,
        published_date: r.date ? new Date(r.date).toISOString() : null,
        deadline_at: t.tenderPeriod?.endDate ? new Date(t.tenderPeriod.endDate).toISOString() : null,
        deadline_date: t.tenderPeriod?.endDate ? new Date(t.tenderPeriod.endDate).toISOString() : null,
        raw_json: r,
        ocid: r.ocid ?? null,
      });
    }
    count += await upsert("tenders_fts", rows);
    if (rawRows.length) {
      const seenRaw = new Map<string, any>();
      for (const rr of rawRows) seenRaw.set(rr.ocid, rr);
      const { error: rawErr } = await supabase
        .from("raw_fts")
        .upsert(Array.from(seenRaw.values()), { onConflict: "ocid" });
      if (rawErr) throw new Error(`raw_fts upsert: ${rawErr.message}`);
    }
    if (count >= MAX_ROWS_PER_TICK) break;
    nextUrl = json.links?.next ?? null;
    if (++pages > 50) break;
  }
  return count;
}

// ---- TED EU ----------------------------------------------------------------
async function backfillTed(from: string, to: string): Promise<number> {
  let page = 1, count = 0;
  while (true) {
    const body = {
      query: `publication-date>=${from.replace(/-/g, "")} AND publication-date<=${to.replace(/-/g, "")}`,
      fields: ["publication-number","notice-title","description-lot","classification-cpv",
        "buyer-name","publication-date","deadline-receipt-tender-date-lot","links"],
      page, limit: 100, scope: "ALL",
    };
    const res = await fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) break;
    const json: any = await res.json();
    const notices: any[] = json.notices ?? [];
    if (!notices.length) break;
    const rows: any[] = [];
    const rawRows: any[] = [];
    for (const n of notices) {
      const ext = n["publication-number"];
      if (!ext) continue;
      const pubForRaw = parseTedDate(n["publication-date"]);
      rawRows.push({ ocid: String(ext), published_date: pubForRaw, payload: n });
      const cpvRaw = n["classification-cpv"];
      const cpv: string[] = (Array.isArray(cpvRaw) ? cpvRaw : [cpvRaw])
        .map((c: any) => (typeof c === "string" ? c : c?.code)).filter(Boolean);
      const titleObj = n["notice-title"];
      const title = typeof titleObj === "string" ? titleObj : titleObj?.eng ?? null;
      const descObj = n["description-lot"];
      const description = typeof descObj === "string" ? descObj : descObj?.eng ?? null;
      const pub = parseTedDate(n["publication-date"]);
      const deadline = parseTedDate(n["deadline-receipt-tender-date-lot"]);
      rows.push({
        source: "ted",
        external_id: String(ext),
        title, description,
        cpv_codes: cpv,
        primary_cpv: cpv[0] ?? null,
        buyer_name: typeof n["buyer-name"] === "string" ? n["buyer-name"] : n["buyer-name"]?.eng ?? null,
        currency: "EUR",
        source_url: `https://ted.europa.eu/udl?uri=TED:NOTICE:${ext}`,
        published_at: pub, published_date: pub,
        deadline_at: deadline, deadline_date: deadline,
        raw_json: n,
      });
    }
    count += await upsert("tenders_ted", rows);
    if (rawRows.length) {
      const seenRaw = new Map<string, any>();
      for (const rr of rawRows) seenRaw.set(rr.ocid, rr);
      const { error: rawErr } = await supabase
        .from("raw_ted")
        .upsert(Array.from(seenRaw.values()), { onConflict: "ocid" });
      if (rawErr) throw new Error(`raw_ted upsert: ${rawErr.message}`);
    }
    if (count >= MAX_ROWS_PER_TICK) break;
    if (notices.length < 100) break;
    if (++page > 50) break;
  }
  return count;
}

// ---- PCS (Public Contracts Scotland) ---------------------------------------
// Walk by 1-week date ranges using state.year (year) and state.month0 (week index 0..52).
// PCS only sends the leaf cert (not the Sectigo intermediate), so we install the
// intermediate via Deno.createHttpClient so the chain validates inside the edge runtime.
const PCS_BASE = "https://api.publiccontractsscotland.gov.uk/v1/Notices";

const SECTIGO_INTERMEDIATE_PEM = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;

let PCS_HTTP_CLIENT: Agent | undefined | null = null;
function getPcsClient(): Agent | undefined {
  if (PCS_HTTP_CLIENT !== null) return PCS_HTTP_CLIENT ?? undefined;
  try {
    // Node equivalent of Deno.createHttpClient({ caCerts }): an undici Agent used
    // as the fetch dispatcher. The cert is APPENDED to Node's built-in roots —
    // supplying `ca` alone would REPLACE the default store and break the chain.
    PCS_HTTP_CLIENT = new Agent({
      connect: { ca: [...rootCertificates, SECTIGO_INTERMEDIATE_PEM] },
    });
  } catch (_) { PCS_HTTP_CLIENT = undefined; }
  return PCS_HTTP_CLIENT ?? undefined;
}

function pcsWeekRange(year: number, weekIdx: number): { from: string; to: string } {
  const startMs = Date.UTC(year, 0, 1) + weekIdx * 7 * 86400000;
  const endMs = Math.min(startMs + 6 * 86400000, Date.UTC(year, 11, 31));
  return {
    from: new Date(startMs).toISOString().slice(0, 10),
    to: new Date(endMs).toISOString().slice(0, 10),
  };
}
function pcsNextWeek(year: number, weekIdx: number): { year: number; weekIdx: number } {
  const next = weekIdx + 1;
  const startMs = Date.UTC(year, 0, 1) + next * 7 * 86400000;
  if (startMs > Date.UTC(year, 11, 31)) return { year: year + 1, weekIdx: 0 };
  return { year, weekIdx: next };
}

async function fetchPcsJson(url: string): Promise<any> {
  // 1) Direct call with the Sectigo intermediate trusted (if runtime allows).
  const client = getPcsClient();
  if (client) {
    try {
      const res = await fetch(url, {
        // Node's global fetch IS undici, so it honours the dispatcher option.
        dispatcher: client,
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 BidIntel/1.0" },
      } as any);
      if (res.ok) return await res.json();
      await res.body?.cancel();
    } catch (_) { /* fall through */ }
  }
  // 2) Plain direct fetch (in case the runtime already trusts the chain).
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 BidIntel/1.0" },
    });
    if (res.ok) return await res.json();
    await res.body?.cancel();
  } catch (_) { /* fall through */ }
  // 3) Last-ditch: r.jina.ai text proxy.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "X-Return-Format": "text" },
    });
    if (!res.ok) throw new Error(`jina ${res.status}`);
    const text = await res.text();
    // jina prefixes the body with markdown headers; the real JSON starts
    // with `{"uri":` returned by the PCS API.
    const m = text.match(/\{"uri":[\s\S]+/);
    if (!m) throw new Error("jina: PCS payload not found");
    return JSON.parse(m[0]);
  } finally { clearTimeout(t); }
}

async function backfillPcs(year: number, weekIdx: number): Promise<number> {
  const { from, to } = pcsWeekRange(year, weekIdx);
  const url = `${PCS_BASE}?dateFrom=${from}&dateTo=${to}`;
  const json = await fetchPcsJson(url);
  const releases: any[] = json.releases ?? [];
  if (!releases.length) return 0;

  const rows: any[] = [];
  for (const r of releases) {
    const t = r.tender ?? {};
    const ext = r.id ?? r.ocid ?? t.id;
    if (!ext) continue;
    const v = t.value ?? {};
    const items: any[] = t.items ?? [];
    const cpv: string[] = [];
    if (t.classification?.id) cpv.push(String(t.classification.id));
    for (const it of items) {
      if (it?.classification?.id) cpv.push(String(it.classification.id));
      for (const ac of it?.additionalClassifications ?? []) {
        if (ac?.scheme === "CPV" && ac?.id) cpv.push(String(ac.id));
      }
    }
    const buyerName = r.buyer?.name
      ?? (r.parties ?? []).find((p: any) => (p.roles ?? []).includes("buyer"))?.name
      ?? null;
    const region = (r.parties ?? []).find((p: any) => (p.roles ?? []).includes("buyer"))?.address?.region ?? null;
    const docUrl = t.documents?.[0]?.url
      ?? `https://www.publiccontractsscotland.gov.uk/search/show/search_view.aspx?ID=${encodeURIComponent(String(t.id ?? ext))}`;

    rows.push({
      source: "contracts_scotland",
      external_id: String(ext),
      title: t.title ?? null,
      description: t.description ?? null,
      cpv_codes: cpv,
      primary_cpv: cpv[0] ?? null,
      buyer_name: buyerName,
      region,
      value_min: typeof v.amount === "number" ? v.amount : null,
      value_max: typeof v.amount === "number" ? v.amount : null,
      currency: v.currency ?? "GBP",
      source_url: docUrl,
      published_at: r.date ? new Date(r.date).toISOString() : null,
      published_date: r.date ? new Date(r.date).toISOString() : null,
      deadline_at: t.tenderPeriod?.endDate ? new Date(t.tenderPeriod.endDate).toISOString() : null,
      deadline_date: t.tenderPeriod?.endDate ? new Date(t.tenderPeriod.endDate).toISOString() : null,
      country: "GB",
      raw_json: r,
      ocid: r.ocid ?? null,
    });
    if (rows.length >= MAX_ROWS_PER_TICK) break;
  }
  return await upsert("tenders_pcs", rows);
}

// ---- Driver ----------------------------------------------------------------
const HANDLED = new Set(["fts_full", "ted_full", "pcs_full"]);

async function run(detail: Record<string, any>): Promise<any> {
  // INGEST_SECRET check dropped: EventBridge invocation is IAM-authorised.

  const { data: states, error } = await supabase
    .from("backfill_state")
    .select("*")
    .eq("completed", false)
    .in("source", Array.from(HANDLED));
  if (error) throw new Error(`backfill_state read: ${error.message}`);

  const results = await Promise.all((states ?? []).map(async (s) => {
    const start = Date.now();
    let inserted = 0, err: string | null = null;
    let nextYear = s.year, nextMonth0 = s.month0, completed = false;

    try {
      if (s.source === "fts_full" || s.source === "ted_full") {
        const { from, to } = monthRange(s.year, s.month0);
        if (s.source === "fts_full") inserted = await backfillFts(from, to);
        else inserted = await backfillTed(from, to);
        const nm = nextMonth(s.year, s.month0);
        nextYear = nm.year; nextMonth0 = nm.month0;
        completed = isCurrentOrFuture(nextYear, nextMonth0);
      } else if (s.source === "pcs_full") {
        // state.year = year, state.month0 = week-of-year index (0..52).
        // Normalise legacy values where year was used as offset (>=2000 means it was already a year).
        let curYear = s.year, curWeek = s.month0;
        if (curYear < 2015) { curYear = 2015; curWeek = 0; }
        if (curWeek < 0 || curWeek > 52) curWeek = 0;
        inserted = await backfillPcs(curYear, curWeek);
        const nw = pcsNextWeek(curYear, curWeek);
        nextYear = nw.year; nextMonth0 = nw.weekIdx;
        const today = new Date();
        completed = nextYear > today.getUTCFullYear();
      }
    } catch (e: any) { err = e.message; }

    await supabase.from("backfill_state").update({
      year: nextYear, month0: nextMonth0, completed,
      last_run_at: new Date().toISOString(),
    }).eq("source", s.source);

    return { source: s.source, inserted, error: err, next: { year: nextYear, month0: nextMonth0 }, completed, ms: Date.now() - start };
  }));

  return { results };
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
      "backfill-source-tick is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};

// Exported for offline verification of the PCS week-cursor arithmetic and the
// TLS dispatcher construction.
export { pcsWeekRange, pcsNextWeek, monthRange, nextMonth, isCurrentOrFuture, getPcsClient };
