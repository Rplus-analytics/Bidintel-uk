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
├── auth/                     Cognito IaC + AUTH-MIGRATION-PLAN.md (design only, nothing applied)
└── functions/
    ├── _shared/              ocds-linked.ts, notices-mirror.ts, s2w-style.ts, db.ts
    ├── contracts-finder/     index.ts + package.json + tsconfig.json
    ├── find-a-tender/
    ├── contracts-scotland/
    ├── scrape-cf-notice/
    ├── semantic-search/      + db.ts (stub)
    ├── embed-tenders-batch/  + db.ts (stub)
    ├── generate-tender-embedding/  + db.ts (stub)
    ├── buyer-profile/
    ├── ingest-cf/            ┐
    ├── ingest-fts/           │
    ├── ingest-contracts-scotland/  │
    ├── ingest-cf-native/     │ EventBridge-invoked cron Lambdas
    ├── ingest-cf-bulk/       │
    ├── ingest-source-full/   │
    ├── scrape-ccs-digital-outcomes/ │
    ├── sync-notices/         │
    ├── normalize-raw-cf/     ┘
    ├── backfill-raw-cf/      ┐
    ├── backfill-tick/        │ EventBridge-invoked backfill workers
    ├── backfill-source-tick/ │
    ├── backfill-cf-bulk-tick/┘
    ├── backfill-status/      API Gateway (on-demand, operator-driven)
    ├── backfill-linked-tables/  script-first; HTTP handler disabled by default
    └── ingest-trigger/       API Gateway (admin, NOT cron — see below)
