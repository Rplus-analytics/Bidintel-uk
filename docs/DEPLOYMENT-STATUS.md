# BidIntel — AWS Deployment Status

**Updated:** 2026-09-15 (RLS verified; deploys in progress) · **Branch:** `aws-migration` · **Account:** `008041477140` · **Region:** `eu-north-1`

Handoff document. Another engineer should be able to pick the work up from here.
Companion docs: [`DEPLOYMENT-PLAN.md`](DEPLOYMENT-PLAN.md) · [`BIDINTEL-STATUS.md`](BIDINTEL-STATUS.md) · [`RESTORE-LOVABLE-EXPORT.md`](RESTORE-LOVABLE-EXPORT.md) · [`../aws-backend/README.md`](../aws-backend/README.md)

> **No secrets, passwords or email addresses appear in this document, and none should be added.**

---

## ⏭️ EXACT NEXT STEP

**Deploy the five launch Lambdas, then the HTTP API.** Nothing is half-applied; the last completed
action was the grant lock-down and RLS proof below, plus the `buyer-profile` OpenAI repoint.

In order:

1. **Deploy Lambdas.** `semantic-search` + `buyer-profile` **in the VPC** (subnets
   `subnet-0ff77108be79ccdd5`, `subnet-0a1094478008deedb`, SG `sg-054bd4a03c245e2e7`) with
   `DATABASE_SECRET_ARN` → `bidintel/api-db` and `OPENAI_API_KEY` from `bidintel/openai`.
   `contracts-finder`, `contracts-scotland`, `find-a-tender` **outside the VPC** — no DB, no NAT
   cost, no ENI cold start. Each execution role gets `secretsmanager:GetSecretValue` scoped to only
   the secret it needs.
2. **HTTP API** with a Cognito JWT authorizer on every route (issuer
   `https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_9LKk8RR6t`, audience
   `4ua1vhje9gmm3kekuk6spvf1r`). CORS: `http://localhost:8080` and
   `https://bidintel-drab.vercel.app` only.
3. **PostgREST on Fargate + ALB** (plan first). HTTP only — see the HTTPS risk below. ALB security
   group restricted to the test machines' IPs, never `0.0.0.0/0`.
4. **Frontend rewrite** on `aws-migration`, then the two test users, then local end-to-end test.
5. **Then the ingestion adapter** — see "Required before cutover".

**Nothing is half-finished.** All Terraform state is in S3 and `terraform plan` is clean on every
applied stack.

---

## Working rules

1. **Never push to `main`.** Vercel deploys production from `main`. All work goes on `aws-migration`.
2. **All EventBridge schedules stay disabled until cutover.** Workers are tested with single manual invokes only.
3. **Show the `terraform plan` before applying.** Every stack, every time.
4. **Never print user data** — no rows from `profiles`, `auth.users`, `memberships` or `saved_*`.
5. **Never make the repository public.** It contains infrastructure detail and account IDs.
6. **Lovable Cloud stays live and untouched** until testing passes end to end. No cutover yet.

---

## Current state

### Applied and verified

| Stack | State file | Resources |
|---|---|---|
| `aws-backend/infra/phase1` | `s3://bidintel-tfstate-008041477140/phase1/` | S3 state bucket (versioned, AES256, public access blocked, TLS-only policy, 90-day noncurrent expiry), 4 empty Secrets Manager containers, SES domain identity + DKIM + custom MAIL FROM |
| `aws-backend/infra/phase3-network` | `…/phase3-network/` | 2 private subnets, 1 NAT gateway, S3 gateway endpoint, Lambda security group, RDS ingress rule |
| `aws-backend/auth` | `…/auth/` | Cognito user pool, SPA app client, 2 groups, resource server, hosted domain, pre-token-generation Lambda |

All three use the S3 backend with `use_lockfile = true` (S3-native locking, no DynamoDB). No local-only state.

**Resource IDs**

