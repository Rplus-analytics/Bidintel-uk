// Backfills the seven linked tables (buyers, tender_lots, tender_cpv,
// tender_documents, awards, suppliers, award_suppliers) from tenders.raw_json.
//
// ============================================================================
// READ THIS BEFORE DEPLOYING — the original has its auth check commented out
// ============================================================================
//
// The Deno original contains, verbatim:
//
//     // TEMP: auth disabled for one-off backfill run
//     // const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
//
// So there is NO caller check of any kind. To be precise about the exposure,
// because it is narrower than it first looks and the accurate version still
// matters: config.toml leaves verify_jwt at its default of TRUE for this
// function, so Supabase's platform still demands a valid JWT. But the anon key
// IS a valid JWT and it ships inside the frontend bundle — so in practice anyone
// who opens devtools can drive this endpoint, and once past the platform check
// there is no user, role or org check whatsoever. It then performs unbounded
// writes across seven tables using the service-role key.
//
// It is also, by its own comment, a ONE-OFF.
//
// ---------------------------------------------------------------------------
// RECOMMENDATION: do not deploy this as an endpoint at all. Run it as a script.
// ---------------------------------------------------------------------------
//
// Reasons, in order of weight:
//
//   1. It is already script-shaped. Unlike every other worker in this batch it
//      keeps NO cursor in backfill_state — the caller passes `offset` and reads
//      `next_offset` back to drive the next call. That is an operator running a
//      loop, which is the definition of a script, not a service.
//   2. Its own comment says one-off. A deployed endpoint is permanent attack
//      surface for something intended to run once.
//   3. Run as a script with admin database credentials, the credentials ARE the
//      authorisation. There is no auth layer to get wrong, and nothing to leave
//      commented out.
//   4. It is idempotent (upserts throughout), so re-running is safe — which is
//      exactly what makes an operator-driven loop the right shape.
//
// So runBackfillLinkedTables() below is the real deliverable, exported for a
// script or a one-shot `aws lambda invoke`.
//
// If it must stay reachable — say new raw_json keeps arriving and it needs to
// re-run periodically — the answer is NOT to re-enable the header check. It is to
// give it a backfill_state cursor like its five siblings and move it to
// EventBridge, which removes the HTTP surface entirely. Re-enabling a bearer
// check would leave a write-capable public endpoint guarded by a shared secret,
// which is strictly worse than having no endpoint.
//
// The handler at the bottom is therefore DISABLED BY DEFAULT and fails closed: it
// requires BACKFILL_LINKED_TABLES_ENABLED=true *and* a matching
// BACKFILL_ADMIN_TOKEN. Deploying it accidentally cannot create an open endpoint.
// That is a deliberate DEPARTURE from the original's behaviour — the one place in
// 24 ported functions where fidelity was knowingly not the goal, because porting
// this faithfully means shipping an unauthenticated write endpoint to a new cloud.
//
// Everything else — the tenders query, the ted-vs-ocds branch, the per-table count
// tally and the next_offset paging — is byte-identical to the original.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";
import { upsertLinkedFromRelease, enrichTedTender } from "../_shared/ocds-linked";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const supabase = createDbClient();

/**
 * The actual work. Import this from a script:
 *
 *   import { runBackfillLinkedTables } from "./index";
 *   let offset: number | null = 0;
 *   while (offset !== null) {
 *     const r = await runBackfillLinkedTables(offset, 50);
 *     console.log(r.offset, r.processed, r.link_error_count);
 *     offset = r.next_offset;
 *   }
 *
 * Idempotent, so a crashed run restarts from the last printed offset.
 */
export async function runBackfillLinkedTables(offset = 0, limitArg = 50) {
  const limit: number = Math.min(Number(limitArg), 200);

    const { data: tenders, error } = await supabase
      .from("tenders")
      .select("id, source, external_id, raw_json")
      .not("raw_json", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      // Was an HTTP 500; this is a plain function now, so it throws.
      throw new Error(error.message);
    }

    let processed = 0;
    const linkErrors: any[] = [];

    for (const t of tenders ?? []) {
      const release = (t as any).raw_json;
      const src = (t as any).source;
      if (!release || typeof release !== "object") continue;
      try {
        const { errors: errs } = src === "ted"
          ? await enrichTedTender(supabase, (t as any).id, release)
          : await upsertLinkedFromRelease(supabase, src, release, (t as any).id, "GB");
        if (errs?.length) linkErrors.push({ ext: (t as any).external_id, errs });
        processed++;
      } catch (e: any) {
        linkErrors.push({ ext: (t as any).external_id, fatal: e.message });
      }
    }

    console.log(`[backfill-linked-tables] offset=${offset} processed=${processed} errors=${linkErrors.length}`);

    // Tally linked counts (current totals, useful for monitoring progress)
    const counts: Record<string, number> = {};
    for (const tbl of ["buyers", "tender_lots", "tender_cpv", "tender_documents", "awards", "suppliers", "award_suppliers"]) {
      const { count } = await supabase.from(tbl).select("*", { count: "exact", head: true });
      counts[tbl] = count ?? 0;
    }

    const nextOffset = (tenders?.length ?? 0) === limit ? offset + limit : null;

  return {
    offset,
    limit,
    processed,
    next_offset: nextOffset,
    counts,
    link_error_sample: linkErrors.slice(0, 5),
    link_error_count: linkErrors.length,
  };
}

/**
 * Optional HTTP entry point. FAILS CLOSED — see the recommendation above.
 * Prefer not deploying this at all.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  // Guard 1: off unless explicitly switched on.
  if (process.env.BACKFILL_LINKED_TABLES_ENABLED !== "true") {
    return {
      statusCode: 403,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "disabled",
        detail:
          "backfill-linked-tables is disabled by default. It is a one-off backfill and the " +
          "recommendation is to run runBackfillLinkedTables() as a script rather than deploy it.",
      }),
    };
  }

  // Guard 2: a token must be CONFIGURED and PRESENTED. Never compare against an
  // unset variable — an absent token would otherwise authorise everything.
  const expected = process.env.BACKFILL_ADMIN_TOKEN;
  const presented = event.headers?.authorization?.replace("Bearer ", "");
  if (!expected || !presented || presented !== expected) {
    return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  if (!isDbConfigured()) {
    const message =
      "backfill-linked-tables is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds).";
    console.warn(message);
    return { statusCode: 501, headers: jsonHeaders, body: JSON.stringify({ error: message }) };
  }

  let body: any = {};
  try {
    const raw = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body ?? "";
    body = JSON.parse(raw);
  } catch {
    body = {};
  }

  try {
    const result = await runBackfillLinkedTables(Number(body.offset ?? 0), Number(body.limit ?? 50));
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify(result) };
  } catch (e: any) {
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: e?.message ?? String(e) }) };
  }
};