```

**On self-containment.** Batches 1 and 2 duplicated small helpers per function so each zip was
independent. Batch 3 uses a real `_shared/` directory, as requested — the three OCDS helpers are
several hundred lines and duplicating them ten ways would guarantee drift. The build resolves this
with **esbuild**, which bundles `_shared` into each function's single `dist/index.js`. So the zips
stay independent at deploy time even though the source is shared; `index.handler` remains the
handler path for every function.

`_shared/db.ts` is the stubbed database layer for this batch. Batch 2's per-function `db.ts` files
are unchanged.

Each function is **self-contained** — no cross-imports, its own `package.json`, its own build. The
small duplication (CORS headers, the body parser) is deliberate: each Lambda zips and deploys
independently, and none can break another. Shared code only earns its place once several
DB-touching functions need the same client.

---

## What has been ported

24 of 29 functions, in four batches.

### Batch 1 — stateless proxies

All four are stateless HTTP proxies. **None requires environment variables, secrets, database
access, VPC attachment, or authentication.**

| Function | Upstream | Behaviour |
|---|---|---|
| `contracts-finder` | Contracts Finder V2 `search_notices` | POST search with stage→type/status mapping, 2 attempts × 20s timeout, 5xx retry |
| `find-a-tender` | Find a Tender (FTS) OCDS feed | GET release packages, client-side keyword filter, OCDS→notice mapping |
| `contracts-scotland` | Public Contracts Scotland v1 | GET notices, keyword filter, notice-type→status mapping, custom CA trust |
| `scrape-cf-notice` | Contracts Finder notice HTML | Scrapes + regex-parses notice pages, concurrency 5, 500ms between chunks — **partial port, see below** |

### Batch 2 — search, embeddings and AI

These depend on the database and an AI Gateway key. **The database layer is stubbed** — each
function's `db.ts` carries the exact SQL and throws `DbNotConfiguredError` until RDS exists. The
handlers detect the unconfigured state and return a clear 501 rather than a confusing connection
error, so they are deployable now and testable end-to-end the moment credentials arrive.

| Function | Needs | State |
|---|---|---|
| `buyer-profile` | `LOVABLE_API_KEY` only | **Complete** — no database dependency at all |
| `semantic-search` | DB + `LOVABLE_API_KEY` | Logic complete; `search_tenders_hybrid` call stubbed |
| `embed-tenders-batch` | DB + `LOVABLE_API_KEY` | Logic complete; claim/mark queries stubbed |
| `generate-tender-embedding` | DB + `VOYAGE_API_KEY`/`OPENAI_API_KEY` | Ported, but **legacy and broken** — see below |

`semantic-search` carries the whole procurement domain taxonomy (23 domains, their hint words,
expansion terms, CPV prefixes and the cross-domain compatibility map). It was spliced from the
original rather than retyped and is **character-identical** — it is tuned data, and paraphrasing it
would silently change search results.

### Batch 3 — daily ingestion (cron)

Ten functions plus the `_shared` OCDS library. All database access goes through the stub in
`_shared/db.ts`. Nine are **EventBridge-invoked**, with no HTTP framing and no CORS: the return
value is the invocation result and a **throw** is what marks the invocation failed so it reaches the
Errors metric and the DLQ. The Deno originals' `return new Response(..., {status: 500})` would have
been recorded as a *successful* invocation on Lambda — a silent-failure trap, so every 5xx path was
converted to a throw.

| Function | Trigger | Writes | Notes |
|---|---|---|---|
| `ingest-cf` | cron | tenders, notices, linked tables | CPV-filtered |
| `ingest-fts` | cron | tenders, notices, linked tables | CPV-filtered |
| `ingest-contracts-scotland` | cron | tenders | CPV-filtered, r.jina.ai fallback |
| `ingest-cf-native` | cron | raw_cf_native, backfill_state | advisory lock, 1 week/tick |
| `ingest-cf-bulk` | cron | cf_bulk_upload | **two porting problems, below** |
| `ingest-source-full` | cron | tenders_fts / _ted / _pcs | `detail.source` = fts\|ted\|pcs |
| `scrape-ccs-digital-outcomes` | cron | raw_ccs_*, tenders_ccs, tenders | HTML scraper |
| `sync-notices` | cron | notices, buyers, notices_sync_log | **4 of its 7 sources don't exist** |
| `normalize-raw-cf` | cron | tenders, notices, linked tables | slowest by far |
| `ingest-trigger` | **HTTP** | — | **not a cron function** |

Parameters that were query strings or POST bodies now come from the EventBridge rule's `detail`
payload: `{"source":"fts"}`, `{"month":"2024-01","sync":true}`, `{"ocid":"..."}`, `{"reset_to":"2024-01"}`.

**The `INGEST_SECRET` check is gone.** Three of these gated on a shared secret because Supabase Edge
Functions are publicly reachable URLs. An EventBridge-invoked Lambda is not — invocation is
IAM-authorised by the rule's permission — so the check was dropped rather than reimplemented. Re-add
it only if one of these is also exposed through API Gateway.

#### `ingest-trigger` is not a cron function

It was in the batch list, but reading the code it is an **admin, user-invoked HTTP endpoint**: it
verifies a caller's JWT, checks they are an admin, then fans out to `ingest-fts` and `ingest-cf`.
The migration report classifies it as ADMIN too. EventBridge-only would delete its reason to
exist — no caller to authorise, and the two functions it triggers are already on their own
schedules. It is ported as an **API Gateway handler**, flagged rather than silently reshaped, and
is blocked on the Cognito work regardless.

While porting it: the original's admin check reads `user.user_metadata.role`, which is
**self-asserted user metadata the user can edit**. The Cognito equivalent is `org_admin` group
membership, which they cannot. Noted in the file as a TODO(auth); do not port the check as-is.

#### `ingest-cf-bulk`: two porting problems

1. **`EdgeRuntime.waitUntil` has no Lambda equivalent.** The fan-out branch used it to keep firing
   per-day requests *after* the response was returned. Lambda freezes the execution environment the
   moment the handler resolves, so that work would be **silently dropped — looking like a success
   while ingesting nothing**. The AWS shape is an async self-invoke (`InvocationType: "Event"`),
   stubbed as `invokeSelfAsync()` with the exact `InvokeCommand` in a TODO(fanout). For a 31-day
   month an SQS queue is the better answer: retries, DLQ and concurrency control a self-invoke has
   no equivalent for. `{month, sync: true}` needs no fan-out and works today.
2. **Deno's `std/csv` is unavailable.** Replaced with `csv-parse` (`columns: true` is the direct
   equivalent of `skipFirstRow: true`) behind a shim that leaves the call site unchanged. Verified
   on a synthetic CKAN-shaped CSV including quoted commas; **not** verified against a real CKAN
   file. That is the first thing to test.

#### `sync-notices`: four of its seven sources do not exist

Its `sources` list names `ted-eu`, `sell2wales`, `etenders-ireland` and `etenders-ni`. **No edge
function with any of those names exists** in `supabase/functions/` — they 404, and `callSource`
swallows the failure and returns `[]`. So this function has only ever synced three sources:
`contracts-finder`, `contracts-scotland`, `find-a-tender`. The list is preserved rather than
silently trimmed, because deleting entries changes behaviour if those functions are ever written.
Decide before deploying.

It also has a frontend caller — `src/pages/Admin.tsx` invokes it via `supabase.functions.invoke` —
so it is not purely cron. If the admin button stays, it needs an API Gateway route *and* auth: it is
an expensive, write-heavy operation.

### Batch 4 — backfill workers

The six resumable, cursor-based workers. **Triggers were classified from the evidence, not assumed** —
`config.toml`, the in-code auth checks, the header comments, whether the function keeps its own
`backfill_state` cursor, and whether anything in `/src` calls it:

| Function | Cursor in `backfill_state` | Frontend caller | Verdict | Trigger |
|---|---|---|---|---|
| `backfill-raw-cf` | yes (`raw_cf`) | no | header says "call repeatedly (or via cron)" | **EventBridge** |
| `backfill-tick` | yes (all non-`_full` rows) | no | `INGEST_SECRET`-gated tick | **EventBridge** |
| `backfill-source-tick` | yes (`fts_full`/`ted_full`/`pcs_full`) | no | "Per-minute backfill" | **EventBridge** |
| `backfill-cf-bulk-tick` | yes (`cf_bulk`) | no | drives `ingest-cf-bulk` month by month | **EventBridge** |
| `backfill-status` | **no** | no | header documents a `curl` with `?batch=&iter=`; returns coverage for a human to read | **API Gateway** |
| `backfill-linked-tables` | **no** — caller passes `offset` | no | one-off; operator drives the paging loop | **script — see below** |

The two without a cursor are the two that aren't cron. That is not a coincidence: a scheduled worker
needs somewhere to resume from, and neither of these has one.

#### Two of these are unauthenticated write endpoints today — and it isn't the one you'd expect

You flagged `backfill-linked-tables`, and it does have its auth check commented out. But checking
`config.toml` against the in-code checks, the exposure ranking is the other way round:

| Function | `verify_jwt` | In-code check | Actual exposure on Supabase |
|---|---|---|---|
| `backfill-raw-cf` | **false** | none | **fully public URL, no credential at all** |
| `backfill-cf-bulk-tick` | **false** | none | **fully public URL, no credential at all** |
| `backfill-tick` | false | `INGEST_SECRET` | public URL, shared-secret gated |
| `backfill-source-tick` | true (default) | `INGEST_SECRET` | JWT + shared secret |
| `backfill-status` | true (default) | none | anon key suffices — and the anon key ships in the frontend bundle |
| `backfill-linked-tables` | true (default) | **commented out** | anon key suffices; no user/role check beyond that |

So `backfill-raw-cf` and `backfill-cf-bulk-tick` are reachable by anyone on the internet with no
credential whatsoever, while `backfill-linked-tables` at least requires the (public, bundle-embedded)
anon key. All three are write-capable with the service-role key.

**Moving the four cron workers to EventBridge deletes this problem rather than re-platforming it** —
they get no URL at all. That is a security improvement that falls out of the migration for free, and
it is worth doing on the Supabase side too if the AWS move slips.

#### `backfill-linked-tables` — recommendation: run it as a script, don't deploy it

Its original contains, verbatim:

```
// TEMP: auth disabled for one-off backfill run
// const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
```

**Recommendation: convert it to a one-off script. Do not deploy it as an endpoint.** Four reasons,
in order of weight:

1. **It is already script-shaped.** Alone among the six it keeps no cursor — the caller passes
   `offset` and reads `next_offset` back to drive the next call. That is an operator running a loop,
   which is a script, not a service.
2. **Its own comment says one-off.** A deployed endpoint is permanent attack surface for something
   meant to run once.
3. **Run as a script with admin database credentials, the credentials *are* the authorisation.**
   There is no auth layer to get wrong and nothing to leave commented out.
4. **It is idempotent** (upserts throughout), so an operator-driven loop is safe to restart — which
   is exactly the shape that makes a script the right answer.

Not recommended: **re-enabling the bearer check**. That leaves a write-capable public endpoint
guarded by a shared secret, which is strictly worse than having no endpoint. If it genuinely must
keep running — new `raw_json` keeps arriving and it needs to re-run — then give it a
`backfill_state` cursor like its five siblings and move it to **EventBridge**, removing the HTTP
surface entirely. And not: **leaving it disabled as-is**, which just ports the hole to a new cloud.

What was built: `runBackfillLinkedTables(offset, limit)` is exported as the real deliverable, for a
script or a one-shot `aws lambda invoke`. An HTTP handler exists but **fails closed** — it needs
`BACKFILL_LINKED_TABLES_ENABLED=true` *and* a matching `BACKFILL_ADMIN_TOKEN`, and an unset token
authorises nothing. Deploying it by accident cannot create an open endpoint.

**This is the one deliberate departure from fidelity in all 24 functions.** Porting this one
faithfully would mean shipping an unauthenticated write endpoint to a new cloud, so it was not
ported faithfully. Everything else in the file is byte-identical.

#### Two smaller findings

- **`backfill-cf-bulk-tick` logs the wrong month.** Its `ingest_runs.errors` payload has an explicit
  `month` key followed by `...metrics`, and `metrics` is reassigned inside the two-month loop — so
  the spread overwrites `month` with the *last* month processed, not the first. The starting month
  still appears as `prev`, and this is log-only data, so it is preserved rather than fixed. (Note
  this differs from the superficially identical case in `ingest-cf-bulk`, where the duplicate keys
  genuinely are the same values.)
- **`backfill-tick` has dead code.** `TARGET_CPV_PREFIXES` is declared and never read, because
  `matchesCpv()` unconditionally returns `true` — deliberately, per its comment, since 2010-2014
  notices lack consistent CPV codes. Preserved.

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
| `supabase.from(...)` / `.rpc(...)` | `db.ts` — raw SQL against RDS (stubbed) |
| `Deno.env.get("X")` | `process.env.X` |
| `Deno.serve` + `Response.json()` (cron) | EventBridge handler; plain return value, throw on failure |
| `new URL(req.url).searchParams` | `event.detail` |
| `EdgeRuntime.waitUntil()` | **no equivalent** — async self-invoke or SQS |
| `std/csv` `parse(…, {skipFirstRow})` | `csv-parse` `parse(…, {columns: true})` |
| `res.json()` returning `any` | returns `unknown` — annotated `: any` at 8 sites |

`console.log` / `warn` / `error` calls are kept as-is; they land in CloudWatch Logs instead of the
Supabase function log.

### Verified

`npm run typecheck` is clean across all eight.

**Batch 1** — built and invoked locally against the **live** upstream APIs:

| Function | Result |
|---|---|
| `contracts-finder` | 200, 5 notices mapped, `total=163`, ~2.2s |
| `find-a-tender` | 200, 3 notices mapped (June 2025 window), ~0.8s |
| `contracts-scotland` | 200, 5 notices mapped, `total=92`, **~19s** — TLS chain verified |
| `scrape-cf-notice` | 200, real notice parsed (`ojeu_procedure_type`, `closing_time` extracted), ~0.9s |

OPTIONS preflight returns `200 "ok"` with CORS headers; an empty body returns the same `500
{"error":"Unexpected end of JSON input"}` the Deno version produced.

**Batch 2** — no database and no AI key available here, so verification covers the logic that does
not need them, which for `semantic-search` is most of the function:

- **Domain classification exercised on 8 queries.** `"school catering"`→`catering`,
  `"penetration testing services"`→`cyber`, `"hospital cleaning contract"`→`cleaning`,
  `"grounds maintenance and tree surgery"`→`grounds`, `"G-Cloud framework agreement"`→`frameworks`,
  `"quantum widget sprockets"`→`general`.
- **The cross-domain gate works** — the file's stated anti-goal is generic IT CPVs polluting cyber
  queries. `"cyber security penetration testing"` yields CPVs `72212732, 72611000, 48730000, 35120000`
  with `allowedDomains = ["cyber"]`; the generic `72` prefix does **not** leak in. `"facilities
  management including cleaning"` correctly inherits `cleaning`.