```
RDS instance          bidintel-1   db.t4g.medium, PostgreSQL 18.3, 200 GB, single-AZ
RDS endpoint          bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com:5432
Databases             bidintel  (new, schema built)   postgres  (old July import, untouched)
VPC                   vpc-0b343e728bc5e8eb1  (default VPC, 172.31.0.0/16)
Private subnets       subnet-0ff77108be79ccdd5 (1a), subnet-0a1094478008deedb (1b)
NAT gateway           nat-0a210f3f92024191e     static egress IP 13.51.139.129
Lambda security group sg-054bd4a03c245e2e7      egress only, no ingress
RDS security group    sg-0ee45efaf95f0dce1      5432 from one office IP + the Lambda SG
Cognito user pool     eu-north-1_9LKk8RR6t      feature plan ESSENTIALS
Cognito SPA client    4ua1vhje9gmm3kekuk6spvf1r
Cognito domain        bidintel-auth.auth.eu-north-1.amazoncognito.com
Cognito issuer        https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_9LKk8RR6t
Pre-token Lambda      bidintel-pre-token-generation
State bucket          bidintel-tfstate-008041477140
```

### Database `bidintel` — schema built and data loaded

Built from Lovable's live `schema.sql` (the source of truth), applied with `ON_ERROR_STOP=1`.

| Object | Built | Live |
|---|---:|---:|
| Tables | 46 | 46 |
| RLS policies | 52 | 52 |
| Triggers | 24 | 24 |
| Foreign keys | 25 | 25 |
| Tables with RLS enabled | 46 | — |

All four `search_tenders_hybrid` overloads installed from the live definition. Critical unique
constraints verified present, including `buyers(name)` and `suppliers(name)` — the July import had
none, which is how `awards` ended up with 14,188 duplicate rows.

**Data load, 2026-09-15.** All 19 exported tables streamed in FK order directly from the zips (no
local unzip), with user triggers disabled during the load so the export's own derived values were
preserved. Every count matches `row_counts.csv`:

```
tenders 22,691   notices 22,855   awards 16,333   award_suppliers 21,922
suppliers 14,220  cpv_codes 9,454  buyers 3,387   tenders_ccs 572
backfill_state 16  saved_searches 7  profiles 7   memberships 6   auth.users 7
organisations 1    org_match_profiles 1   org_name_aliases 6   saved_bids 3
companies 0        user_actions 0
```

Verification: **zero FK orphans** across every single-column foreign key; **`awards` has 16,333 rows
and 16,333 distinct `(source, external_id)` — no duplicates**, unlike the July import. Sequence
resets were a no-op: all 31 primary keys are `uuid` with `gen_random_uuid()` defaults and there are
zero identity/serial columns.

