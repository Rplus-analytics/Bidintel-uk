// Backfills the last 6 months of notices from all 7 sources into public.notices.
// Calls the migrated source proxies and upserts results in batches.
//
// Ported from supabase/functions/sync-notices (Deno) as an EventBridge Lambda.
// toRow, the dedupe-within-batch, the buyer name->id resolution with its 200-name
// IN-list chunking, the 500-row notices chunking and the notices_sync_log
// bookkeeping are byte-identical.
//
// TWO THINGS TO KNOW BEFORE DEPLOYING:
//
// 1. FOUR OF ITS SEVEN SOURCES DO NOT EXIST. The `sources` list below names
//    ted-eu, sell2wales, etenders-ireland and etenders-ni. There is no edge
//    function with any of those names in supabase/functions/ — they 404, and
//    callSource swallows the failure and returns []. So this function has only
//    ever actually synced three sources: contracts-finder, contracts-scotland
//    and find-a-tender. The list is preserved as-is rather than silently
//    trimmed, because deleting entries would change behaviour if those
//    functions are ever written. Decide before deploying.
//
// 2. IT IS ALSO CALLED FROM THE FRONTEND. src/pages/Admin.tsx invokes
//    sync-notices via supabase.functions.invoke, so it is not purely a cron job.
//    This port is EventBridge-shaped as instructed; if the admin button is kept,
//    it needs an API Gateway route as well, and that route needs auth (it is an
//    expensive, write-heavy operation) — which lands it in the Cognito work.
//
// TIMEOUT: callSource allows each source 140_000ms and there are 7 of them, run
// SEQUENTIALLY. Worst case is ~16 minutes, which EXCEEDS Lambda's 900s ceiling.
// In practice the four dead sources fail fast, but if they are ever implemented
// this function cannot fit in one Lambda. See aws-backend/README.md § Timeouts.

import type { ScheduledEvent } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";


interface SourceNotice {
  id: string;
  title: string;
  buyer: string;
  description: string;
  value: number;
  valueHigh: number;
  currency: string;
  status: string;
  publishedDate: string;
  deadlineDate: string;
  region: string;
  sector: string;
  cpvCode: string;
  source: string;
  noticeType: string;
  link: string;
}

// TODO(config): base URL of the migrated source proxies. On Supabase these were
// sibling edge functions at ${SUPABASE_URL}/functions/v1/<fn>. On AWS they are
// the API Gateway routes stood up for contracts-finder / contracts-scotland /
// find-a-tender in batch 1, so this is the API Gateway stage base URL. Those
// routes are unauthenticated, so no Authorization header is needed.
const SOURCE_FN_BASE = process.env.SOURCE_FN_BASE ?? "";

