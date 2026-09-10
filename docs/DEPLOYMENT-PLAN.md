# BidIntel — AWS Production Deployment Plan

**Goal:** BidIntel running entirely on AWS `eu-north-1`, off Lovable hosting and off Supabase.
**Date:** 2026-09-10 · **Account:** `008041477140` · **Region:** `eu-north-1` (Stockholm)
**Status:** planning only. Nothing has been applied. Phase 1 has a `terraform plan` (11 resources); see §Phase 1.

**Read alongside:** [`BIDINTEL-STATUS.md`](BIDINTEL-STATUS.md) (what exists today, bugs found) ·
[`../aws-backend/README.md`](../aws-backend/README.md) (per-function deployment detail) ·
[`../aws-backend/auth/AUTH-MIGRATION-PLAN.md`](../aws-backend/auth/AUTH-MIGRATION-PLAN.md) (Cognito design)

---

## Cost summary

Unit prices pulled from the AWS Pricing API for `eu-north-1` on 2026-09-10. Marked **[measured]**
where taken from that API or from actual Cost Explorer spend, **[list]** where standard published
pricing, **[est]** where usage-dependent.

| Phase | Monthly, steady state |
|---|---:|
| 1 — Foundations | **~$1.50** |
| 2 — Database (`bidintel-1`, resized to `t4g.medium`) | **~$75** |
| 3 — Lambda↔RDS networking | **$0 – $34** (see §a) |
| 4 — Backend (Cognito, Lambda, API GW, EventBridge) | **~$5 – 12** |
| 5 — Frontend (stays on Vercel) | **$0** |
| 6 — CI/CD | **$0** |
| 7 — Cutover | one-off |
| **Total** | **≈ $81 – 122 / month** (≈ $163 – 204 if the instance stays `m7g.large`) |

Against **$431.12 already spent** since late July on unused infrastructure. Terminating the idle
Windows EC2 instance saves ~$14/month on its own.

---

## Phase 1 — Foundations

**Terraform state · Secrets Manager · SES**

### Already in the repo
- `aws-backend/infra/phase1/` — **written and planned** (`versions.tf`, `variables.tf`, `main.tf`,
  `outputs.tf`). `terraform validate` passes; `terraform plan` succeeds with **11 to add, 0 to
  change, 0 to destroy**.

### Missing
- Nothing in code. Three things cannot be automated and must be done by a human:
  - **SES production access** — a support case, not an API call. Until granted, SES only sends to
    verified addresses, so `daily-search-alerts` cannot email real users.
  - **DNS records** — three DKIM CNAMEs plus MX/SPF for the MAIL FROM subdomain. Terraform emits
    them; it can only publish them if the zone is in Route 53 in this account (`manage_dns_in_route53`).
  - **Secret values** — created empty on purpose. Populating them via Terraform would write
    plaintext secrets into state.

### Resources created (11)
`aws_s3_bucket.tfstate` + versioning + SSE + public-access-block + lifecycle + TLS-only policy ·
3 × `aws_secretsmanager_secret` (`bidintel/ai-gateway`, `bidintel/resend`, `bidintel/app-db`) ·
`aws_sesv2_email_identity` + mail-from attributes.

**State locking is S3-native** (`use_lockfile = true`, Terraform ≥ 1.10) rather than DynamoDB.
Terraform writes a `.tflock` object beside the state and uses S3 conditional writes for mutual
exclusion. That removes a resource, removes a per-request cost line, and removes a second thing to
keep in sync — at the price of requiring Terraform ≥ 1.10 everywhere, including in CI (phase 6).
Bucket versioning, which native locking depends on, is enabled. A stale lock is cleared with
`terraform force-unlock`, never by deleting the object.

### Cost
| Item | Monthly |
|---|---:|
| S3 state bucket (<1 MB) | ~$0.01 **[est]** |
| 3 Secrets Manager secrets @ $0.40 | $1.20 **[measured]** |
| SES | $0.10 / 1,000 emails **[list]** — pennies at 7 users |

### Needs your approval
- ✅ **Applying phase 1** — first real resource creation in the account.
- ⚠️ **Requesting SES production access** — outward-facing; AWS asks about sending practices and
  bounce handling. Do it early: approval can take 24h+ and phase 4 depends on it.
- ⚠️ **Where DNS lives.** If `rplusai.co.uk` is not in Route 53, someone must add records manually.

---

## Phase 2 — Database

**Parameter group · pgvector/pg_trgm · schema parity with Supabase including RLS**

