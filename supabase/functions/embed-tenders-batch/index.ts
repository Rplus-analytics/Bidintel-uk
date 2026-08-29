// Background worker: embeds up to BATCH_SIZE pending tenders using Lovable AI Gateway.
// Triggered by cron every minute. Picks newest pending first.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 50;
const MAX_INPUT_CHARS = 6000;
const EMBED_MODEL = "openai/text-embedding-3-small"; // 1536 dims, matches tenders.embedding

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function embed(input: string): Promise<number[]> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err: any = new Error(`Embed gateway ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("Embedding response malformed");
  return vec;
}

function buildInput(t: { title?: string | null; description?: string | null; buyer_name?: string | null; cpv_codes?: string[] | null; primary_cpv?: string | null }) {
  const parts = [
    t.title || "",
    t.description || "",
    t.buyer_name ? `Buyer: ${t.buyer_name}` : "",
    t.primary_cpv ? `CPV: ${t.primary_cpv}` : "",
    Array.isArray(t.cpv_codes) && t.cpv_codes.length ? `CPV codes: ${t.cpv_codes.join(", ")}` : "",
  ].filter(Boolean).join("\n").slice(0, MAX_INPUT_CHARS);
  return parts || "(no content)";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Claim a batch atomically by flipping pending → processing.
    const { data: claimed, error: claimErr } = await supabase
      .from("tenders")
      .select("id, title, description, buyer_name, cpv_codes, primary_cpv, embedding_attempts")
      .eq("embedding_status", "pending")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(BATCH_SIZE);
    if (claimErr) throw claimErr;

    const rows = claimed || [];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "no pending rows" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = rows.map((r) => r.id);
    await supabase
      .from("tenders")
      .update({ embedding_status: "processing" })
      .in("id", ids);

    let ok = 0, failed = 0;
    for (const row of rows) {
      try {
        const vec = await embed(buildInput(row));
        const { error: upErr } = await supabase
          .from("tenders")
          .update({
            embedding: vec as any,
            embedding_status: "completed",
            embedded_at: new Date().toISOString(),
            embedding_attempts: (row.embedding_attempts || 0) + 1,
            embedding_error: null,
          })
          .eq("id", row.id);
        if (upErr) throw upErr;
        ok++;
      } catch (e: any) {
        failed++;
        const attempts = (row.embedding_attempts || 0) + 1;
        const nextStatus = attempts >= 5 ? "failed" : "pending";
        await supabase
          .from("tenders")
          .update({
            embedding_status: nextStatus,
            embedding_attempts: attempts,
            embedding_error: String(e?.message || e).slice(0, 500),
          })
          .eq("id", row.id);
        // Stop the batch early on rate-limit/credit errors to avoid wasting retries
        if (e?.status === 429 || e?.status === 402) break;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, claimed: rows.length, embedded: ok, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("embed-tenders-batch error:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
