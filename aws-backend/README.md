# BidIntel — AWS Backend

Incremental port of the BidIntel Supabase Edge Functions to AWS Lambda (Node.js 20 / TypeScript).

This directory is **purely additive**. Nothing under `/supabase` has been modified, and the live
app still calls Supabase for everything. Deploying from here changes no production behaviour
until you repoint a client at an API Gateway URL.

Background and rationale: [`docs/migration/supabase-aws-migration-status.md`](../docs/migration/supabase-aws-migration-status.md).
That report recommends starting with the stateless proxies precisely because they validate the whole
AWS delivery path — Lambda, API Gateway, IAM, CORS, CloudWatch, Deno→Node conventions — with zero
database dependency, while RDS reconciliation continues in parallel.

---

## Layout

```
aws-backend/
├── package.json              npm workspace root (build/typecheck/package all functions)
├── tsconfig.base.json        shared compiler options
└── functions/
    ├── contracts-finder/     index.ts + package.json + tsconfig.json
    ├── find-a-tender/
    ├── contracts-scotland/
    └── scrape-cf-notice/
```

Each function is **self-contained** — no cross-imports, its own `package.json`, its own build. The
small duplication (CORS headers, the body parser) is deliberate: each Lambda zips and deploys
independently, and none can break another. Shared code only earns its place once several
DB-touching functions need the same client.

---

## What has been ported

All four are stateless HTTP proxies. **None requires environment variables, secrets, database
access, VPC attachment, or authentication.**

| Function | Upstream | Behaviour |
|---|---|---|
| `contracts-finder` | Contracts Finder V2 `search_notices` | POST search with stage→type/status mapping, 2 attempts × 20s timeout, 5xx retry |
| `find-a-tender` | Find a Tender (FTS) OCDS feed | GET release packages, client-side keyword filter, OCDS→notice mapping |
| `contracts-scotland` | Public Contracts Scotland v1 | GET notices, keyword filter, notice-type→status mapping, custom CA trust |
| `scrape-cf-notice` | Contracts Finder notice HTML | Scrapes + regex-parses notice pages, concurrency 5, 500ms between chunks — **partial port, see below** |

The transforms, field mappings, defaults, retry counts, timeouts and response shapes are carried
over unchanged. Only the runtime shell differs:

| Deno (Supabase) | Node (Lambda) |
|---|---|
| `Deno.serve(async (req) => …)` | `export const handler = async (event: APIGatewayProxyEventV2) => …` |
| `req.method === "OPTIONS"` | `event.requestContext.http.method === "OPTIONS"` |
| `await req.json()` | `JSON.parse` of `event.body` (base64-decoded when flagged) |
| `new Response(body, { headers })` | `{ statusCode, headers, body }` |
| `Deno.createHttpClient({ caCerts })` | `undici` `Agent` with `connect.ca` as fetch dispatcher |
| `fetch`, `AbortController`, `URLSearchParams` | unchanged — all global on Node 20+ |

`console.log` / `warn` / `error` calls are kept as-is; they land in CloudWatch Logs instead of the
Supabase function log.

### Verified

All four were built and invoked locally against the **live** upstream APIs:

| Function | Result |
|---|---|
| `contracts-finder` | 200, 5 notices mapped, `total=163`, ~2.2s |
| `find-a-tender` | 200, 3 notices mapped (June 2025 window), ~0.8s |
| `contracts-scotland` | 200, 5 notices mapped, `total=92`, **~19s** — TLS chain verified |
| `scrape-cf-notice` | 200, real notice parsed (`ojeu_procedure_type`, `closing_time` extracted), ~0.9s |

OPTIONS preflight returns `200 "ok"` with CORS headers; an empty body returns the same `500
{"error":"Unexpected end of JSON input"}` the Deno version produced. `npm run typecheck` is clean.

Reproduce:

```bash
cd aws-backend && npm install && npm run build
node -e '(async()=>{const{handler}=require("./functions/contracts-finder/dist/index.js");
const r=await handler({requestContext:{http:{method:"POST"}},isBase64Encoded:false,
body:JSON.stringify({keyword:"software",limit:5})});console.log(r.statusCode,r.body.slice(0,300))})()'
```

### Partially ported: `scrape-cf-notice`

**The migration doc is wrong about this one.** Section 10 (row 14) and the section 11 matrix both
record `scrape-cf-notice` as having no DB and no Supabase dependencies — "pure proxy, very low
readiness". The actual code does three database things with the service-role key:

1. reads 50 unscraped rows from `cf_scrape_queue`,
2. writes parsed fields back to each row (`scraped`, `scraped_at`, `error`, plus the four fields),
3. inserts a summary row into `ingest_runs`.

So it is a queue worker, not a proxy. What is portable today is the scrape-and-parse half, and that
is what this Lambda implements — the parsing (`extractField`, `extractDl`, `parseNotice`), the
browser-like request headers, the concurrency of 5 and the 500ms inter-chunk pause are byte-identical
to the original.