### Already in the repo
- **90 SQL migration files** in `supabase/migrations/`.
- The **exact RLS→GUC port** is designed in the auth plan §4.2: `auth_uid()`, `current_org_id()`,
  `is_org_admin()` rewritten against `current_setting('app.*')`, which lets **all 19 policies port
  essentially unchanged**.
- Every table, RPC, extension and index the app needs is inventoried in the migration assessment.

### Missing
- **A custom parameter group.** `bidintel-1` uses `default.postgres18`, which cannot be edited and
  has `shared_preload_libraries = pg_stat_statements,pg_tle`. **`pg_cron` is therefore not enabled**
  — though on AWS that matters less, because EventBridge replaces it.
- **The schema itself.** Nothing has been created on `bidintel-1` — see §d.
- **The GUC-based RLS SQL** — designed but not written.
- **A non-owner application role** that does not bypass RLS.

### Resources created
`aws_db_parameter_group` (family `postgres18`) applied to `bidintel-1` (**reboot required**) ·
extensions `vector`, `pg_trgm`, `pgcrypto` · the full schema · `tenders_embedding_hnsw_idx` ·
roles `bidintel_app` (non-owner) and `bidintel_migrator`.

### Instance sizing — `db.m7g.large` is oversized

All Single-AZ PostgreSQL on-demand, `eu-north-1`, **[measured]** from the Pricing API:

| Instance | vCPU | RAM | $/hr | $/month | vs current |
|---|---:|---:|---:|---:|---:|
| `db.t4g.medium` | 2 (burstable) | 4 GiB | $0.0650 | **$47.45** | **−$81.76** |
| `db.t4g.large` | 2 (burstable) | 8 GiB | $0.1300 | **$94.90** | **−$34.31** |
| `db.m7g.large` *(current)* | 2 (sustained) | 8 GiB | $0.1770 | $129.21 | — |
| `db.m7g.xlarge` | 4 (sustained) | 16 GiB | $0.3540 | $258.42 | +$129.21 |

**Does pgvector fit in memory? Yes, comfortably, on all three.** The working set:

| Component | Size |
|---|---:|
| 20,000 × `vector(1536)` at 4 bytes/dim | **117 MiB** raw |
| …as heap tuples (6,148 B + overhead per row) | ~124 MB |
| HNSW index (stores the full vector per element plus `m=16` neighbour lists) | **~130–190 MB** |
| **Vector working set** | **~250–320 MB** |

RDS sets `shared_buffers` to ~25% of RAM: **1 GiB** on `t4g.medium`, **2 GiB** on `t4g.large` and
`m7g.large`. A ~320 MB vector working set fits in all of them with room for the `tsvector` keyword
index and ordinary query traffic. **Memory is not the constraint — CPU is.**

**Two caveats that matter more than RAM:**

1. **`t4g` is burstable.** HNSW search is CPU-bound (distance computations). At 7 users doing
   occasional searches, baseline (20% of 2 vCPU on `medium`, 30% on `large`) plus accrued credits is
   ample. But a **bulk re-embedding run — 20k embeddings plus 20k index inserts — will exhaust CPU
   credits** and throttle hard. If the embeddings decision lands on Bedrock (requiring a full
   re-embed), do that run on a temporarily larger instance, or accept it taking much longer.
2. **HNSW index *build* needs `maintenance_work_mem`**, not `shared_buffers`. If the graph does not
   fit, pgvector falls back to a much slower on-disk build. Budget ~200–256 MB; set it in the phase 2
   custom parameter group. Fine even on `t4g.medium` (4 GiB) as a session-scoped setting.

**Recommendation: `db.t4g.medium` ($47.45), and resize later if the metrics say so.** The database is
empty, there are 7 users, and resizing is a reboot. Starting at `m7g.large` costs **$981/year** more
than `t4g.medium` for capacity nothing is currently using. If burstable CPU makes you uneasy,
`t4g.large` at $94.90 keeps the same 8 GiB as today and still saves $412/year.

Note `raw_contracts_finder` (~625k rows, 2.3 GB) is the large table, but it is write-once and read
only by `normalize-raw-cf`. It drives **storage**, not RAM.

### Cost
| Item | Monthly |
|---|---:|
| Instance — `db.t4g.medium` (recommended) | **$47.45** **[measured]** |
| *…or `db.m7g.large` as currently provisioned* | *$129.21* |
| 200 GB gp3 storage | **$24.00** **[measured]** |
| Backups beyond 100% of storage | $0 at current size **[list]** |
| Public IPv4 (removable in phase 3) | $3.65 **[measured]** |
| **Phase total** | **~$75 (t4g.medium)** — or ~$157 unchanged |