- **Taxonomy and `classifyDomain` diffed against the original: byte-identical** (13,881 chars /
  287 lines, and 727 chars respectively). `buyer-profile`'s tool schema and AI request body are
  byte-identical too.
- **Every handler path that does not need a database or key was executed**: OPTIONS preflight on all
  four returns 200 with CORS; `semantic-search` with an empty query returns the exact empty-expansion
  payload; `buyer-profile` returns 400 `buyer required` and 500 `AI not configured`;
  `generate-tender-embedding` returns 400 `id required`; the DB-dependent paths return 501 naming
  `db.ts TODO(rds)`.
- **`embed-tenders-batch` throws rather than returning 501 when invoked as an EventBridge event**,
  so a scheduled failure surfaces to CloudWatch metrics and the DLQ instead of being swallowed as a
  successful invocation. Confirmed by invoking it with a `ScheduledEvent` shape.

**Batch 3** — verified by mechanical diff against the originals plus live execution:

- **Every helper region is byte-identical.** For all ten functions, the code between the module
  client and the request handler was diffed against the original: `extractCpv`, `matchesCpv`,
  `mapStatus`, `pickRegion`, `fetchPcs`, `parseTedDate`, `ingestFts`/`ingestTed`/`ingestPcs`,
  `nestRow`, `fetchWithRetry`, `ingestCsv`, `ingestMonthDirect`, `upsertBatch`, the whole CCS
  parser, `getState`/`saveState`/`acquireRunLock`, `processRelease`, `toRow`, `callSource` —
  **all IDENTICAL**. The single exception is `sync-notices`, where the three
  `Deno.env.get("SUPABASE_*")` constants became `SOURCE_FN_BASE`, which is the intended change.
