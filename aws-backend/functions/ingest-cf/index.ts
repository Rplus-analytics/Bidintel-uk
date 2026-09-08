// Daily Contracts Finder OCDS ingest into tenders (CPV-filtered).
//
// Ported from supabase/functions/ingest-cf (Deno) as an EventBridge-invoked Lambda.
// Every helper (extractCpv, matchesCpv, mapStatus), the CPV prefix whitelist, the
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
import { upsertLinkedFromRelease } from "../_shared/ocds-linked";
import { mirrorTendersToNotices } from "../_shared/notices-mirror";

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
  return codes.some((c) =>
    TARGET_CPV_PREFIXES.some((p) => c.startsWith(p)),
  );
}

function mapStatus(s: any): string {
  switch (String(s ?? "").toLowerCase()) {
    case "active": return "active";
    case "complete": case "completed": case "unsuccessful": return "complete";
    case "cancelled": case "canceled": return "cancelled";
    case "withdrawn": return "withdrawn";
    case "planned": case "planning": return "planned";
    default: return "unknown";
  }
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
    .insert({ source: "cf", started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = run!.id;

  const errors: any[] = [];
  let totalUpserted = 0;
  let scanned = 0;

  try {
    const today = new Date();
    const from = new Date(today.getTime() - 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19);
    const to = today.toISOString().slice(0, 19);

    let nextUrl: string | null =
      `https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search` +
      `?publishedFrom=${from}&publishedTo=${to}&limit=100`;

    let pages = 0;
    const maxPages = 50;

    while (nextUrl && pages < maxPages) {
      pages++;
      const res = await fetch(nextUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 BidIntel/1.0",
        },
      });
      if (!res.ok) {
        errors.push({ page: pages, status: res.status, body: (await res.text()).slice(0, 300) });
        break;
      }
      const json: any = await res.json();
      const releases: any[] = json.releases ?? [];
      scanned += releases.length;
      if (releases.length === 0) break;

      const rows: any[] = [];
      const releasesToLink: any[] = [];
      for (const r of releases) {
        const t = r.tender ?? {};
        const cpv = extractCpv(t);
        if (!matchesCpv(cpv)) continue;
        const ext = r.id ?? r.ocid;
        if (!ext) continue;
        const v = t.value ?? {};
        rows.push({
          source: "cf",
          external_id: String(ext),
          title: t.title ?? null,
          description: t.description ?? null,
          cpv_codes: cpv,
          primary_cpv: cpv[0] ?? null,
          buyer_name: r.buyer?.name ?? null,
          value_min: typeof v.amount === "number" ? v.amount : null,
          value_max: typeof v.amount === "number" ? v.amount : null,
          currency: v.currency ?? "GBP",
          source_url:
            t.documents?.[0]?.url ??
            `https://www.contractsfinder.service.gov.uk/Notice/${String(ext).replace(/-\d+$/, "")}`,
          published_at: r.date ? new Date(r.date).toISOString() : null,
          deadline_at: t.tenderPeriod?.endDate
            ? new Date(t.tenderPeriod.endDate).toISOString()
            : null,
          contract_start: (r.awards?.[0]?.contractPeriod?.startDate ?? t.contractPeriod?.startDate)
            ? new Date(r.awards?.[0]?.contractPeriod?.startDate ?? t.contractPeriod.startDate).toISOString()
            : null,
          contract_end: (r.awards?.[0]?.contractPeriod?.endDate ?? t.contractPeriod?.endDate)
            ? new Date(r.awards?.[0]?.contractPeriod?.endDate ?? t.contractPeriod.endDate).toISOString()
            : null,
          status: mapStatus(t.status),
          raw_json: r,
          ocid: r.ocid ?? null,
        });
        releasesToLink.push(r);
      }

      if (rows.length > 0) {
        const { data: upserted, error } = await supabase
          .from("tenders")
          .upsert(rows, { onConflict: "source,external_id" })
          .select("id,source,external_id");
        if (error) errors.push({ page: pages, upsertError: error.message });
        else {
          totalUpserted += rows.length;
          const mr = await mirrorTendersToNotices(supabase, rows);
          if (mr.error) errors.push({ page: pages, noticesMirror: mr.error });
          const idMap = new Map<string, string>();
          for (const u of upserted ?? []) idMap.set(`${u.source}:${u.external_id}`, u.id);
          for (const r of releasesToLink) {
            const ext = r.id ?? r.ocid;
            const tid = idMap.get(`cf:${ext}`);
            if (!tid) continue;
            const { errors: linkErrs } = await upsertLinkedFromRelease(supabase, "cf", r, tid, "GB");
            if (linkErrs.length) errors.push({ page: pages, linked: linkErrs });
          }
        }
      }

      nextUrl = json.links?.next ?? null;
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
      "ingest-cf is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};

// Exported for offline verification of the CPV filter and status mapping.
export { extractCpv, matchesCpv, mapStatus };