Multi-AZ roughly doubles the instance line. At 7 users, single-AZ with 7-day backups is defensible;
revisit before this is business-critical.

### Needs your approval
- ⚠️ **Rebooting `bidintel-1`** to attach the parameter group. Harmless while empty; an outage later.
- ⚠️ **Whether `bidintel-1` is reused or recreated.** If it is empty (§d), recreating it in a private
  subnet from the start is cleaner than retrofitting phase 3 around it.
- ⚠️ **Multi-AZ: yes or no.** Roughly doubles the instance line.
- ⚠️ **Instance size** — recommend downsizing to `t4g.medium`, saving $981/year. Requires a reboot.

---

## Phase 3 — Lambda-to-RDS networking

See **§a** below for the full options analysis. Summary: the recommendation is **VPC endpoints, not
a NAT gateway**, saving ~$34/month.

### Already in the repo
- Every `db.ts` `TODO(rds)` block documents the requirement: VPC attach,
  `AWSLambdaVPCAccessExecutionRole`, pool `max: 1`, non-owner role.
- `aws-backend/README.md` §4a already warns that VPC attachment removes default internet access and
  that these functions make outbound calls.

### Missing
- All of it. No VPC design, no subnets, no endpoints, no security groups in code.

### Resources created
Private subnets ×2 AZ · route tables · `aws_security_group` for Lambda · RDS SG updated to accept
only the Lambda SG · **interface endpoints** for `secretsmanager`, `logs`, and (if used) `lambda`,
`sqs`, `events` · **gateway endpoint** for S3 (free) · optional single NAT gateway.

(No DynamoDB endpoint — with S3-native state locking there is no DynamoDB in the architecture.)

### Cost
See §a. **$0–34/month** depending on the option chosen.

### Needs your approval
- ⚠️ **NAT gateway or not** — the single biggest recurring cost decision in this plan.
- ⚠️ **Moving `bidintel-1` to private subnets**, which breaks your current direct `psql` access and
  requires a bastion, VPN or SSM port-forwarding instead.

---

## Phase 4 — Backend

**Cognito · Lambda · API Gateway · EventBridge**

### Already in the repo
- **24 of 29 functions ported**, typechecked and built. See `aws-backend/README.md`.
- **Cognito Terraform complete** — 7 resources, 17 variables, 13 outputs, `eu-north-1` default.
- EventBridge schedules, IAM policies and deployment commands drafted in the README.

### Missing
- **`db.ts` implementations** — all DB access is stubbed; this is the single largest coding task left.
- **The 5 auth-dependent functions** (`bootstrap-org`, `draft-bid-response`, `admin-create-user`,
  `mcp`, `daily-search-alerts`).
- **`requireAuth` / `requireAdmin`** and the org-scoped data-access module.
- **Real cron schedules** — the README's are placeholders; the live ones are in Supabase `pg_cron`.
- **Bedrock migration for the two chat functions.** Decided 2026-09-10: `buyer-profile` and
  `draft-bid-response` move to **Claude on Bedrock in `eu-north-1`**, replacing
  `google/gemini-2.5-flash` and `google/gemini-2.5-pro`. Bedrock in this region offers 12 Anthropic
  models. Both calls use tool/function-calling, which maps onto the Bedrock Converse API's `toolConfig`
  — that is a real rewrite of the request/response shape, not a URL swap, and `buyer-profile`'s
  `return_buyer_profile` schema must be re-expressed. Removes 2 of the 4 Lovable dependencies.
- **The embedding provider is still undecided**, so `embed-tenders-batch` and `semantic-search`
  continue to call the Lovable gateway.

### Resources created
1 Cognito user pool + 2 app clients + 2 groups + resource server + domain · ~24 Lambda functions ·
1 HTTP API + routes + JWT authorizer · ~13 EventBridge rules · DLQ per scheduled function ·
CloudWatch log groups + alarms · IAM execution roles.

### Cost
| Item | Monthly |
|---|---:|
| Cognito, 7 users | ~$0 **[list]** — far below any tier's free allowance |
| Lambda | ~$0–2 **[est]** — 1M requests + 400k GB-s free monthly |
| API Gateway HTTP API | ~$1 **[list]** — $1.00–1.11 per million requests |
| EventBridge rules | $0 **[list]** — scheduled rules are free |
| CloudWatch logs | ~$3–8 **[est]** — the ingestion functions are chatty |
| SQS DLQs | ~$0 **[list]** |
| Bedrock (Claude, 2 chat functions) | usage-based **[est]** — on-demand per token; low at current volume, but now an AWS line item rather than a Lovable one |
| **Phase total** | **~$5 – 12** + Bedrock usage |

