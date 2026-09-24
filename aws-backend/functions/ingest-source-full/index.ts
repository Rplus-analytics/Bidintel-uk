// Daily ingest for source-specific tables (no CPV filter).
// detail.source = fts|ted|pcs (default fts) — ingests last 24h into tenders_<source>.
//
// Ported from supabase/functions/ingest-source-full (Deno) as an EventBridge Lambda.
// parseTedDate, ingestFts, ingestTed and ingestPcs — including the TED field list,
// the 36h PCS cutoff and the oldest-date early exit — are byte-identical.
//
// TIMEOUT: each branch paginates up to 50 pages (FTS/TED) or 10 (PCS) with no
// self-imposed wall-clock budget at all — unlike its sibling backfill functions
// there is no MAX_RUNTIME_MS here. It relied entirely on the platform timeout to
// stop it. On Lambda that means it will run to 900s and then be killed
// mid-pagination with no checkpoint. Give it the full 900s and add a time budget
// if it ever approaches it; see aws-backend/README.md § Timeouts.

import type { ScheduledEvent } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";
import { USER_AGENT } from "../_shared/user-agent";

const supabase = createDbClient();


function parseTedDate(v: any): string | null {
  if (!v) return null;
  let s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})([+\-]\d{2}:?\d{2}|Z)?$/);
  if (m) s = `${m[1]}T00:00:00${m[2] ?? "Z"}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function ingestFts(): Promise<{ count: number; errors: any[] }> {
  const errors: any[] = [];
  const today = new Date();
  const from = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const to = today.toISOString().slice(0, 19);
  let nextUrl: string | null =
    `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages` +
    `?limit=100&updatedFrom=${from}&updatedTo=${to}`;
  let count = 0, pages = 0;
  while (nextUrl && pages < 50) {
    pages++;
    const res = await fetch(nextUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) { errors.push({ pages, status: res.status }); break; }
    const json: any = await res.json();
    const releases: any[] = json.releases ?? [];
    if (!releases.length) break;
    const rows: any[] = [];
    for (const r of releases) {
      const t = r.tender ?? {};
      const ext = r.id ?? r.ocid;
      if (!ext) continue;
      const items: any[] = t.items ?? [];
      const cpv = items.map((it) => it?.classification?.id).filter((x) => typeof x === "string");
      const v = t.value ?? {};
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
    if (rows.length) {
      const { error } = await supabase.from("tenders_fts").upsert(rows, { onConflict: "source,external_id" });
      if (error) errors.push({ pages, upsert: error.message });
      else count += rows.length;
    }
    nextUrl = json.links?.next ?? null;
  }
  return { count, errors };
}

async function ingestTed(): Promise<{ count: number; errors: any[] }> {
  const errors: any[] = [];
  const today = new Date();
  const from = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const to = today.toISOString().slice(0, 10).replace(/-/g, "");
  let page = 1, count = 0;
  while (page <= 50) {
    const res = await fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `publication-date>=${from} AND publication-date<=${to}`,
        fields: ["publication-number","notice-title","description-lot","classification-cpv",
          "buyer-name","publication-date","deadline-receipt-tender-date-lot","links"],
        page, limit: 100, scope: "ALL",
      }),
    });
    if (!res.ok) { errors.push({ page, status: res.status }); break; }
    const json: any = await res.json();
    const notices: any[] = json.notices ?? [];
    if (!notices.length) break;
    const rows: any[] = [];
    for (const n of notices) {
      const ext = n["publication-number"];
      if (!ext) continue;
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
    if (rows.length) {
      const { error } = await supabase.from("tenders_ted").upsert(rows, { onConflict: "source,external_id" });
      if (error) errors.push({ page, upsert: error.message });
      else count += rows.length;
    }
    if (notices.length < 100) break;
    page++;
  }
  return { count, errors };
}

async function ingestPcs(): Promise<{ count: number; errors: any[] }> {
  const errors: any[] = [];
  const cutoff = Date.now() - 36 * 60 * 60 * 1000; // last 36h
  const PCS_BASE = "https://www.publiccontractsscotland.gov.uk/api/1.0/ocdsReleasePackages";
  let count = 0, offset = 0;
  for (let i = 0; i < 10; i++) {
    let json: any;
    try {
      const res = await fetch(`${PCS_BASE}?limit=100&offset=${offset}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      json = await res.json();
    } catch (e: any) { errors.push({ offset, fetch: e.message }); break; }
    const packages: any[] = json.releasePackages ?? json.packages ?? [];
    const releases: any[] = packages.length
      ? packages.flatMap((p: any) => p.releases ?? [])
      : (json.releases ?? []);
    if (!releases.length) break;
    const rows: any[] = [];
    let oldest = Number.POSITIVE_INFINITY;
    for (const r of releases) {
      const t = r.tender ?? {};
      const ext = r.ocid ?? r.id ?? t.id;
      if (!ext) continue;
      const dt = r.date ? Date.parse(r.date) : 0;
      if (dt) oldest = Math.min(oldest, dt);
      const v = t.value ?? {};
      const items: any[] = t.items ?? [];
      const cpv: string[] = [];
      if (t.classification?.id) cpv.push(String(t.classification.id));
      for (const it of items) if (it?.classification?.id) cpv.push(String(it.classification.id));
      rows.push({
        source: "contracts_scotland",
        external_id: String(ext),
        title: t.title ?? null,
        description: t.description ?? null,
        cpv_codes: cpv,
        primary_cpv: cpv[0] ?? null,
        buyer_name: r.buyer?.name ?? null,
        value_min: typeof v.amount === "number" ? v.amount : null,
        value_max: typeof v.amount === "number" ? v.amount : null,
        currency: v.currency ?? "GBP",
        source_url: t.documents?.[0]?.url ?? null,
        published_at: r.date ? new Date(r.date).toISOString() : null,
        published_date: r.date ? new Date(r.date).toISOString() : null,
        deadline_at: t.tenderPeriod?.endDate ? new Date(t.tenderPeriod.endDate).toISOString() : null,
        deadline_date: t.tenderPeriod?.endDate ? new Date(t.tenderPeriod.endDate).toISOString() : null,
        raw_json: r,
        ocid: r.ocid ?? null,
      });
    }
    if (rows.length) {
      const { error } = await supabase.from("tenders_pcs").upsert(rows, { onConflict: "source,external_id" });
      if (error) errors.push({ offset, upsert: error.message });
      else count += rows.length;
    }
    offset += releases.length;
    if (releases.length < 100) break;
    if (oldest && oldest < cutoff) break;
  }
  return { count, errors };
}

async function run(detail: Record<string, any>): Promise<any> {
  // INGEST_SECRET check dropped: EventBridge invocation is IAM-authorised, not
  // a public URL. The ?source= query param becomes detail.source.
  const source = String(detail.source ?? "fts").toLowerCase();
  const start = Date.now();
  let result: { count: number; errors: any[] };
  if (source === "fts") result = await ingestFts();
  else if (source === "ted") result = await ingestTed();
  else if (source === "pcs") result = await ingestPcs();
  else throw new Error("source must be fts|ted|pcs");

  return { source, ...result, duration_ms: Date.now() - start };
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
      "ingest-source-full is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};
