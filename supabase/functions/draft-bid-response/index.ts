import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { bidId, companyInfo, instructions } = body as {
      bidId?: string;
      companyInfo?: string;
      instructions?: string;
    };

    if (!bidId || typeof bidId !== "string") {
      return new Response(JSON.stringify({ error: "bidId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Target bid
    const { data: target, error: tErr } = await supabase
      .from("saved_bids")
      .select("*")
      .eq("id", bidId)
      .maybeSingle();
    if (tErr || !target) {
      return new Response(JSON.stringify({ error: "Bid not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All historical bids in the org (RLS will scope automatically)
    const { data: history } = await supabase
      .from("saved_bids")
      .select("title, buyer, value, status, source, description, notes, deadline_date")
      .neq("id", bidId)
      .order("updated_at", { ascending: false })
      .limit(40);

    const historyText = (history || [])
      .map(
        (h, i) =>
          `#${i + 1} [${h.status?.toUpperCase()}] ${h.title}\n  Buyer: ${h.buyer || "—"} | Value: ${h.value || "—"} | Source: ${h.source}\n  Notes: ${(h.notes || "").slice(0, 400)}\n  Description: ${(h.description || "").slice(0, 400)}`,
      )
      .join("\n\n");

    const systemPrompt = `You are an expert UK public-sector bid writer. You draft compelling, compliant tender responses grounded in the bidder's past bid history and company profile. Use clear British English, structured headings, and reference past wins where relevant. Output Markdown.`;

    const userPrompt = `# Company Profile
${companyInfo?.trim() || "(not provided)"}

# Target Opportunity
- Title: ${target.title}
- Buyer: ${target.buyer || "—"}
- Value: ${target.value || "—"}
- Source: ${target.source}
- Deadline: ${target.deadline_date || "—"}
- Description: ${target.description || "—"}

# Past Bids (training context — learn tone, themes, win/loss patterns)
${historyText || "(no past bids available)"}

# Additional Instructions
${instructions?.trim() || "(none)"}

# Task
Produce a structured DRAFT bid response with these sections:
1. **Executive Summary** (3–4 sentences tailored to the buyer)
2. **Understanding of Requirement**
3. **Our Approach & Methodology**
4. **Relevant Experience** (cite analogous past bids by buyer/sector when present)
5. **Team & Delivery**
6. **Pricing Approach** (qualitative — no fabricated numbers)
7. **Why Us** (USPs derived from company profile + win history)
8. **Risks & Mitigations**

Keep it concise but substantive (~600–900 words). Mark any assumption with [ASSUMPTION].`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const draft: string = aiJson?.choices?.[0]?.message?.content ?? "";

    return new Response(
      JSON.stringify({ draft, historyCount: history?.length ?? 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("draft-bid-response error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