- **`_shared/ocds-linked.ts` and `_shared/notices-mirror.ts` are byte-identical copies** (9,373 and
  2,082 chars). Neither had imports and both take the database handle as a parameter, so nothing
  needed converting. `s2w-style.ts` created its own client, so its client line changed; its 125-line
  logic body is byte-identical.
- **Body diffs are only the runtime shell.** Every removed line was reviewed: OPTIONS handling,
  `req.json()`→`detail`, `Response.json()`→plain return, 5xx→throw, and the `EdgeRuntime.waitUntil`
  block. Nothing unintended.
- **The tuned parsers were executed.** The CCS scraper extracted `project_id`, title, buyer,
  procurement route, value, `framework`/`lot` split and description from sample listing HTML;
  `parseMoney("£1,250,000.50")`→`1250000.5`; entity decoding correct. `nestRow` turned a CKAN
  `releases/0/tender/title` CSV row into the right nested OCDS shape, quoted commas intact;
  `getMonthDays` handles leap years. `extractCpv` dedupes and drops non-CPV schemes; all six
  `mapStatus` branches correct.
- **All nine EventBridge handlers throw** (not return) when unwired, so a scheduled failure is
  recorded as a failure. `ingest-trigger` returns 200 on OPTIONS and 501 on POST.
- **One function ran end-to-end against a live API.** With the DB guard flipped,
  `ingest-source-full` with `detail: {}` fetched real releases from find-tender.service.gov.uk,
  mapped them, and stopped exactly at `upsert on "tenders_fts"` — the whole pipeline executes up to
  the database boundary. `detail: {source:"bogus"}` correctly rejects.

**Batch 4** — same treatment, plus one live network check:

- **Helper regions byte-identical** for `backfill-raw-cf`, `backfill-tick` and
  `backfill-cf-bulk-tick`: every fetcher (`backfillFts`/`Cf`/`Ted`/`OcdsFeed`/`EtendersIreland`),
  `upsertRows` with its TED-vs-OCDS branch, `parseTedDate`, `monthRange`/`prevMonth`/`nextMonth`/
  `isCurrentOrFuture`, `getState`/`saveState`, `fmt`/`isAtOrAfterNow`/`normalizeMetrics`.
  `backfill-source-tick` differs in exactly 24 lines — the two intended TLS conversions
  (`getPcsClient`, the dispatcher on the PCS fetch) and nothing else. `backfill-status`'s RPC core
  (1,023 chars) and `backfill-linked-tables`' 40-line work body are byte-identical bar one
  documented `500 → throw`.