- `POST { "noticeIds": ["…"] }` → scrapes those notices, returns the parsed fields. Stateless.
- `POST {}` (queue-drain mode) → **501** with an explanatory message.

The `ingest_runs` insert is stubbed as a structured `console.log` line to CloudWatch.

To finish this function once the database lands: restore the `cf_scrape_queue` select, the per-row
update and the `ingest_runs` insert against RDS, and move it to an EventBridge schedule rather than
an HTTP route (it is a cron worker — it was only ever HTTP-triggered because that is what Supabase
Edge Functions are). Until then, keep the Supabase version running for the queue.

---

## What is still on Supabase

25 of 29 functions, plus the entire database, auth layer and scheduler. Do not decommission anything.

**Still on Supabase — search & embeddings:** `semantic-search`, `embed-tenders-batch`,
`generate-tender-embedding` (legacy, dimension-mismatched).

**Still on Supabase — ingestion (cron):** `ingest-cf`, `ingest-fts`, `ingest-contracts-scotland`,
`ingest-cf-native`, `ingest-cf-bulk`, `ingest-source-full`, `ingest-trigger`,
`scrape-ccs-digital-outcomes`, `sync-notices`, `normalize-raw-cf`.

**Still on Supabase — backfill workers:** `backfill-raw-cf`, `backfill-tick`, `backfill-source-tick`,
`backfill-cf-bulk-tick`, `backfill-status`, `backfill-linked-tables`.

**Still on Supabase — user-facing / auth-dependent (migrate last):** `draft-bid-response`,
`bootstrap-org`, `admin-create-user`, `mcp`, `buyer-profile`, `daily-search-alerts`.

**Also still on Supabase:** the whole Postgres database, `search_tenders_hybrid` and every other RPC,
pgvector + the HNSW index, all 25 RLS policies, Supabase Auth (`auth.uid()`), the MCP OAuth server,
and every `pg_cron` + `pg_net` schedule.

Per the doc's recommended order, the next steps after these four are `buyer-profile` (introduces
Secrets Manager, still no DB), then `embed-tenders-batch` (first DB-touching function, first
`pg_cron`→EventBridge replacement), then `semantic-search`.

---

## Build

```bash
cd aws-backend
npm install        # one install for all four (npm workspaces)
npm run typecheck  # tsc --noEmit across all functions
npm run build      # compiles each to functions/<name>/dist/
npm run package    # build + zip to functions/<name>/<name>.zip
```

Requires Node 20+ locally (Node 24 also works). `undici` is a real runtime dependency of
`contracts-scotland` only, so its zip must include `node_modules/undici`; the other three have no
runtime dependencies and their zips are a single `index.js`.

> Note on packaging: `npm run package` zips `dist/` only. For `contracts-scotland` you must also
> include its `undici` dependency — either run `npm install --omit=dev --prefix functions/contracts-scotland`
> into a staging directory and zip both, or bundle with esbuild (`esbuild index.ts --bundle
> --platform=node --target=node20 --outfile=dist/index.js`), which is the simpler option and what
> I would use for the remaining functions too.

---

## Deployment

### 1. IAM execution role

One role, reusable by all four. These functions call no AWS service other than CloudWatch Logs, so
the managed basic-execution policy is sufficient — **no VPC, no Secrets Manager, no RDS, no
`AWSLambdaVPCAccessExecutionRole`**. That changes at `buyer-profile` (Secrets Manager) and again at
the first DB-touching function (VPC + RDS).

```bash
aws iam create-role --role-name bidintel-lambda-basic \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy --role-name bidintel-lambda-basic \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### 2. Create the functions

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ROLE=arn:aws:iam::$ACCOUNT:role/bidintel-lambda-basic

for fn in contracts-finder find-a-tender contracts-scotland scrape-cf-notice; do
  aws lambda create-function \
    --function-name bidintel-$fn \
    --runtime nodejs20.x \
    --role $ROLE \
    --handler index.handler \
    --zip-file fileb://functions/$fn/$fn.zip \
    --timeout 60 \
    --memory-size 512
done
```

**Set the timeout to 60s, not the 3s default.** Measured cold-path latency:
`contracts-scotland` took ~19s against the live PCS API, and `contracts-finder` allows two 20s
attempts, so its worst case is ~40s. A 3s timeout would fail both most of the time.

512 MB is a starting point — these are I/O-bound, so memory mainly buys CPU for JSON parsing; tune
from CloudWatch after real traffic.

### 3. API Gateway

An **HTTP API** (payload format 2.0) is what the handlers are typed against
(`APIGatewayProxyEventV2`, reading `event.requestContext.http.method`). If you use a REST API
instead, switch the types to `APIGatewayProxyEvent` and read `event.httpMethod`.

