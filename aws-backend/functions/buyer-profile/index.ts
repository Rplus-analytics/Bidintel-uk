// Generates a buyer profile (description + org chart with LinkedIn links) using Lovable AI Gateway.
//
// Ported from supabase/functions/buyer-profile (Deno). The tool schema, model,
// system prompt, response parsing and status-code mapping are unchanged.
//
// This is the only function in this batch with NO database dependency — it needs
// nothing but LOVABLE_API_KEY, which is why the migration report schedules it as
// the first function to introduce Secrets Manager.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

// Pinned. Tool/function-calling contract must match what the handler parses
// below (choices[0].message.tool_calls[0].function.arguments).
const CHAT_MODEL = "gpt-4o-mini";

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

// Mirrors Deno's `await req.json()`: an absent or malformed body throws, which the
// outer catch turns into the same 500 the original produced.
function readJsonBody(event: APIGatewayProxyEventV2): any {
  const raw = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body ?? "";
  return JSON.parse(raw);
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // The original returns `new Response(null, ...)` here — status 200, empty body.
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const { buyer } = readJsonBody(event);
    if (!buyer || typeof buyer !== "string") {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "buyer required" }),
      };
    }

    // OpenAI directly, not the Lovable AI Gateway — Lovable is the platform
    // being migrated away from. MODEL IS PINNED: gpt-4o-mini supports the same
    // tool-calling contract the Gemini call used, so the request/response shape
    // below is unchanged. Do not swap the model without re-checking that the
    // `return_buyer_profile` tool schema is still honoured.
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "AI not configured" }),
      };
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

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
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
      return {
        statusCode: aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 502,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "AI provider error", detail: text }),
      };
    }

    const data: any = await aiRes.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
    if (!args) {
      return {
        statusCode: 502,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "No profile returned" }),
      };
    }

    const profile: BuyerProfile = {
      description: args.description,
      website: args.website,
      headquarters: args.headquarters,
      sector: args.sector,
      orgChart: Array.isArray(args.orgChart) ? args.orgChart : [],
    };

    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify(profile) };
  } catch (e) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: String(e) }),
    };
  }
};