- **The embedded Sectigo PEM was spliced from the original and diff-verified**, not retyped —
  same as `contracts-scotland` in batch 1.
- **Cursor arithmetic executed**, which is the core of a resumable worker and the easiest thing to
  break silently: `monthRange(2024,1)` → Feb 29 (leap year); `nextMonth(2024,11)` → `{2025, 0}`;
  `prevMonth(2015,1)` → `{2014, 12}` (backfill-raw-cf stores months 1-indexed, unlike its siblings);
  `pcsWeekRange(2024,52)` → Dec 30-31 then rolls to `{2025, 0}`; `fmt`, `isAtOrAfterNow` and
  `normalizeMetrics`' string→number coercion all correct.
- **The undici TLS conversion was verified against the live PCS API**: `getPcsClient()` builds an
  Agent, memoises it, and a real request to `api.publiccontractsscotland.gov.uk` returned
  **HTTP 200 with 17 releases**. The cert handling works, not just compiles.
- **Every worker reaches the database boundary and names what it needed** — `ingest_runs.insert`,
  `backfill_state.select`, `tenders.select`, `rpc:backfill_status_fts`. The four EventBridge workers
  throw rather than return; `backfill-status` returns 200/501 correctly and parses `?batch=&iter=`.
- **The `backfill-linked-tables` guards were tested as a matrix**: disabled by default → 403 even
  with a bearer token; enabled but no token configured → 401; enabled with a guessed token while
  none is set → **401 (an unset token authorises nothing)**; wrong token → 401; correct token →
  through to the DB guard.
- **A real gap in the shared stub was found and fixed by this batch**: `StubQueryBuilder` was missing
  `.not()`, which `backfill-linked-tables` and `backfill-tick` both chain, so those calls died with a
  `TypeError` instead of the intended `DbNotConfiguredError`. Added `.not/.is/.like/.ilike/.filter/
  .match/.contains`. Worth noting because it is the kind of thing only executing the code finds.

Not verified: every SQL statement in the `db.ts` files, the `search_tenders_hybrid` argument
binding, every AI Gateway call, the CSV shim against a real CKAN file, and the CKAN/TED/CCS
network paths. The SQL is written from the columns the Deno originals read and write — check it
against the live schema before trusting it.

### One inherited parsing gap

`decodeEntities` in the CCS scraper handles `&amp; &lt; &gt; &quot; &#39; &nbsp;` and all *numeric*
entities, but no other *named* entity. A value rendered as `&pound;1,250,000` therefore fails
`parseMoney` and yields `value_number = null`. A literal `£` and the numeric `&#163;` both work, so
this only bites if the site emits the named form. Pre-existing and byte-identical — flagged, not
fixed.

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

### Ported but broken: `generate-tender-embedding`

Ported faithfully because it was in scope, **not** because it should be deployed. The migration
report calls it "legacy, dimension-mismatched"; reading the code, the detail is sharper than that:

- `tenders.embedding` is `vector(1536)`.
- Primary path — Voyage `voyage-large-2` — returns **1536** dims. Fits.
- Fallback path — OpenAI `text-embedding-3-large` — returns **3072** dims. Does not fit. Every
  fallback write fails at the database with a dimension error, so the fallback has never worked.

Separately, `voyage-large-2` has been retired by Voyage AI, which means the primary path likely
fails too and every call falls through to the broken fallback. Nothing in `/src` invokes this
function — the live pipeline is `embed-tenders-batch`.

Before wiring it to RDS, either delete it, or repoint both providers at 1536-dim models and drop the
dead fallback (`text-embedding-3-small`, which is what `embed-tenders-batch` already uses). Do not
deploy it as-is expecting it to work. The port preserves the behaviour rather than quietly fixing it,
so this decision stays visible.

### One inherited quirk worth knowing

`classifyDomain` scores domains by **summing the character length of matched hint words**, so a
longer generic hint outranks a shorter specific one. `"hmrc tax advisory"` classifies as
`consultancy` (hint `"advisory"`, 8 chars) rather than `gov_finance` (hint `"hmrc"`, 4 chars).

This is the original's behaviour, not something the port introduced — the scoring function is
byte-identical. Flagging it because it is a live search-quality issue that the dual-run validation
will reproduce identically on both sides and therefore will not catch.

## What is still on Supabase

**5 of 29 functions remain unported**, plus the entire database, auth layer and scheduler. Do not
decommission anything.

**Still on Supabase — user-facing / auth-dependent (migrate last):** `draft-bid-response`,
`bootstrap-org`, `admin-create-user`, `mcp`, `daily-search-alerts`.

**Still the live implementation, even though an AWS port now exists:** all ten ingestion functions,
all six backfill workers, plus `semantic-search`, `embed-tenders-batch`, `generate-tender-embedding`
and `buyer-profile`.
Every one of those except `buyer-profile` needs RDS before it can run at all. `buyer-profile` could
run today but has not been deployed.

**Also still on Supabase:** the whole Postgres database, `search_tenders_hybrid` and every other RPC,
pgvector + the HNSW index, all 25 RLS policies, Supabase Auth (`auth.uid()`), the MCP OAuth server,
and every `pg_cron` + `pg_net` schedule.