### Needs your approval
- 🚨 **The auth decision** (Cognito / custom JWT / hybrid). Blocks the 5 remaining functions and the
  frontend. **The Cognito schema is immutable after creation** — get custom attributes right first.
- 🚨 **The embedding provider decision** — still open. Deploying as-is keeps 2 of 4 Lovable dependencies.
- ⚠️ **Bedrock model choice** for the two chat functions, and enabling model access in the console
  (Bedrock requires per-model access to be granted before first use).
- ⚠️ **Cognito feature tier** — determines whether access-token claim customisation is available.
- ⚠️ **Do not deploy `backfill-linked-tables`** — recommendation is to run it as a script.

---

## Phase 5 — Frontend (stays on Vercel)

**Decision 2026-09-10: the frontend stays on Vercel.** "Off Lovable hosting" is satisfied by removing
the Lovable build plugins — Vercel is not Lovable. This removes S3, CloudFront, an ACM certificate in
`us-east-1` and a DNS cutover from the plan.

### Already in the repo
- A working Vite/React build (`npm run build` → `dist/`, ~1.5 MB JS / 430 KB gzipped).

### Missing
- **Removal of the Lovable build coupling.** `vite.config.ts` imports `componentTagger` from
  `lovable-tagger` and `mcpPlugin` from `@lovable.dev/mcp-js/stacks/supabase/vite`. Both must go.
  **Removing the MCP plugin means taking ownership of `supabase/functions/mcp/index.ts`**, which the
  plugin generates on every build — delete its "AUTO-GENERATED" banner line and the plugin stops
  rewriting it.
