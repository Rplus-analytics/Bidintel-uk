// Daily Public Contracts Scotland ingest into tenders (CPV-filtered).
//
// Ported from supabase/functions/ingest-contracts-scotland (Deno) as an EventBridge-invoked Lambda.
// Every helper (extractCpv, matchesCpv, fetchPcs), the CPV prefix whitelist, the
// pagination loop, the row mapping and the ingest_runs bookkeeping are carried
// over byte-identically — verified by diff against the original.
//
// Runtime shell only:
//   Deno.serve(req)  -> EventBridge handler (no HTTP framing, no CORS)
//   INGEST_SECRET check -> dropped (see the comment at the top of run())
//   Response.json()  -> plain return value
//   supabase client  -> stubbed, see functions/_shared/db.ts
//
// TIMEOUT: this paginates up to 50 pages of 100 records against a gov.uk API,
// upserting each page and then linking child rows one release at a time. On
// Supabase it ran under a ~150s wall clock. On Lambda give it 900s (the ceiling)
// and watch the duration metric — see aws-backend/README.md § Timeouts.

import type { ScheduledEvent } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";
import { USER_AGENT } from "../_shared/user-agent";

const TARGET_CPV_PREFIXES = ["72", "73", "79", "80", "85"];

const supabase = createDbClient();


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

function matchesCpv(codes: string[]): boolean {
  return codes.some((c) => TARGET_CPV_PREFIXES.some((p) => c.startsWith(p)));
}

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json",
};

const BASE = "https://www.publiccontractsscotland.gov.uk/api/1.0/ocdsReleasePackages";

// Fetch via the www subdomain (api.* has a Sectigo cert chain Deno rejects).
// Falls back to r.jina.ai proxy if direct still fails.
async function fetchPcs(url: string): Promise<any> {
  try {
    const res = await fetch(url, { headers: HEADERS });
    const ctype = res.headers.get("content-type") ?? "";
    if (res.ok && ctype.includes("json")) return await res.json();
  } catch (_) { /* fall through */ }

  const proxied = `https://r.jina.ai/${url}`;
  const res = await fetch(proxied, { headers: { "Accept": "text/plain" } });
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const text = await res.text();
  const start = text.indexOf("{");
  if (start < 0) throw new Error("proxy returned no JSON body");
  return JSON.parse(text.slice(start));
}

async function run(detail: Record<string, any>): Promise<any> {
  // The Deno original gated on a shared INGEST_SECRET because Supabase Edge
  // Functions are publicly reachable URLs. An EventBridge-invoked Lambda is not:
  // invocation is IAM-authorised by the rule's permission. The secret check is
  // therefore dropped rather than reimplemented — re-add it only if this
  // function is also exposed through API Gateway.

  const runStart = Date.now();
  const { data: run } = await supabase
    .from("ingest_runs")
    .insert({ source: "contracts_scotland", started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = run!.id;

  const errors: any[] = [];
  let totalUpserted = 0;
  let scanned = 0;

  try {
    let offset = 0;
    const limit = 100;
    const maxPages = 50;

    for (let page = 0; page < maxPages; page++) {
      const url = `${BASE}?limit=${limit}&offset=${offset}`;

      let json: any;
      try {
        json = await fetchPcs(url);
      } catch (e: any) {
        errors.push({ offset, fetchError: e.message });
        break;
      }

      const packages: any[] = json.releasePackages ?? json.packages ?? [];
      const releases: any[] = packages.length
        ? packages.flatMap((p: any) => p.releases ?? [])
        : (json.releases ?? []);
      scanned += releases.length;
      if (releases.length === 0) break;

      const rows: any[] = [];
      for (const r of releases) {
        const t = r.tender ?? {};
        const cpv = extractCpv(t);
        if (!matchesCpv(cpv)) continue;
        const ext = r.ocid ?? r.id;
        if (!ext) continue;
        const v = t.value ?? {};
        rows.push({
          source: "contracts_scotland",
          external_id: String(ext),
          title: t.title ?? null,
          description: t.description ?? null,
          cpv_codes: cpv,
          buyer_name: r.buyer?.name ?? null,
          value_min: typeof v.amount === "number" ? v.amount : null,
          value_max: typeof v.amount === "number" ? v.amount : null,
          currency: v.currency ?? "GBP",
          source_url: t.documents?.[0]?.url ?? null,
          published_at: r.date ? new Date(r.date).toISOString() : null,
          deadline_at: t.tenderPeriod?.endDate
            ? new Date(t.tenderPeriod.endDate).toISOString()
            : null,
          raw_json: r,
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("tenders")
          .upsert(rows, { onConflict: "source,external_id" });
        if (error) errors.push({ offset, upsertError: error.message });
        else totalUpserted += rows.length;
      }

      if (releases.length < limit) break;
      offset += limit;
    }
  } catch (e: any) {
    errors.push({ fatal: e.message });
  }

  const duration = Date.now() - runStart;
  await supabase
    .from("ingest_runs")
    .update({
      finished_at: new Date().toISOString(),
      count: totalUpserted,
      errors: errors.length ? errors : null,
      duration_ms: duration,
    })
    .eq("id", runId);

  return { run_id: runId, scanned, count: totalUpserted, errors, duration_ms: duration };
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
      "ingest-contracts-scotland is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};
