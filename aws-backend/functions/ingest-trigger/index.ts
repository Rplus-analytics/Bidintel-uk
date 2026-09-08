// Admin fan-out: triggers the ingest-fts and ingest-cf functions on demand.
//
// ============================================================================
// THIS ONE IS NOT A CRON FUNCTION
// ============================================================================
// It was included in the "daily ingestion (cron)" batch, but reading the code it
// is an ADMIN, USER-INVOKED HTTP endpoint: it verifies a caller's JWT, checks
// they are an admin, and only then fans out. The migration report classifies it
// as ADMIN too. Making it EventBridge-only would delete its reason to exist —
// there would be no caller to authorise, and the two functions it triggers are
// already on their own schedules.
//
// So it is ported as an API Gateway (HTTP API v2) handler, unlike the other nine
// in this batch. Flagging rather than silently reshaping it.
//
// It is BLOCKED on the Cognito work regardless: it depends on Supabase Auth.
// See the TODO(auth) block below and auth/AUTH-MIGRATION-PLAN.md.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const supabase = createDbClient();

function readJsonBody(event: APIGatewayProxyEventV2): any {
  try {
    const raw = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body ?? "";
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const SOURCES: Record<string, string> = {
  fts: "ingest-fts",
  cf: "ingest-cf",
};

async function run(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const jwt = event.headers?.authorization?.replace("Bearer ", "");
  if (!jwt) return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ error: "Unauthorized" }) };

  // TODO(auth): this was Supabase Auth. Under Cognito, API Gateway's JWT
  // authorizer verifies the token before the Lambda runs and the claims arrive
  // on event.requestContext.authorizer.jwt.claims — so this whole block becomes
  // requireAdmin(requireAuth(event)). Note the role check also changes: the
  // original reads user_metadata.role, which is SELF-ASSERTED user metadata a
  // user can edit; the Cognito equivalent is the org_admin group membership,
  // which they cannot. See aws-backend/auth/AUTH-MIGRATION-PLAN.md § 4.2.
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ error: "Unauthorized" }) };

  if ((user as any).user_metadata?.role !== "admin") {
    return { statusCode: 403, headers: jsonHeaders, body: JSON.stringify({ error: "Forbidden" }) };
  }

  const body = readJsonBody(event);
  const source = body.source ?? "both";

  // TODO(fanout): the ingest functions are now EventBridge-invoked Lambdas, not
  // HTTP endpoints, so this should dispatch with the Lambda SDK rather than
  // fetch:
  //   await lambda.send(new InvokeCommand({
  //     FunctionName: `bidintel-${fn}`,
  //     InvocationType: "Event",          // async, matches today's fire-and-wait-briefly
  //     Payload: Buffer.from(JSON.stringify({ detail: {} })),
  //   }));
  // The execution role then needs lambda:InvokeFunction on those functions.
  // Left as fetch against INGEST_FN_BASE so the shape stays reviewable.
  const baseUrl = process.env.INGEST_FN_BASE ?? "";
  const headers = {
    "Content-Type": "application/json",
  };

  let toRun: string[];
  if (source === "all" || source === "both") {
    toRun = Object.keys(SOURCES);
  } else if (Array.isArray(source)) {
    toRun = source.filter((s: string) => s in SOURCES);
  } else if (typeof source === "string" && source in SOURCES) {
    toRun = [source];
  } else {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: `Unknown source: ${source}` }),
    };
  }

  const entries = await Promise.all(
    toRun.map(async (key) => {
      const fn = SOURCES[key];
      try {
        const r = await fetch(`${baseUrl}/${fn}`, {
          method: "POST",
          headers,
          body: "{}",
        });
        const json = await r.json().catch(() => ({ error: "non-json response", status: r.status }));
        return [key, json] as const;
      } catch (e: any) {
        return [key, { error: e.message }] as const;
      }
    }),
  );

  const results: Record<string, any> = Object.fromEntries(entries);
  return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify(results) };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (!isDbConfigured()) {
    const message =
      "ingest-trigger is scaffolded but not wired to RDS or Cognito. " +
      "See functions/_shared/db.ts TODO(rds) and auth/AUTH-MIGRATION-PLAN.md.";
    console.warn(message);
    return { statusCode: 501, headers: jsonHeaders, body: JSON.stringify({ error: message }) };
  }

  return run(event);
};
