// Backfill source_status + derived_status across tenders and notices.
// Idempotent. Invoke repeatedly until {coverage.unknown_count} stabilises.
//
// TRIGGER: ON-DEMAND -> API Gateway, NOT EventBridge.
//
// This is the one function in this batch that is genuinely operator-driven. Its
// own header documents a curl invocation with tuning parameters
// (?batch=2000&iter=8), it says "invoke repeatedly until coverage stabilises",
// it keeps no backfill_state cursor of its own, and it returns coverage views for
// a human to read and decide whether to run it again. A schedule would be
// meaningless: there is no cursor to advance and nothing to react to.
//
// Ported from supabase/functions/backfill-status (Deno). The four RPC calls, the
// early-exit when all three return zero, the batch/iter clamps and the coverage
// view reads are byte-identical.
//
// It calls FOUR SECURITY DEFINER RPCs — backfill_status_fts / _ted / _notices /
// _cs — plus the v_status_coverage and v_status_coverage_by_source views. All six
// must exist on RDS before this does anything; see functions/_shared/db.ts.
//
// AUTH: config.toml leaves verify_jwt at its default (true), so on Supabase this
// needs a JWT — but the anon key is a valid JWT and ships in the frontend bundle,
// so in practice anyone who reads the bundle can call it. It is idempotent and
// only recomputes derived columns, so the blast radius is CPU rather than data
// corruption. On API Gateway it should sit behind the Cognito authorizer with an
// admin check; it is left unauthenticated here only because that authorizer does
// not exist yet, and it is guarded by isDbConfigured() in the meantime.
//
// TIMEOUT: up to 25 iterations x 3 concurrent RPCs over batches of up to 5000
// rows, then a fourth RPC. All server-side work with no client-side budget.
// Default (iter=5, batch=2000) is modest; iter=25&batch=5000 is not. Give it 900s.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const supabase = createDbClient();

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "ok" };
  }

  if (!isDbConfigured()) {
    const message =
      "backfill-status is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "It additionally needs the four backfill_status_* SECURITY DEFINER functions and the two " +
      "v_status_coverage views ported. The Supabase version remains the live implementation.";
    console.warn(message);
    return { statusCode: 501, headers: jsonHeaders, body: JSON.stringify({ error: message }) };
  }

  try {
    // Query-string parameters are preserved: this stays an HTTP endpoint, so
    // ?batch= and ?iter= work exactly as documented in the header above.
    const qs = event.queryStringParameters ?? {};
    const batch = Math.max(100, Math.min(Number(qs.batch || "2000"), 5000));
    const iterations = Math.max(1, Math.min(Number(qs.iter || "5"), 25));

    const counts = { fts: 0, ted: 0, cs: 0, notices: 0 };

    for (let i = 0; i < iterations; i++) {
      const [fts, ted, notices] = await Promise.all([
        supabase.rpc("backfill_status_fts", { p_limit: batch }),
        supabase.rpc("backfill_status_ted", { p_limit: batch }),
        supabase.rpc("backfill_status_notices", { p_limit: batch }),
      ]);
      if (fts.error) throw fts.error;
      if (ted.error) throw ted.error;
      if (notices.error) throw notices.error;
      counts.fts += (fts.data as number) ?? 0;
      counts.ted += (ted.data as number) ?? 0;
      counts.notices += (notices.data as number) ?? 0;
      if (!fts.data && !ted.data && !notices.data) break;
    }

    const cs = await supabase.rpc("backfill_status_cs");
    if (cs.error) throw cs.error;
    counts.cs = (cs.data as number) ?? 0;

    const { data: cov } = await supabase.from("v_status_coverage").select("*").maybeSingle();
    const { data: bySource } = await supabase.from("v_status_coverage_by_source").select("*");

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ counts, coverage: cov, by_source: bySource }),
    };
  } catch (e) {
    console.error("backfill-status error:", e);
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ error: msg }) };
  }
};