```bash
API_ID=$(aws apigatewayv2 create-api \
  --name bidintel-api --protocol-type HTTP \
  --query ApiId --output text)

for fn in contracts-finder find-a-tender contracts-scotland scrape-cf-notice; do
  INT=$(aws apigatewayv2 create-integration --api-id $API_ID \
    --integration-type AWS_PROXY \
    --integration-uri arn:aws:lambda:$AWS_REGION:$ACCOUNT:function:bidintel-$fn \
    --payload-format-version 2.0 \
    --query IntegrationId --output text)

  aws apigatewayv2 create-route --api-id $API_ID \
    --route-key "POST /$fn" --target integrations/$INT

  aws lambda add-permission --function-name bidintel-$fn \
    --statement-id apigw-$fn --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT:$API_ID/*/*/$fn"
done

aws apigatewayv2 create-stage --api-id $API_ID --stage-name prod --auto-deploy
```

**Timeout ceiling to be aware of:** an HTTP API's maximum integration timeout is 30 seconds and is
not adjustable. `contracts-scotland` measured ~19s and `contracts-finder`'s worst case is ~40s, so
both sit uncomfortably close to (or past) that ceiling. Options, in order of preference:

1. Reduce `contracts-finder`'s retry budget (two 20s attempts is generous for an interactive search).
2. Use a REST API instead — its 29s default integration timeout can be raised via a service-quota increase.
3. Use a **Lambda Function URL**, which inherits the function timeout up to 15 minutes and needs no
   API Gateway at all. For four unauthenticated public proxies this is genuinely the simpler option;
   API Gateway earns its place when you need authorizers, usage plans, WAF or a custom domain.

**CORS:** the handlers already return `Access-Control-Allow-Origin: *` and handle `OPTIONS`
themselves, carried over from the Supabase originals. Do **not** also enable API Gateway's CORS
configuration — duplicate `Access-Control-Allow-Origin` headers cause browsers to reject the
response. Either leave API Gateway CORS off, or strip the headers from the handlers and configure it
at the gateway. Before production, replace the `*` with the real origin
(`https://bidintel.rplusai.co.uk`).

**Auth:** these routes are intentionally unauthenticated, matching the Supabase originals
(`contracts-finder`, `find-a-tender` and `contracts-scotland` rely on platform JWT verification that
the anon key satisfies; `scrape-cf-notice` has `verify_jwt = false` in `supabase/config.toml`).
They expose only public procurement data. Even so, they are now open, uncredentialed endpoints that
make outbound requests on demand — consider a usage plan, WAF rate limiting, or a Lambda authorizer
before pointing production traffic at them.

### 4. Environment variables

**None.** All four functions read zero environment variables and need zero secrets — this is exactly
why they were chosen to go first. The next tranche is where the configuration burden starts:

| Coming with | Variable | Source |
|---|---|---|
| `buyer-profile`, `embed-tenders-batch`, `semantic-search` | `LOVABLE_API_KEY` (AI Gateway) | Secrets Manager |
| `daily-search-alerts` | `RESEND_API_KEY`, `ALERTS_FROM_ADDRESS` | Secrets Manager |
| every DB-touching function | RDS host / database / credentials | Secrets Manager + VPC |
| `ingest-cf` | `INGEST_SECRET` | Secrets Manager |

### 5. Validation before cutover

The migration doc's strategy (§17) is shadow/dual-run — invoke each Lambda and the Supabase original
with identical payloads and diff the JSON before switching any client. For these four, that is a
straightforward deterministic comparison:

```bash
# Same payload to both, compare
PAYLOAD='{"keyword":"school catering","limit":20}'
curl -s -X POST "$API_BASE/contracts-finder" -d "$PAYLOAD" -H 'content-type: application/json' > aws.json
curl -s -X POST "$SUPABASE_URL/functions/v1/contracts-finder" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d "$PAYLOAD" > supabase.json
diff <(jq -S . aws.json) <(jq -S . supabase.json)
```

Note that live feeds move between calls, so run both within the same few seconds and expect
incidental drift on freshly published notices. The doc suggests 20 fixed queries for this.

### 6. Client cutover

The frontend reaches all three search proxies through a single seam —
[`src/lib/contractsFinder.ts`](../src/lib/contractsFinder.ts), function `invokeSource` (line 49),
which wraps `supabase.functions.invoke(fn, { body })`. Every caller
(`searchContractsFinder`, `searchContractsScotland`, `searchAllSources`) goes through it.

To cut over, change that one function to `fetch` against the API Gateway base URL, keeping the same
`{ notices, total, cursor, uri }` contract and the same swallow-errors-return-empty behaviour. A
`VITE_AWS_API_BASE` env var makes it switchable per environment, and rollback is unsetting it.

`scrape-cf-notice` has no frontend caller — it is invoked server-side only.

**No client change is included in this commit.** The app still talks to Supabase.

---

## Status

| | |
|---|---|
| Ported and verified against live APIs | `contracts-finder`, `find-a-tender`, `contracts-scotland` |
| Partially ported (stateless half only) | `scrape-cf-notice` |
| Deployed to AWS | **Nothing yet** — no AWS credentials were available in this environment |
| Frontend cutover | Not started, by design |

Per the migration report this moves the project from Stage 0 (assessment) to having its first
portable artefacts, but the AWS account itself remains unverified. Open question #1 in that
document — which AWS account/region, and can credentials be provided — is still the blocker for
actually deploying any of this.