- **`@supabase/supabase-js` removal** and the client rewrite in §b.
- **Vercel environment variables** switched from `VITE_SUPABASE_*` to `VITE_COGNITO_*` +
  `VITE_API_BASE` (the Cognito Terraform's `frontend_env` output emits these).

### AWS resources created
**None.** Vercel calls the API Gateway endpoint and Cognito directly, both public.

One consequence worth noting: because Vercel is off-VPC, **the API Gateway must stay
internet-facing** (it would anyway) and CORS must name the Vercel origin explicitly rather than `*`.

### Cost
**$0 additional on AWS.** Existing Vercel billing is unchanged.

### Needs your approval
- ⚠️ **Deleting the MCP generator** and hand-owning the bundle, or replacing the generator.

## Phase 6 — CI/CD via GitHub Actions OIDC

### Already in the repo
- Nothing. No `.github/` directory exists.

### Missing
- All of it: OIDC trust, roles, workflows, environments.

### Resources created
`aws_iam_openid_connect_provider` for `token.actions.githubusercontent.com` ·
2 IAM roles (plan = read-only, apply = scoped write), trust policy restricted to
`repo:Rplus-analytics/Bidintel-uk:ref:refs/heads/main` · workflows for terraform plan/apply,
Lambda build+deploy, and frontend build+sync+invalidate.

**No long-lived AWS keys in GitHub.** OIDC issues short-lived credentials per run — notably better
than the long-lived IAM user keys currently in `~/.aws/credentials`.

### Cost
**$0.** GitHub Actions is free for public repos and has a free-minute allowance for private ones.

### Needs your approval
- ⚠️ **Granting a GitHub repo the ability to deploy to AWS.** Scope the trust policy to the exact
  repo and branch — a wildcard here is a serious hole.
- ⚠️ **Auto-apply on merge to `main`, or manual approval?** Recommend manual for phases 2-3,
  auto for Lambda code once the pipeline is trusted.

---

## Phase 7 — Cutover and rollback

### Already in the repo
- The validation strategy (assessment §17): schema diff, `md5` of ordered natural keys, golden-query
  harness of 30 queries requiring ≥95% top-20 overlap, shadow/dual-run before switching clients.
- The single frontend seam: `src/lib/contractsFinder.ts:49` (`invokeSource`).

### Missing
- A feature flag (`VITE_AUTH_PROVIDER` / `VITE_API_BASE`) to run both backends side by side.
- The delta-sync script.
- A written rollback runbook.

### Sequence
1. Freeze Supabase ingestion (disable `pg_cron` jobs).
2. Final delta-sync by `updated_at`/`created_at`.
3. Verify counts + `md5` checksums per table.
4. Run the golden-query harness against both.
5. Flip the frontend flag; keep Supabase live and readable.
6. Watch 24-48h, then re-enable ingestion **on AWS only**.

### Rollback
Flip the flag back. Supabase stays fully intact and running throughout — **do not decommission
anything for at least two weeks.** The one-way door is Cognito: once users have reset passwords
there, going back means resetting again.

### Needs your approval
- 🚨 **The cutover window itself.**
- 🚨 **Decommissioning Supabase** — only after a sustained clean period.

---
---

# Specific answers

## a) Lambda-to-RDS networking options

The constraint that makes this non-obvious: attaching a Lambda to a VPC **removes its default
internet access**, and BidIntel's functions make heavy outbound calls — Contracts Finder, Find a
Tender, TED, CKAN, PCS, CCS, and the AI gateway. So "put Lambda in the VPC" is not sufficient on
its own.

All prices **[measured]** from the Pricing API for `eu-north-1`, 2026-09-10.

| Option | How | Monthly | Verdict |
|---|---|---:|---|
| **1. Private RDS + Lambda in VPC + NAT gateway** | Classic. NAT gives the VPC-attached Lambdas outbound internet. | **$33.58/AZ** ($0.046/hr) **+ $0.046/GB** processed. One AZ ≈ **$34–40**; two AZs for HA ≈ **$67–80**. | Works, most expensive. Every byte fetched from gov.uk is billed twice (NAT processing + egress). |
| **2. Private RDS + Lambda in VPC + interface endpoints, no NAT** | Endpoints for AWS services; **no** outbound internet. | $0.0105/hr = **$7.67/endpoint/AZ**. Secrets Manager + CloudWatch Logs across 2 AZs ≈ **$30.68**. | **Only viable for functions that need no internet** — which is none of the ingestion set. |
| **3. Split: DB-only Lambdas in VPC, internet-facing Lambdas outside** | Functions needing both are the problem. | Endpoints only ≈ **$15–31** | Attractive but **most functions need both** — they fetch from gov.uk *and* write to RDS. |
| **4. RDS publicly accessible + Lambda outside the VPC, SG-restricted** | What exists today. Lambda has no static egress IP, so the SG cannot be narrowed to it. | **$0** | Requires opening the RDS SG to wide ranges. **Not acceptable for production.** |
| **5. RDS Data API** | Aurora Serverless v2 only — the three Aurora clusters were just deleted. | Migration cost | Not applicable without moving back to Aurora. |
| **6. ✅ Recommended: Lambda in VPC + gateway endpoints + interface endpoints, NAT only where genuinely needed** | The S3 gateway endpoint is **free**. Add interface endpoints for Secrets Manager and Logs. Add **one single-AZ NAT** used only by the ingestion subnets. | **1 NAT ≈ $34** + 2 endpoints ≈ **$15** = **~$49**, or **~$15 with no NAT** if the AI provider moves to Bedrock (reachable via its own interface endpoint). | Best balance. |

**The strategic point:** if you move off the Lovable AI Gateway to **Bedrock** (see the open decision
in `BIDINTEL-STATUS.md`), Bedrock is reachable via a VPC interface endpoint. Combined with gateway
endpoints for S3, that removes the NAT requirement for the search/embedding functions entirely. The
ingestion functions still need internet for gov.uk, but they are cron-driven and could run on a
single shared NAT — or on Fargate, which several of them need anyway for the 15-minute ceiling.

**Data-transfer caveat:** NAT charges $0.046/GB *processed* on top of egress. `raw_contracts_finder`
is ~2.3 GB; a full historical re-backfill through NAT would cost ~$0.11 in processing — negligible.
The recurring hourly charge dominates, not the data.

## b) How the frontend uses Supabase, and everything that must change

Measured across `src/`, not assumed.

**What is used:** the Postgres database via PostgREST (**76 direct `.from()` call sites**), Supabase
Auth (**6 call sites**), and Edge Functions (**9 `functions.invoke` call sites**).

**What is NOT used — verified zero occurrences:** Supabase **Storage** (`storage.from`,
`createSignedUrl`, `getPublicUrl`) and **Realtime** (`.channel()`, `postgres_changes`, `broadcast`,
`presence`). That removes two entire migration workstreams. Nothing needs S3 for user uploads and
nothing needs WebSockets or AppSync.

### The 76 direct table reads

| Table | Sites | Auth-sensitive? |
|---|---:|---|
| `tenders` | 7 | public-read |
| `saved_searches` | 7 | **RLS** |
| `saved_bids` | 5 | **RLS** |
| `memberships` | 4 | **RLS** |
| `notices`, `cpv_codes` | 3 each | public-read |
| `suppliers`, `raw_contracts_finder`, `organisations`, `org_match_profiles`, `frameworks`, `buyers`, `awards` | 2 each | mixed |
| `profiles`, `notices_sync_log`, `award_suppliers` | 1 each | mixed |

**21 of the 76 are on RLS-protected tables** across 9 files. Those are the security-critical ones —
today Postgres RLS is what stops one org reading another's data; after the move that guarantee moves
into Lambda code. The remaining 55 are public-read and can move at leisure.

### What must change

| Area | Change |
|---|---|
| `src/integrations/supabase/client.ts` | Delete. Replace with a Cognito config + typed API client. The generated `Database` types go too — the API needs its own. |
| `src/contexts/AuthContext.tsx` | `signInWithPassword`→`signIn`, `getSession`→`fetchAuthSession`, `onAuthStateChange`→Amplify Hub. **The two membership DB queries disappear** — org and role come from token claims. `orgName` comes from a new `GET /me`. |
| `src/pages/Auth.tsx` | Swap the sign-in call, **add a `NEW_PASSWORD_REQUIRED` screen** (every migrated user hits it), add forgot-password (there is none today). |
| `src/pages/OAuthConsent.tsx` | **Delete** — `supabase.auth.oauth` has no Cognito equivalent; Cognito's hosted UI runs its own consent. |
| All 76 `.from()` sites | Become REST calls. Start with the 21 RLS-protected ones. |
| All 9 `invoke()` sites | Become `fetch` with `Authorization: Bearer <ID token>`. |
| `src/lib/contractsFinder.ts` | The `invokeSource` seam (line 49). Also carries the four unimplemented sources — see the section below. |
| `vite.config.ts` | Remove `lovable-tagger` and `@lovable.dev/mcp-js/stacks/supabase/vite`. |
| `package.json` | Drop `@supabase/supabase-js`, `@lovable.dev/mcp-js`, `lovable-tagger`; add `aws-amplify`. |
| `.env` | `VITE_SUPABASE_*` → `VITE_COGNITO_*` + `VITE_API_BASE`. The Terraform `frontend_env` output emits these. |


## The four missing sources — unfinished, not dead

`searchAllSources` in `src/lib/contractsFinder.ts` calls **seven** sources. Four have no backing
edge function and never have: `ted-eu`, `sell2wales`, `etenders-ireland`, `etenders-ni`. The same
four appear in `sync-notices`. Both callers swallow the 404 and return an empty list, so the failure
is invisible.

**The question was whether the functions are missing or the upstreams are gone. It is the functions.**
All four upstreams answered when probed on 2026-09-10:

| Source | Endpoint probed | Result |
|---|---|---|
| TED (EU) | `POST api.ted.europa.eu/v3/notices/search` | **HTTP 200** in 0.77s |
| Sell2Wales | `www.sell2wales.gov.wales/search/api/1.0/ocdsReleasePackages` | **HTTP 200** in 1.28s |
| eTenders Ireland | `irl.eu-supply.com/api/tender` | **HTTP 202** in 0.69s |
| eTenders NI | `etendersni.gov.uk` | **HTTP 302** (redirect — the portal is up) |

**And the fetch logic already exists.** `backfill-tick` contains working extractors for three of the
four, already ported to `aws-backend/functions/backfill-tick/`:

- `backfillTed()` — TED v3 search, field list, `parseTedDate` for its `2023-01-02+01:00` format
- `backfillOcdsFeed("sell2wales", …)` — generic OCDS release-package walker
- `backfillEtendersIreland()` — the eu-supply shape
- `backfillEtendersNi()` — **deliberately returns 0**, with a comment explaining the NI portal has no
  date-filtered JSON API, only paginated HTML

TED is additionally used by `ingest-source-full`, `backfill-source-tick` and `daily-search-alerts`,
so TED ingestion demonstrably works today — only the *search proxy* is missing.

**So this is unfinished work, not dead code.** The UI advertises seven sources and delivers three.
Deleting the four would quietly remove advertised functionality; implementing them is four small
proxy functions modelled on `contracts-finder`, reusing extractors that already exist.

**Nothing deleted, as instructed.** The options:

| Option | Effort | Effect |
|---|---|---|
| **Implement all four** | ~1–2 days | Delivers what the UI already promises. NI needs HTML scraping, like `scrape-ccs-digital-outcomes`. |
| **Implement the three with JSON APIs; drop NI** | ~1 day | TED, Sell2Wales, Ireland are straightforward; NI is the only hard one. |
| **Remove all four from the UI** | ~1 hour | Honest about current capability; loses four sources of coverage. |
| **Leave as-is** | 0 | Four dropdown options that silently return nothing. Not acceptable in production. |

Recommendation: **option 2** — implement TED, Sell2Wales and eTenders Ireland as proxies during
phase 4, and remove eTenders NI from the UI until someone wants to write a scraper for it. That
matches where the working code already is.

## c) Moving the existing Supabase auth users to Cognito

**7 users, 6 memberships, 1 organisation.** Small enough to do carefully in an afternoon.

### Every column holding a Supabase auth user ID

**The migration files declare three FKs to `auth.users`. The live schema has six columns.** The
other three were added through the Supabase dashboard, so anyone planning from `supabase/migrations/`
alone would miss half of them. This table is taken from
`src/integrations/supabase/types.ts`, which Supabase generates from the **live** database.

| # | Table | Column | Declared FK to `auth.users`? | Nullable | Remapping |
|---|---|---|---|---|---|
| 1 | `profiles` | `id` (PK) | **yes** | no | Keep. Becomes the canonical app user ID, carried in the token as `custom:app_user_id`. |
| 2 | `memberships` | `user_id` (PK) | **yes** | no | Keep. Unchanged — it already points at `profiles.id`. |
| 3 | `saved_bids` | `saved_by` | **yes** | no | Keep. Server sets it from `ctx.appUserId`, never from the request body. |
| 4 | `saved_searches` | `user_id` | no (dashboard) | no | Keep. Verify it actually contains `profiles.id` values and not stray auth IDs. |
| 5 | `companies` | `user_id` | no (dashboard) | **yes** | Keep. Nullable, so audit for orphans before relying on it. |
| 6 | `user_actions` | `user_id` | no (dashboard) | **yes** | Keep. Nullable; likely an audit log. |

**Proposed remapping: change nothing in the data.** Because Cognito's `sub` cannot be set on import,
the cheaper and safer direction is to keep the existing UUIDs as canonical and teach Cognito about
them, rather than rewriting six columns across six tables:

```sql
-- Drop the FKs to auth.users (that schema disappears with Supabase), and
-- re-point them at profiles, which becomes the identity table.
ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_user_id_fkey,
  ADD  CONSTRAINT memberships_user_id_fkey
       FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.saved_bids
  DROP CONSTRAINT IF EXISTS saved_bids_saved_by_fkey,
  ADD  CONSTRAINT saved_bids_saved_by_fkey
       FOREIGN KEY (saved_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- profiles.id keeps its value; it simply stops referencing auth.users.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Durable record of the Cognito mapping, so it is not held only inside Cognito.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cognito_sub uuid UNIQUE;

-- The three dashboard-created columns have no FK. Add them now that there is
-- something valid to point at — after auditing for orphans.
SELECT 'saved_searches' t, count(*) orphans FROM public.saved_searches s
  WHERE s.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.user_id)
UNION ALL SELECT 'companies', count(*) FROM public.companies c
  WHERE c.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.user_id)
UNION ALL SELECT 'user_actions', count(*) FROM public.user_actions u
  WHERE u.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.user_id);
```

Run that orphan check **before** adding constraints — dashboard-created columns with no FK are
exactly where dangling IDs accumulate.

**Two hard constraints:**

1. **Cognito's `sub` cannot be set on import.** Three tables have FKs to `auth.users` (`profiles.id`,
   `memberships.user_id`, `saved_bids.saved_by`). **Recommendation: keep the existing UUIDs
   canonical** and carry each as a `custom:app_user_id` claim. No production rows move, and the
   authorizer resolves identity with no database lookup. Also add `profiles.cognito_sub uuid UNIQUE`
   so the mapping is recorded durably in the database and not only inside Cognito.