Steps 1-6 of the migration report's recommended order are now fully scaffolded. What remains is
`daily-search-alerts` (step 7) and the auth-dependent set (step 8: `bootstrap-org`,
`draft-bid-response`, `admin-create-user`, `mcp`) — all five blocked on the Cognito design in
[`auth/AUTH-MIGRATION-PLAN.md`](auth/AUTH-MIGRATION-PLAN.md). `daily-search-alerts` is the odd one
out: it needs no user auth, but it does need `semantic-search` and `saved_searches` live first.

Note that scaffolded is not migrated: nothing in batch 2 or 3 can actually run until RDS exists.

---

## Timeouts

Flagging these the way `contracts-scotland`'s ~19s was flagged in batch 1. **Every self-imposed time
budget in batch 3 was tuned to Supabase's ~150s edge wall clock, not to Lambda's 900s ceiling.** They
are preserved unchanged — raising them is a deliberate decision, not a port detail — but several are
now either needlessly tight or actively wrong for Lambda.

| Function | Budget in code | Concern |
|---|---|---|
| `sync-notices` | 140s per source × 7 sources, **sequential** | Worst case ~16 min, which **exceeds Lambda's 900s hard ceiling**. Survives today only because 4 of the 7 sources 404 immediately. Implement those sources and this function can no longer fit in one Lambda. |
| `ingest-source-full` | **none at all** | The only function here with no `MAX_RUNTIME_MS`. It paginates up to 50 pages (FTS/TED) with nothing to stop it, relying entirely on the platform to kill it — and it has **no checkpoint**, so a kill mid-pagination loses the whole tick's progress. |
| `normalize-raw-cf` | 50s | Slowest in the batch by a wide margin: one upsert + notices mirror + `upsertLinkedFromRelease` **per release**, over ~625k `raw_contracts_finder` rows. Many round trips per row. Expect it to need a great many ticks. |
| `ingest-cf-native` | `MAX_RUNTIME_MS` 50s, `LOCK_MS` 120s | These two are **coupled**. Raising the runtime budget without raising the lock means a long tick outlives its own advisory lock and a second tick starts against the same cursor. Change both or neither. |
| `ingest-cf-bulk` | 135s budget, 110s CKAN day budget | Tuned to Supabase; needlessly tight at 900s. Also paces OCDS at 3s/page against a documented 12 req/min limit. |
| `scrape-ccs-digital-outcomes` | 50s | Checked between pages across 4 framework×status combos of up to 200 pages each. Its header claims "one invocation handles the entire catalogue" — true only while the catalogue stays small. |
| `ingest-cf` / `ingest-fts` / `ingest-contracts-scotland` | none | Up to 50 pages × 100 records, then child-row linking one release at a time. |
| `backfill-cf-bulk-tick` | 90s loop break | Each iteration **synchronously invokes `ingest-cf-bulk`**, which has its own 135s budget — so one tick can take minutes. Both functions need 900s, and the invoke must stay `RequestResponse` because the caller reads `month_complete` to advance its cursor. |
| `backfill-tick` | **none** | No wall clock at all — only `MAX_ROWS_PER_TICK` (200/source) and page caps. All sources run **concurrently** via `Promise.all`, so a slow one doesn't block others, but nothing bounds the tick. |
| `backfill-source-tick` | **none** | Same shape. `fetchPcsJson` serially tries three transports (direct+CA, plain direct, then a 30s `r.jina.ai` proxy) before failing, so the PCS branch alone can burn over a minute. Note `MAX_ROWS_PER_TICK` is 500 despite the header comment saying 200. |
| `backfill-raw-cf` | 50s, 25s/page abort | Tuned to Supabase. |
| `backfill-status` | none | Up to 25 iterations × 3 concurrent RPCs over batches of 5000. All server-side; `iter=25&batch=5000` is a very different job from the `iter=5&batch=2000` default. |

**Recommended starting point: `--timeout 900` (the maximum) for all thirteen cron functions**, then
tune down from the CloudWatch Duration metric. That is the opposite of the batch 1 advice, where 60s was
generous — these are bulk jobs, not interactive proxies.

If any job genuinely needs more than 15 minutes, Lambda is the wrong runtime and the work moves to
ECS/Fargate. The migration report raises exactly this in its open question #8.

## Build

```bash
cd aws-backend
npm install        # one install for all four (npm workspaces)
npm run typecheck  # tsc --noEmit across all functions
npm run build      # compiles each to functions/<name>/dist/
npm run package    # build + zip to functions/<name>/<name>.zip
```

Requires Node 20+ locally (Node 24 also works).

**Batch 3 builds with esbuild, not tsc** — it bundles `_shared` and `csv-parse` into a single
`dist/index.js` per function, so each zip stays self-contained and `index.handler` remains the
handler path everywhere. `npm run typecheck` still runs `tsc --noEmit` across all 18. Batches 1 and
2 still build with `tsc`; `undici` is a real runtime dependency of `contracts-scotland` only, so its
zip must include `node_modules/undici`. Moving those two batches to esbuild as well would remove
that special case.

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

# Batch 1 + buyer-profile: no VPC, no database.
for fn in contracts-finder find-a-tender contracts-scotland scrape-cf-notice buyer-profile; do
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