**Embeddings: 22,691 of 22,691 tenders — 100% coverage.** The export arrived with 22,088 already
embedded; the remaining 603 (602 left `processing` by Lovable's interrupted run, plus 1 `failed`)
were reset to `pending` and embedded on 2026-09-15 in 14 manual invocations of
`embed-tenders-batch`, zero failures. All vectors 1536-dim and served by the HNSW index — top-10
nearest neighbour in 3.3 ms.

`embed-tenders-batch` was repointed from the Lovable AI Gateway to **OpenAI directly**
(`text-embedding-3-small`, same model the gateway proxied, so vectors stay comparable with the
22,088 already stored). Its `db.ts` is implemented: `pg`, module-scope pool at `max: 1`, and an
atomic `FOR UPDATE SKIP LOCKED` claim replacing the original's non-atomic SELECT-then-UPDATE, which
could make two overlapping runs pay twice for the same vectors.

> **TEMPORARY — must be fixed in step 4.** That run used the **RDS master credentials**, because the
> least-privilege roles did not exist yet. Every worker must be switched to `bidintel_app` with
> least-privilege grants and re-verified with one invocation. **No deployed Lambda may hold master
> credentials at cutover.**

`authenticated`, `anon`, `bidintel_app` and `postgres` all have `rolbypassrls = false`.

**Lovable's dump needed four fixes to apply.** Scripts in `aws-backend/schema/`:

1. Ordered alphabetically per table with constraints inline, so foreign keys fire before their
   target tables exist → split into dependency-ordered passes.
2. 69 constraint-backed indexes declared twice (via `ADD CONSTRAINT` and again via `CREATE INDEX`,
   same name) → duplicates dropped.
3. 145 `LANGUAGE c` functions (pgvector / pg_trgm internals) → filtered; RDS `postgres` is not a
   superuser and `CREATE EXTENSION` already provides them.
4. Views precede the functions they call, and functions are alphabetical so callers precede callees
   → function pass iterated to convergence.

### Not yet done

| Item | Status |
|---|---|
| Data load into `bidintel` | **DONE 2026-09-15** — 19/19 tables, counts match `row_counts.csv` exactly, zero FK orphans, zero duplicate awards |
| `db.ts` — `embed-tenders-batch` | **DONE** — `pg`, pool `max: 1`, atomic `FOR UPDATE SKIP LOCKED` claim |
| `db.ts` — `semantic-search` | **DONE** — 14-arg RPC via named arguments, OpenAI query embedding. Verified end to end: real queries return correctly ranked results |
| `db.ts` — ingestion/backfill workers | **REQUIRED BEFORE CUTOVER, not optional** — see below |
| `buyer-profile` OpenAI repoint | **DONE** — `gpt-4o-mini`, same tool-calling contract, verified live (8-person org chart) |
| Lambda deploys + API Gateway | not started — **next** |
| PostgREST on Fargate + ALB | not started (Terraform not yet written) |
| Cognito test users | not created |
| Frontend Cognito/PostgREST rewrite | not started |
| HNSW vector index | **DONE 2026-09-15** — `tenders_embedding_hnsw_idx`, 159 MB. Column altered to `vector(1536)` first, since HNSW cannot index an unconstrained `vector`. Planner confirmed using it: top-10 nearest neighbour in 5.3 ms |

---

## Required before cutover: the ingestion adapter

The ten ingestion and backfill workers all reach the database through
`aws-backend/functions/_shared/db.ts`, which is still a PostgREST-shaped stub that throws. Until it
is implemented:

**the AWS database goes stale the moment Lovable stops writing.** No new tenders, no new notices, no
new awards. The loaded data is a point-in-time copy from 11 Sep.

It is deferred only because the login/search path was prioritised for testing. It is **not**
optional, and it is the last thing standing between a working test stack and a cutover-ready one.

## Decisions, and why

| Decision | Reasoning |
|---|---|
| **Region `eu-north-1`** | The existing RDS instance already lives there. Every service the plan needs was verified available. |
| **Frontend stays on Vercel** | "Off Lovable hosting" only requires removing the Lovable build plugins. Avoids S3 + CloudFront + a `us-east-1` certificate. |
| **Cognito for auth** | Managed, integrates with API Gateway's JWT authorizer, no server to run. |
| **PostgREST for data access** | Keeps the frontend's ~76 `supabase-js` `.from()` call sites working with a URL change instead of a rewrite. |
| **Pre-token-generation trigger V1, not V2** | V2 (access-token customisation) needs the Essentials or Plus plan. V1 customises the ID token and works on any tier. PostgREST validates whichever JWT it is handed, so the tier dependency disappears. |
| **OpenAI direct at launch, Bedrock later** | `text-embedding-3-small` is an OpenAI model, so embeddings stay vector-identical to what Lovable produced. Bedrock would need the two chat functions rewritten for the Converse API. |
| **`bidintel` built from `schema.sql`, not the migrations** | The live schema has 46 tables and ~100 unique constraints; the migrations have 30 and 15. Building from migrations would have reproduced the duplicate-rows failure across many tables. |
| **Reuse `bidintel-1`, resized to `db.t4g.medium`** | Saves ~$82/month over `db.m7g.large`. The ~250–320 MB pgvector working set fits inside its 1 GiB `shared_buffers`. CPU, not memory, is the constraint. |
| **Local testing only** | Vercel Hobby cannot deploy private GitHub organization repos. Pro upgrade is pending someone else's decision. |
| **Single NAT gateway** | $33.58/month per AZ. One is a single-AZ dependency, accepted: the interactive path never traverses it. |
| **HNSW index built** | Lovable's dump types `tenders.embedding` as unconstrained `vector`, losing the `(1536)` dimension that HNSW requires. The column was altered to `vector(1536)` (all 22,088 stored vectors verified 1536-dim), then the index built with `SET maintenance_work_mem = '512MB'` and the table `ANALYZE`d. Without it every semantic search would scan 22k rows. |

---

## Lovable's live pg_cron schedules (all UTC)

Source of truth for cadences — the export does **not** contain them.

| Job | Schedule | AWS target | Planned AWS time |
|---|---|---|---|
| `ingest-fts-daily` | `0 6 * * *` | `ingest-fts` | 06:15 |
| `ingest-cf-daily` | `5 6 * * *` | `ingest-cf` | 06:20 |
| `ingest-contracts-scotland-daily` | `30 6 * * *` | `ingest-contracts-scotland` | 06:45 |
| `scrape-ccs-digital-outcomes-daily` | `35 6 * * *` | `scrape-ccs-digital-outcomes` | 06:50 |
| `ingest-pcs-full-daily` | `45 6 * * *` | `ingest-source-full` (`detail.source=pcs`) | 07:00 |
| `ingest-cf-native-every-minute` | `* * * * *` | `ingest-cf-native` | every minute |
| `backfill-raw-cf-every-minute` | `* * * * *` | `backfill-raw-cf` | every minute |
| `normalize-raw-cf-every-minute` | `* * * * *` | `normalize-raw-cf` | every minute |
| `backfill-source-tick-every-minute` | `* * * * *` | `backfill-source-tick` | every minute |
| `backfill-tick-every-5-min` | `* * * * *` (runs every minute despite the name) | `backfill-tick` | every minute |
| `embed-tenders-batch-every-min` | `* * * * *` | `embed-tenders-batch` | every minute |
| `daily-search-alerts` | `0 * * * *` (hourly) | not ported — deferred | — |
| `refresh-tenders-cf-full-mat` | `0 * * * *` (hourly) | **skipped** — the matview is read by nothing | — |
| `initial-populate-tenders-cf-full-mat` | one-time | skipped | — |

Daily jobs are offset +15 minutes so AWS and Lovable do not hit the same source APIs simultaneously
before cutover. Every-minute workers cannot be offset, but are cursor-driven and idempotent.

**All AWS schedules remain disabled until cutover.**

---

## Where secrets live

All in AWS Secrets Manager, `eu-north-1`. None are in the repository, in Terraform state, or in any
committed file.

| Secret | Contents | Loaded? |
|---|---|---|
| `bidintel/openai` | `OPENAI_API_KEY` | **yes** — verified 2026-09-15 (HTTP 200, `text-embedding-3-small`, 1536 dims) |
| `bidintel/ai-gateway` | Lovable gateway key (legacy, may not be needed) | no |
| `bidintel/resend` | Email keys for `daily-search-alerts` (deferred) | no |
| `bidintel/app-db` | **PostgREST only** — `bidintel_authenticator` (`NOINHERIT`, granted `anon` and `authenticated`, no direct table privileges) | yes |
| `bidintel/worker-db` | **Lambdas only** — `bidintel_app` login with the table privileges the workers need | in progress |

Credentials are deliberately **split**: PostgREST's role can only reach data by switching into
`anon`/`authenticated`, so RLS always applies to it; the workers' role has direct table privileges
but is never reachable from the web tier. Each Lambda execution role gets
`secretsmanager:GetSecretValue` scoped to **only** the secret it needs.
| `rds!db-…` (AWS-managed) | RDS master password | managed by AWS |

Terraform creates the secret *containers* but never their values — a `secret_version` resource would
write plaintext into state. Load values out of band.

**Loading a secret without exposing it** — run in a normal Terminal, not inside an AI tool:

```zsh
umask 077
read -rs "K?Secret value: " && printf '{"KEY_NAME":"%s"}' "$K" > /tmp/.sec && unset K && echo
aws secretsmanager put-secret-value --secret-id <name> --secret-string file:///tmp/.sec \
  --region eu-north-1 --profile <your-profile>
rm -P /tmp/.sec
```

`read -rs` keeps it off the screen and out of shell history; `file://` keeps it out of `ps` output.

---

## Database security — verified 2026-09-15

Three login roles, deliberately separated so a compromise of one tier cannot borrow another's
privileges:

| Role | Login | Inherit | BypassRLS | Used by |
|---|---|---|---|---|
| `bidintel_authenticator` | yes | **NOINHERIT** | no | PostgREST only. Zero direct table grants |
| `bidintel_api` | yes | **NOINHERIT** | no | `semantic-search`, `buyer-profile` |
| `bidintel_app` | yes | yes | **YES** | Ingestion / backfill / embedding workers only |

`bidintel_api` and `bidintel_authenticator` are **members of `authenticated` and `anon` but inherit
nothing passively** — they must explicitly `SET ROLE`, exactly as PostgREST does. Their own direct
grants would otherwise bypass the `TO authenticated` policies entirely.

### Three findings from the lock-down

1. **`authenticated` had no `USAGE` on the `auth` schema.** Every RLS policy calls `auth.uid()`, so
   every policy errored with `permission denied for schema auth` rather than filtering. Had
   PostgREST gone live first, every query would have failed — loudly, which is the safe direction,
   but it would have looked like a broken deployment rather than a missing grant.
2. **`EXECUTE` defaults to `PUBLIC`.** All 36 public functions, including the SECURITY DEFINER ones,
   were callable by unauthenticated callers. Now `REVOKE`d from `PUBLIC` and `anon`, with only
   `search_tenders_hybrid`, `current_org_id()` and `is_org_admin()` granted back to `authenticated`.
3. **`anon` is revoked from every user table**, so the pre-login role cannot reach user data at all.

Applied by [`aws-backend/schema/05-grants.sql`](../aws-backend/schema/05-grants.sql).

### RLS proof

Run as `bidintel_api` → `SET ROLE authenticated`, with `request.jwt.claims` set per identity:

| Identity | `profiles` | `saved_bids` | `saved_searches` | `tenders` |
|---|---:|---:|---:|---:|
| user A (admin) | 6 | 3 | **1** | 22,691 |
| user B (admin) | 6 | 3 | **0** | 22,691 |
| **stranger** (unknown uuid) | **0** | **0** | **0** | 22,691 |
| no claims at all | **0** | **0** | **0** | **0** |
| *superuser, RLS bypassed* | *7* | *3* | *7* | *22,691* |

A stranger sees **zero** user data, and user A sees a saved search user B does not — per-user
isolation, not merely per-org. `tenders` stays visible because it is public-read by design, and
drops to zero with no claims because `anon` is revoked from it.

## Operator database access

The RDS security group permits one operator `/32`. When the ISP address changes, connections time
out; re-point it with:

```bash
./scripts/allow-my-ip.sh                # defaults to the bidintel-deploy profile
./scripts/allow-my-ip.sh my-profile     # or name one
```

It revokes whatever operator CIDR is currently allowed and adds the current IP in a single call, so
rules never accumulate and only one operator address is ever permitted. Security-group *references*
(the Lambda SG rule) are left untouched.

## How to test locally

Vercel previews are unavailable (see decisions). Testing is local, on `http://localhost:8080`, which
is already registered in the Cognito callback and logout URLs.

**Not yet possible — the frontend rewrite has not started.** When it lands:

```bash
git clone git@github.com:Rplus-analytics/Bidintel-uk.git
cd Bidintel-uk
git checkout aws-migration
npm install
cp .env.example .env.local        # fill in the non-secret values
npm run dev                       # serves http://localhost:8080
```

Then sign in at `http://localhost:8080`. First login for each user goes through Cognito's
`NEW_PASSWORD_REQUIRED` screen — a temporary password arrives by email and must be changed.

`.env.local` is gitignored and must never be committed. `.env.example` contains variable *names*
and non-secret values only.

---

## Known risks and open questions

| Risk | Detail |
|---|---|
| **Semantic search needs the OpenAI key at request time** | `semantic-search` embeds each query per request. The key is loaded in `bidintel/openai` and verified (HTTP 200, 1536 dims). Corpus embedding is complete, so this affects query embedding only; without the key it degrades to keyword + CPV ranking. |
| **`bidintel_app` has BYPASSRLS** | Accepted for ingestion/backfill/embedding workers, which write rows for every organisation and would otherwise be blocked by the data tables' RLS policies. **It must never back a user-facing function.** Step 3 introduces a separate `bidintel_api` role (LOGIN, **NOBYPASSRLS**) for `semantic-search` and `buyer-profile`, so the user-facing path reads data tables normally and reaches user tables only through RLS. Until that role exists, no user-facing Lambda may be deployed. |
| **Workers still on master credentials** | `embed-tenders-batch` ran with the RDS master user as a one-off. Step 4 switches all workers to `bidintel_app`. Until then, do not deploy any Lambda with master credentials. |
| **ALB is HTTP, not HTTPS** | **Cognito ID tokens (JWTs) travel in cleartext.** Acceptable only for internal local testing from known machines, over `http://localhost:8080`, with the ALB security group restricted to the test machines' IPs. **Must be replaced with HTTPS before cutover** — anyone on the network path can capture a token and replay it. ACM cannot issue for `bidintel-drab.vercel.app`; a controlled domain is required. |
| **Operator IP churn** | The RDS security group allows a single `/32` and the operator's ISP address is dynamic. Mitigated by `scripts/allow-my-ip.sh`, which revokes the previous operator rule and adds the current IP in one call. Run it when a connection times out. |
| **`bidintel-1` is publicly accessible** | Security group restricts to one office IP plus the Lambda SG. A private-subnet rebuild is deferred. |
| **`bidintel-deploy` has AdministratorAccess** | Far more than needed. Deferred. |
| **Database master password has been used by tooling** | Rotate after launch. |
| **Vercel Pro decision is external** | Blocks both preview deploys and, potentially, the production merge at cutover. |
| **Data is a point-in-time copy** | Lovable keeps ingesting. Anything changed after 11 Sep needs re-exporting at cutover. |
| **`saved_searches`** | 7 rows exist in the app export and will load. Earlier concern that they were lost is withdrawn. |
| **Unique-index count differs from a text scan of the dump** | 70 built vs a rough text estimate of ~101. The difference is double-counting in the estimate, not a build failure. To be reconciled with a catalogue-to-catalogue diff before cutover. |

---

## Handover tasks — do next

**The OpenAI key is loaded and the embedding backfill is complete** — that task is closed.

**Continue the build** in this order: finish `db.ts` for `semantic-search` and the ingestion workers
→ split the database credentials and deploy the 5 launch Lambdas behind API Gateway → PostgREST on
Fargate and ALB (only after the grant/role lock-down) → create the two internal test users →
frontend rewrite on `aws-migration` → local end-to-end test.

## Pending — deferred until after testing

- Rotate the database master password once launch is done (Claude Code has used it)
- Replace `AdministratorAccess` on `bidintel-deploy` with scoped permissions
- Delete the Lovable export files from Lovable storage
- Remove the old `postgres` database and the final snapshots of `database-1/2/3` once `bidintel` is confirmed
- Import the remaining real users into Cognito (two internal test users exist)
- Full database security review: RLS behaviour per role and SECURITY DEFINER audit (basic grants and function lock-down are done before PostgREST goes live)
- Vercel Pro decision (owner: not the current engineer). Required because Hobby cannot deploy private GitHub organization repos, and Hobby terms are non-commercial. Check which repo production deploys from (Vercel → Settings → Git); if it is the organization repo, merging to `main` at cutover will be blocked without Pro.
- Cutover: pause Lovable writes, re-export anything changed since 11 Sep, load fresh `backfill_state`, enable EventBridge schedules, merge `aws-migration` to `main`, send users password reset emails
- **Production hosting + HTTPS decision — owner: Karan.** ACM certificate on a subdomain of a
  controlled domain vs CloudFront in front of the ALB vs another approach. Blocks cutover: the
  frontend on `https://bidintel-drab.vercel.app` cannot call an HTTP ALB (browsers block mixed
  content), and JWTs must not travel in cleartext in production
- **ECS Exec for operator database access** (long-term option). An SSM bastion was planned, costed
  and written, then dropped: ~$3.70/month plus a local plugin install plus a port-forward before
  every connection was not worth it against one security-group rule. `scripts/allow-my-ip.sh`
  handles the IP churn instead. ECS Exec remains the cleaner long-term answer because it costs
  nothing at rest
- Delete `~/bidintel-export/` from the local Mac once the load is confirmed