2. **Passwords cannot be migrated.** Cognito's import rejects bcrypt hashes. Every user lands in
   `FORCE_CHANGE_PASSWORD`.

**Procedure:**

> Commands below use shell placeholders (`$EMAIL`, `$APP_USER_ID`, …) throughout. Populate them
> from the export in step 1 — do not paste real addresses into scripts that get committed.

```sql
-- 1. Export from Supabase (run against the source, read-only)
SELECT p.id            AS app_user_id,
       p.email,
       p.display_name,
       m.organisation_id,
       m.role
FROM   public.profiles p
LEFT   JOIN public.memberships m ON m.user_id = p.id
ORDER  BY p.created_at;
```

```bash
# 2. Create each user (admin-only pool; no self sign-up)
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
                    Name=name,Value="$DISPLAY_NAME" \
                    Name=custom:org_id,Value="$ORG_ID" \
                    Name=custom:app_user_id,Value="$APP_USER_ID" \
  --desired-delivery-mediums EMAIL     # sends the invite with a temporary password

# 3. Put them in the right group
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" \
  --username "$EMAIL" --group-name "$( [ "$ROLE" = admin ] && echo org_admin || echo org_member )"
```

```sql
-- 4. Record the mapping back in Postgres, per user
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cognito_sub uuid UNIQUE;
UPDATE public.profiles SET cognito_sub = :sub WHERE id = :app_user_id;
```

