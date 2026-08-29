// Backfill source_status + derived_status across tenders and notices.
// Idempotent. Invoke repeatedly until {coverage.unknown_count} stabilises.
//   curl "$URL/functions/v1/backfill-status?batch=2000&iter=8"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const batch = Math.max(100, Math.min(Number(url.searchParams.get("batch") || "2000"), 5000));
    const iterations = Math.max(1, Math.min(Number(url.searchParams.get("iter") || "5"), 25));

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

    return new Response(JSON.stringify({ counts, coverage: cov, by_source: bySource }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("backfill-status error:", e);
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
