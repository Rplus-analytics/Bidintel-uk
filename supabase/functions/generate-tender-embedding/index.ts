import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (e?.status && e.status !== 429 && e.status < 500) throw e;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

async function embedVoyage(input: string): Promise<number[]> {
  const key = Deno.env.get("VOYAGE_API_KEY");
  if (!key) throw new Error("VOYAGE_API_KEY missing");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, model: "voyage-large-2" }),
  });
  if (!res.ok) {
    const err: any = new Error(`Voyage error ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return json.data[0].embedding;
}

async function embedOpenAI(input: string): Promise<number[]> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, model: "text-embedding-3-large" }),
  });
  if (!res.ok) {
    const err: any = new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return json.data[0].embedding;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { id } = await req.json();
    if (!id) {
      return new Response(JSON.stringify({ error: "id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tender, error } = await supabase
      .from("tenders")
      .select("id, title, description, cpv_codes")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!tender) {
      return new Response(JSON.stringify({ error: "tender not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const input = [
      tender.title ?? "",
      tender.description ?? "",
      Array.isArray(tender.cpv_codes) ? tender.cpv_codes.join(",") : "",
    ].join("\n");

    let embedding: number[];
    let provider = "voyage";
    try {
      embedding = await withBackoff(() => embedVoyage(input));
    } catch (e) {
      console.warn("Voyage failed, falling back to OpenAI:", e);
      provider = "openai";
      embedding = await withBackoff(() => embedOpenAI(input));
    }

    const { error: upErr } = await supabase
      .from("tenders")
      .update({ embedding: embedding as any })
      .eq("id", id);
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({ ok: true, id, provider, dims: embedding.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("generate-tender-embedding error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