**Order matters:** create users *after* SES production access is granted (phase 1), or the invite
emails will not reach anyone outside the verified-address list.

**Verify before cutover:** for all 7 users, `custom:app_user_id` must equal `profiles.id` exactly,
and `custom:org_id` must equal `memberships.organisation_id`. A mismatch is a silent cross-tenant
data bug, not an error.

**Not recommended:** a migration-trigger Lambda that verifies against Supabase on first sign-in. It
avoids the password reset but keeps Supabase Auth reachable indefinitely, which defeats the point.

## d) Which holds more recent data — Supabase or `bidintel-1`?

**Expected answer: Supabase, by a wide margin** — `bidintel-1` shows every sign of being empty
(storage flat 14 days, zero connections, no manual snapshots). But confirm it rather than assume.

Run this **on both** databases and compare. It is read-only, and tolerates the tables not existing:

```sql
-- Recency probe. Run identically on Supabase and on bidintel-1.
SELECT 'tenders' AS table_name,
       count(*)                      AS row_count,
       max(created_at)               AS latest_created,
       max(updated_at)               AS latest_updated,
       min(created_at)               AS earliest_created
FROM   public.tenders
UNION ALL
SELECT 'awards',
       count(*), max(created_at), max(updated_at), min(created_at)
FROM   public.awards
ORDER  BY table_name;
```