async function callSource(fn: string, body: Record<string, unknown>): Promise<SourceNotice[]> {
  const url = `${SOURCE_FN_BASE}/${fn}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 140_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[${fn}] ${res.status}`);
      return [];
    }
    const data: any = await res.json();
    return Array.isArray(data?.notices) ? data.notices : [];
  } catch (e) {
    console.warn(`[${fn}] threw`, e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toRow(n: SourceNotice) {
  return {
    source: n.source || "unknown",
    external_id: n.id,
    title: n.title || "",
    buyer: n.buyer || null,
    description: n.description || null,
    value: Number.isFinite(n.value) ? n.value : null,
    value_high: Number.isFinite(n.valueHigh) ? n.valueHigh : null,
    currency: n.currency || null,
    status: n.status || null,
    published_date: n.publishedDate || null,
    deadline_date: n.deadlineDate || null,
    region: n.region || null,
    sector: n.sector || null,
    cpv_code: n.cpvCode || null,
    notice_type: n.noticeType || null,
    link: n.link || null,
  };
}

async function run(detail: Record<string, any>): Promise<any> {
  const admin = createDbClient();

  // 6 months window
  const now = new Date();
  const from = new Date();
  from.setMonth(now.getMonth() - 6);

  const baseParams = {
    publishedFrom: from.toISOString(),
    publishedTo: now.toISOString(),
    limit: 100,
  };
  const dateFromMMYYYY = `${String(from.getMonth() + 1).padStart(2, "0")}-${from.getFullYear()}`;

  const sources = [
    { fn: "contracts-finder", body: baseParams },
    { fn: "contracts-scotland", body: { dateFrom: dateFromMMYYYY, noticeType: 2, limit: 100 } },
    { fn: "find-a-tender", body: baseParams },
    { fn: "ted-eu", body: baseParams },
    { fn: "sell2wales", body: baseParams },
    { fn: "etenders-ireland", body: baseParams },
    { fn: "etenders-ni", body: baseParams },
  ];

  const results: Array<{ source: string; fetched: number; upserted: number; error?: string }> = [];

  // Run sources sequentially to avoid CPU/memory spikes
  for (const s of sources) {
    const startedAt = new Date().toISOString();
    try {
      const notices = await callSource(s.fn, s.body);
      let upserted = 0;
      if (notices.length > 0) {
        const rows = notices
          .filter((n) => n.id && n.title)
          .map(toRow);
        // Dedupe within batch on (source, external_id)
        const seen = new Set<string>();
        const unique = rows.filter((r) => {
          const k = `${r.source}::${r.external_id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        // 1) Resolve buyers: upsert unique buyer names, then map name -> id
        const buyerNames = Array.from(
          new Set(unique.map((r) => (r.buyer || "").trim()).filter((b) => b.length > 0)),
        );
        const buyerIdByName = new Map<string, string>();
        if (buyerNames.length > 0) {
          const buyerRows = buyerNames.map((name) => ({ name }));
          const { error: bErr } = await admin
            .from("buyers")
            .upsert(buyerRows, { onConflict: "name", ignoreDuplicates: true });
          if (bErr) console.warn(`[${s.fn}] buyers upsert warn`, bErr.message);
          // Fetch ids in chunks (IN list cap)
          for (let i = 0; i < buyerNames.length; i += 200) {
            const slice = buyerNames.slice(i, i + 200);
            const { data: bData, error: qErr } = await admin
              .from("buyers")
              .select("id,name")
              .in("name", slice);
            if (qErr) {
              console.warn(`[${s.fn}] buyers fetch warn`, qErr.message);
              continue;
            }
            for (const b of bData || []) buyerIdByName.set(b.name as string, b.id as string);
          }
        }
        // Attach buyer_id to each notice row
        for (const r of unique) {
          const key = (r.buyer || "").trim();
          (r as Record<string, unknown>).buyer_id = key ? buyerIdByName.get(key) ?? null : null;
        }

        // 2) Upsert notices in chunks of 500
        for (let i = 0; i < unique.length; i += 500) {
          const chunk = unique.slice(i, i + 500);
          const { error } = await admin
            .from("notices")
            .upsert(chunk, { onConflict: "source,external_id" });
          if (error) {
            console.error(`[${s.fn}] upsert error`, error);
            results.push({ source: s.fn, fetched: notices.length, upserted, error: error.message });
            await admin.from("notices_sync_log").insert({
              started_at: startedAt,
              finished_at: new Date().toISOString(),
              source: s.fn,
              inserted: upserted,
              error: error.message,
            });
            break;
          }
          upserted += chunk.length;
        }
      }
      await admin.from("notices_sync_log").insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        source: s.fn,
        inserted: upserted,
      });
      results.push({ source: s.fn, fetched: notices.length, upserted });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${s.fn}] failed`, msg);
      await admin.from("notices_sync_log").insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        source: s.fn,
        inserted: 0,
        error: msg,
      });
      results.push({ source: s.fn, fetched: 0, upserted: 0, error: msg });
    }
  }

  const totalUpserted = results.reduce((a, r) => a + r.upserted, 0);
  return { ok: true, totalUpserted, results };
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
      "sync-notices is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};