**`embed-tenders-batch` needs far more than 60s.** It embeds up to 50 tenders sequentially in one
invocation, each a round trip to the AI Gateway. At even 1s per embedding that is ~50s of pure
network wait, and slower under rate limiting. Give it **900s (15 min, Lambda's ceiling)** and run it
from EventBridge, not API Gateway — the 30s HTTP API integration timeout cannot accommodate it. If a
batch ever needs longer than 15 minutes, the batch size has to come down or the work moves to
Fargate; the migration report flags this for the ingest jobs too.

```bash
# DB-touching functions: VPC-attached, longer timeouts.
aws lambda create-function \
  --function-name bidintel-embed-tenders-batch \
  --runtime nodejs20.x --role $DB_ROLE --handler index.handler \
  --zip-file fileb://functions/embed-tenders-batch/embed-tenders-batch.zip \
  --timeout 900 --memory-size 512 \
  --vpc-config SubnetIds=$PRIVATE_SUBNETS,SecurityGroupIds=$LAMBDA_SG

aws events put-rule --name bidintel-embed-tenders-batch \
  --schedule-expression "rate(1 minute)"
```

`semantic-search` is interactive and should stay well under the API Gateway ceiling — 30s timeout,
and consider 1024 MB, since it is the one user-facing latency path here.

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

### 3a. EventBridge schedules (batch 3)

The nine cron functions are invoked by EventBridge rules, not API Gateway. They need no route, no
CORS and no public URL — which also means no unauthenticated write endpoints, closing the
`verify_jwt = false` exposure the migration report flagged on the Supabase side.

```bash
# One rule per function. Schedules below are placeholders: the live cadences are
# in pg_cron on Supabase, which this environment cannot read, so they are
# NOT VERIFIED. Read them off the source database before cutting over:
#   SELECT jobname, schedule, command FROM cron.job;
create_schedule() {  # $1 function, $2 cron/rate expression, $3 optional detail JSON
  aws events put-rule --name "bidintel-$1" --schedule-expression "$2"
  aws lambda add-permission --function-name "bidintel-$1" \
    --statement-id "events-$1" --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn "arn:aws:events:$AWS_REGION:$ACCOUNT:rule/bidintel-$1"
  aws events put-targets --rule "bidintel-$1" \
    --targets "Id=1,Arn=arn:aws:lambda:$AWS_REGION:$ACCOUNT:function:bidintel-$1${3:+,Input='$3'}"
}

create_schedule ingest-cf                   "rate(1 day)"
create_schedule ingest-fts                  "rate(1 day)"
create_schedule ingest-contracts-scotland   "rate(1 day)"
create_schedule ingest-source-full          "rate(1 day)" '{"detail":{"source":"fts"}}'
create_schedule scrape-ccs-digital-outcomes "rate(1 day)"
create_schedule sync-notices                "rate(1 day)"
create_schedule ingest-cf-native            "rate(5 minutes)"
create_schedule normalize-raw-cf            "rate(5 minutes)"

# Batch 4 backfill workers. These are tick-shaped: each run advances a cursor a
# little, so they are scheduled frequently and run until completed=true.
create_schedule backfill-raw-cf             "rate(5 minutes)"
create_schedule backfill-tick               "rate(5 minutes)"
create_schedule backfill-source-tick        "rate(1 minute)"
create_schedule backfill-cf-bulk-tick       "rate(15 minutes)"
```

Two things to set up alongside the rules:

- **A dead-letter queue on every function.** These throw on failure by design, and without a DLQ a
  failed nightly ingest is a CloudWatch line nobody reads. `--dead-letter-config
  TargetArn=<sqs-arn>` plus an alarm on the `Errors` metric.
- **Reserved concurrency of 1** on every cursor-keeping worker: `ingest-cf-native`,
  `normalize-raw-cf`, `backfill-raw-cf`, `backfill-tick`, `backfill-source-tick` and
  `backfill-cf-bulk-tick`. All six advance a `backfill_state` cursor, and two overlapping ticks
  corrupt it. Only `ingest-cf-native` has its own advisory lock; `backfill-cf-bulk-tick` has an
  optimistic `.eq(year).eq(month0)` check on its update, which detects a concurrent change but only
  after the work is done. Reserved concurrency is the cheap fix, and it matters more here than in
  batch 3 because these tick every 1-15 minutes.
- **`backfill-status` and `backfill-linked-tables` get no schedule.** The first is operator-driven
  (API Gateway); the second should not be deployed at all — see the recommendation above.

`ingest-trigger` is the exception — it needs an API Gateway route like batch 1, and auth.

### 4. Environment variables

**Batch 1 needs none** — zero environment variables, zero secrets. That is exactly why those four
went first.

**Batch 2 is where the configuration burden starts:**

| Function | Variable | Required? | Source |
|---|---|---|---|
| `buyer-profile` | `LOVABLE_API_KEY` | yes | Secrets Manager |
| `semantic-search` | `LOVABLE_API_KEY` | no — degrades to keyword+CPV ranking without it | Secrets Manager |
| `semantic-search` | `DATABASE_SECRET_ARN` or `DATABASE_URL` | yes | Secrets Manager |
| `embed-tenders-batch` | `LOVABLE_API_KEY` | yes | Secrets Manager |
| `embed-tenders-batch` | `DATABASE_SECRET_ARN` or `DATABASE_URL` | yes | Secrets Manager |
| `generate-tender-embedding` | `VOYAGE_API_KEY`, `OPENAI_API_KEY` | yes (but see the warning above) | Secrets Manager |
| `generate-tender-embedding` | `DATABASE_SECRET_ARN` or `DATABASE_URL` | yes | Secrets Manager |

The `isDbConfigured()` check in each `db.ts` keys off `DATABASE_SECRET_ARN` / `DATABASE_URL`, so
setting either flips the function from "scaffold, returns 501" to "attempts real queries" — which
will then fail until `db.ts` is actually implemented. Do not set it before then.

**Batch 3:**

| Function | Variable | Required? | Notes |
|---|---|---|---|
| all nine cron functions | `DATABASE_SECRET_ARN` or `DATABASE_URL` | yes | flips them from "scaffold, throws" to "attempts real queries" |
| `sync-notices` | `SOURCE_FN_BASE` | yes | API Gateway base URL of the batch-1 source proxies |
| `ingest-trigger` | `INGEST_FN_BASE` | yes | until it moves to Lambda SDK invokes |
| all four batch-4 cron workers | `DATABASE_SECRET_ARN` or `DATABASE_URL` | yes | |
| `backfill-linked-tables` | `BACKFILL_LINKED_TABLES_ENABLED`, `BACKFILL_ADMIN_TOKEN` | only if deployed | both required; unset token authorises nothing. Preferably neither — run it as a script. |

`INGEST_SECRET` is **no longer needed** by the ported ingest functions — EventBridge invocation is
IAM-authorised, so the shared-secret check was dropped. It is still needed by whatever remains on
Supabase.

**Still to come:**

| Coming with | Variable | Source |
|---|---|---|
| `daily-search-alerts` | `RESEND_API_KEY`, `ALERTS_FROM_ADDRESS` | Secrets Manager |

**A note on reading secrets.** Every function currently reads `process.env` directly, with a
`TODO(secrets)` at each site. Lambda environment variables are visible to anyone holding
`lambda:GetFunctionConfiguration`, so before production these should move to Secrets Manager —
fetched once at cold start and cached, or via the AWS Parameters and Secrets Lambda Extension.

### 4a. VPC — the trap in batch 2

The three DB-touching functions must join the RDS VPC (subnets + security group) and their execution
role needs `AWSLambdaVPCAccessExecutionRole` on top of the basic policy.

**Attaching a Lambda to a VPC removes its default internet access.** All three also need to reach
`ai.gateway.lovable.dev` (or Voyage/OpenAI), so the subnets need a **NAT gateway** or those calls
hang until the function times out — which presents as a timeout, not as a network error, and is
easy to misdiagnose as a slow AI Gateway.

Connection pooling matters too: create the pool at module scope so it survives warm invocations, and
cap it at `max: 1` per container. Lambda scales by process, so a pool of 10 across 50 concurrent
containers is 500 connections and will exhaust `max_connections` on a small RDS instance. Put RDS
Proxy in front before concurrency goes above single digits. Each `db.ts` repeats this in its
`TODO(rds)` block.

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

**24 of 29 functions ported.** The remaining 5 are the auth-dependent set, deferred by design.

| | |
|---|---|
| Ported and verified against live APIs | `contracts-finder`, `find-a-tender`, `contracts-scotland` |
| Ported, complete, not yet exercised against a live key | `buyer-profile` |
| Ported with the database stubbed | `semantic-search`, `embed-tenders-batch`, `generate-tender-embedding` |
| Ported with the database stubbed (batch 3, EventBridge) | `ingest-cf`, `ingest-fts`, `ingest-contracts-scotland`, `ingest-cf-native`, `ingest-cf-bulk`, `ingest-source-full`, `scrape-ccs-digital-outcomes`, `sync-notices`, `normalize-raw-cf` |
| Ported with the database stubbed (batch 4, EventBridge) | `backfill-raw-cf`, `backfill-tick`, `backfill-source-tick`, `backfill-cf-bulk-tick` |
| Ported as HTTP, operator-driven | `backfill-status` |
| Ported script-first, HTTP handler fails closed | `backfill-linked-tables` |
| Ported as HTTP, blocked on Cognito | `ingest-trigger` |
| Shared library ported | `ocds-linked.ts`, `notices-mirror.ts` (byte-identical), `s2w-style.ts` |
| Partially ported (stateless half only) | `scrape-cf-notice` |
| Ported but should not be deployed as-is | `generate-tender-embedding` (dimension mismatch), `ingest-cf-bulk` fan-out mode (`EdgeRuntime.waitUntil`) |
| Designed, not built | Cognito auth — see [`auth/`](auth/AUTH-MIGRATION-PLAN.md) |
| Deployed to AWS | **Nothing yet** — no AWS credentials were available in this environment |
| Frontend cutover | Not started, by design |

Per the migration report this moves the project from Stage 0 (assessment) to having portable
artefacts for the first six steps of the recommended order in full, but the AWS account itself
remains unverified. Open question #1 in that document — which AWS account/region, and can credentials be
provided — is still the blocker for deploying any of this, and now also for finishing the three
`db.ts` stubs.