If `bidintel-1` errors with `relation "public.tenders" does not exist`, that is the answer: the
schema was never created, and phase 2 starts from nothing.

To check what (if anything) is there at all:

```sql
\dt public.*
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
SELECT extname, extversion FROM pg_extension ORDER BY 1;   -- is pgvector even installed?
```

I have deliberately **not** retrieved the master password. It is in Secrets Manager as
`rds!db-43ad15dc-5195-4062-b3a0-a56409a3950b`; fetch it yourself and connect to
`bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com:5432`. Your IP is already allowed by the
security group.

---

## Recommended order

Phases are not strictly sequential. The critical path is **auth decision → Cognito → the 5 remaining
functions → frontend**, and that can run in parallel with the database work.

1. **Now, unblocked:** phase 1 apply · SES production access request · confirm `bidintel-1` is empty (§d)
2. **Then:** phase 2 (schema + RLS) — the biggest single chunk of remaining work
3. **In parallel:** the auth decision, then phase 4's Cognito stack into a dev pool
4. **Then:** phase 3 networking, then `db.ts` implementations, then Lambda deploys
5. **Then:** phase 6 CI/CD, before there is enough deployed to make manual deploys painful
6. **Last:** phase 5 (Lovable decoupling + client rewrite), then phase 7 cutover

## Open decisions blocking progress

### Decided 2026-09-10

| Decision | Outcome | Consequence |
|---|---|---|
| **Auth model** | **Amazon Cognito** | Phase 4's Terraform is ready. Unblocks the 5 remaining functions and the frontend. Get custom attributes right first — **the pool schema is immutable after creation**. |
| **Frontend hosting** | **Stays on Vercel** | Phase 5 shrinks to removing Lovable build coupling. No S3/CloudFront/ACM needed, saving ~$1–5/month and a `us-east-1` certificate. |
| **Chat models** | **Claude on Bedrock, `eu-north-1`** | `buyer-profile` (was `gemini-2.5-flash`) and `draft-bid-response` (was `gemini-2.5-pro`) move to Bedrock. Removes 2 of the 4 Lovable dependencies. |
| **Embeddings** | **Pending** | Awaiting coverage numbers. `embed-tenders-batch` and `semantic-search` stay on the Lovable gateway until then. |

### Still open

| # | Decision | Blocks |
|---|---|---|
| 1 | **Embedding provider** — Lovable / OpenAI direct / Bedrock | Phase 4, phase 3's NAT requirement, and whether a full 20k re-embed is needed |
| 2 | **NAT gateway or not** | Phase 3, ~$34/month |
| 3 | **Reuse or recreate `bidintel-1`**, and **downsize to `t4g.medium`** | Phase 2 and 3, ~$982/year |
| 4 | **Multi-AZ RDS** | Phase 2 |
| 5 | **The four missing sources** — implement three, or remove from the UI | Phase 4 |
