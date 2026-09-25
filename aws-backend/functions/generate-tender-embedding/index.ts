// Single-tender embedding via Voyage, falling back to OpenAI.
//
// Ported from supabase/functions/generate-tender-embedding (Deno). The backoff
// policy, provider fallback order, input construction and response shape are
// unchanged. Database access is stubbed — see db.ts.
//
// ============================================================================
// READ THIS BEFORE DEPLOYING — this function is legacy and partly broken
// ============================================================================
//
// The migration report (§8) calls it "legacy, dimension-mismatched" and it is
// right, though the detail matters:
//
//   * `tenders.embedding` is vector(1536).
//   * Primary path: Voyage `voyage-large-2` returns 1536 dims — fits.
//   * Fallback path: OpenAI `text-embedding-3-large` returns 3072 dims — does
//     NOT fit. Every fallback write fails at the database with a dimension
//     error, so the fallback has never actually worked.
//
// Separately, `voyage-large-2` has been retired by Voyage AI, so the primary
// path is likely failing too — which means every call falls through to the
// broken fallback. Nothing in the app calls this function (no
// `supabase.functions.invoke("generate-tender-embedding")` exists in /src); the
// live embedding pipeline is embed-tenders-batch.
//
// It is ported here for completeness because it was in scope, faithfully and
// without "fixing" it. Before wiring it to RDS, decide one of:
//   (a) delete it — embed-tenders-batch supersedes it; or
//   (b) repoint both providers at 1536-dim models and drop the dead fallback
//       (`text-embedding-3-small` is 1536 and is what embed-tenders-batch uses).
// Do not deploy it as-is expecting it to work.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getTenderById, setEmbedding, isDbConfigured } from "./db";
import { ensureSecretEnv } from "../_shared/secret-env";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

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
  // No Voyage key is configured on AWS, so this throws and the caller falls
  // through to OpenAI — the intended fallback order, just with a wasted attempt.
  const key = process.env.VOYAGE_API_KEY;
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
  const json: any = await res.json();
  return json.data[0].embedding;
}

async function embedOpenAI(input: string): Promise<number[]> {
  // Same latent bug embed-tenders-batch had: Terraform supplies only
  // OPENAI_SECRET_ARN, so without this the key is undefined and the fallback
  // path fails too, leaving no working provider at all.
  await ensureSecretEnv("OPENAI_API_KEY", "OPENAI_SECRET_ARN");
  // TODO(secrets): move to Secrets Manager.
  const key = process.env.OPENAI_API_KEY;
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
  const json: any = await res.json();
  return json.data[0].embedding;
}

function readJsonBody(event: APIGatewayProxyEventV2): any {
  const raw = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body ?? "";
  return JSON.parse(raw);
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const { id } = readJsonBody(event);
    if (!id) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "id required" }),
      };
    }

    if (!isDbConfigured()) {
      const message =
        "generate-tender-embedding is scaffolded but not wired to RDS. See db.ts TODO(rds).";
      console.warn(message);
      return { statusCode: 501, headers: jsonHeaders, body: JSON.stringify({ error: message }) };
    }

    const tender = await getTenderById(id);
    if (!tender) {
      return {
        statusCode: 404,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "tender not found" }),
      };
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

    await setEmbedding(id, embedding);

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ ok: true, id, provider, dims: embedding.length }),
    };
  } catch (e: any) {
    console.error("generate-tender-embedding error:", e);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: e?.message ?? String(e) }),
    };
  }
};
