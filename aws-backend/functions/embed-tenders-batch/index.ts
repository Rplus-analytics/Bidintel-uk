// Background worker: embeds up to BATCH_SIZE pending tenders using Lovable AI Gateway.
// Triggered by cron every minute. Picks newest pending first.
//
// Ported from supabase/functions/embed-tenders-batch (Deno). The batch size,
// input construction, model, per-row retry accounting, the 5-attempt cutoff and
// the early-break on 429/402 are all unchanged. Database access is stubbed —
// see db.ts.
//
// TRIGGER NOTE: on Supabase this is HTTP-invoked (by pg_cron via pg_net, and by
// EmbeddingStatusCard.tsx through supabase.functions.invoke). On AWS the cron
// half becomes an EventBridge schedule, so the handler accepts both an
// EventBridge ScheduledEvent and an API Gateway request and only does CORS/JSON
// framing for the latter.

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  ScheduledEvent,
} from "aws-lambda";
import {
  claimPendingBatch,
  markEmbedded,
  markFailed,
  isDbConfigured,
  type PendingTender,
} from "./db";
import { ensureSecretEnv } from "../_shared/secret-env";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const BATCH_SIZE = 50;
const MAX_INPUT_CHARS = 6000;
const EMBED_MODEL = "text-embedding-3-small"; // 1536 dims, matches tenders.embedding

async function embed(input: string): Promise<number[]> {
  // Launch provider is OpenAI directly, not the Lovable AI Gateway — Lovable is
  // the platform being migrated away from. text-embedding-3-small is the same
  // model the gateway proxied, so vectors stay comparable with the 22,088
  // already in the column and no re-embedding is needed.
  // Terraform supplies only OPENAI_SECRET_ARN — the key itself never enters a
  // function's configuration. Without this the variable is undefined and EVERY
  // row fails, which is exactly what happened: 50 claimed, 0 embedded, 50 failed,
  // in 150ms, six runs in a row. The per-row catch swallowed the reason, so the
  // function reported ok:true each time and logged nothing.
  await ensureSecretEnv("OPENAI_API_KEY", "OPENAI_SECRET_ARN");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err: any = new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const json: any = await res.json();
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

/** The work itself, independent of how the Lambda was invoked. */
async function runBatch(): Promise<{ ok: true; processed: 0; message: string } | { ok: true; claimed: number; embedded: number; failed: number }> {
  const rows: PendingTender[] = await claimPendingBatch(BATCH_SIZE);

  if (rows.length === 0) {
    return { ok: true, processed: 0, message: "no pending rows" };
  }

  let ok = 0, failed = 0;
  for (const row of rows) {
    try {
      const vec = await embed(buildInput(row));
      await markEmbedded(row.id, vec, (row.embedding_attempts || 0) + 1);
      ok++;
    } catch (e: any) {
      failed++;
      // Log the FIRST failure in full. Previously every row's reason was
      // discarded, so a misconfiguration affecting all 50 looked identical to 50
      // unrelated per-row problems — and the function still returned ok:true.
      if (failed === 1) {
        console.error(JSON.stringify({ embedFailure: e?.message ?? String(e), tenderId: row.id }));
      }
      const attempts = (row.embedding_attempts || 0) + 1;
      const nextStatus = attempts >= 5 ? "failed" : "pending";
      await markFailed(row.id, nextStatus, attempts, String(e?.message || e).slice(0, 500));
      // Stop the batch early on rate-limit/credit errors to avoid wasting retries
      if (e?.status === 429 || e?.status === 402) break;
    }
  }

  return { ok: true, claimed: rows.length, embedded: ok, failed };
}

function isHttpEvent(event: unknown): event is APIGatewayProxyEventV2 {
  return typeof event === "object" && event !== null && "requestContext" in event;
}

export const handler = async (
  event: APIGatewayProxyEventV2 | ScheduledEvent,
): Promise<APIGatewayProxyResultV2 | { ok: boolean; [k: string]: unknown }> => {
  const http = isHttpEvent(event);

  if (http && event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  // Fail loudly and specifically rather than with a confusing connection error.
  if (!isDbConfigured()) {
    const message =
      "embed-tenders-batch is scaffolded but not wired to RDS. See db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    if (!http) throw new Error(message);
    return { statusCode: 501, headers: jsonHeaders, body: JSON.stringify({ error: message }) };
  }

  try {
    const result = await runBatch();
    if (!http) return result;
    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify(result) };
  } catch (e: any) {
    console.error("embed-tenders-batch error:", e);
    // On an EventBridge invocation, throwing is what surfaces the failure to
    // CloudWatch metrics and the configured DLQ. Do not swallow it into a 500.
    if (!http) throw e;
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: e?.message || String(e) }),
    };
  }
};
