// Generates a buyer profile (description + org chart with LinkedIn links) using Lovable AI Gateway.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OrgMember {
  name: string;
  title: string;
  linkedin: string;
  level: number;
}

interface BuyerProfile {
  description: string;
  website?: string;
  headquarters?: string;
  sector?: string;
  orgChart: OrgMember[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { buyer } = await req.json();
    if (!buyer || typeof buyer !== "string") {
      return new Response(JSON.stringify({ error: "buyer required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tool = {
      type: "function",
      function: {
        name: "return_buyer_profile",
        description: "Return a structured profile for a UK public-sector buying organisation",
        parameters: {
          type: "object",
          properties: {
            description: { type: "string", description: "2-4 sentence description of the organisation" },
            website: { type: "string" },
            headquarters: { type: "string" },
            sector: { type: "string" },
            orgChart: {
              type: "array",
              description: "6-12 senior leaders organised into a reporting hierarchy. Use level 1 for the most senior person (e.g. CEO/Chief Executive/Permanent Secretary), level 2 for direct reports (executive directors), level 3 for next tier (directors/heads), level 4 for deputy/assistant heads. Include level for every person. LinkedIn: prefer real profile URLs (https://www.linkedin.com/in/...); otherwise use https://www.linkedin.com/search/results/people/?keywords=...",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  title: { type: "string" },
                  linkedin: { type: "string" },
                  level: { type: "integer", minimum: 1, maximum: 4, description: "1=top of hierarchy, higher numbers report upward" },
                },
                required: ["name", "title", "linkedin", "level"],
                additionalProperties: false,
              },
            },
          },
          required: ["description", "orgChart"],
          additionalProperties: false,
        },
      },
    };

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You provide concise factual profiles of UK public-sector buying organisations (NHS trusts, councils, government departments, framework bodies). For LinkedIn links, prefer real profile URLs you are confident about; otherwise return a LinkedIn people-search URL using the person's name and the organisation.",
          },
          { role: "user", content: `Profile this UK public-sector buyer: "${buyer}"` },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "return_buyer_profile" } },
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      return new Response(JSON.stringify({ error: "AI gateway error", detail: text }), {
        status: aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
    if (!args) {
      return new Response(JSON.stringify({ error: "No profile returned" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profile: BuyerProfile = {
      description: args.description,
      website: args.website,
      headquarters: args.headquarters,
      sector: args.sector,
      orgChart: Array.isArray(args.orgChart) ? args.orgChart : [],
    };

    return new Response(JSON.stringify(profile), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
