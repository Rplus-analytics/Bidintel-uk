# BidIntel — AWS Deployment Status

**Updated:** 2026-09-11 · **Branch:** `aws-migration` · **Account:** `008041477140` · **Region:** `eu-north-1`

Handoff document. Another engineer should be able to pick the work up from here.
Companion docs: [`DEPLOYMENT-PLAN.md`](DEPLOYMENT-PLAN.md) · [`BIDINTEL-STATUS.md`](BIDINTEL-STATUS.md) · [`RESTORE-LOVABLE-EXPORT.md`](RESTORE-LOVABLE-EXPORT.md) · [`../aws-backend/README.md`](../aws-backend/README.md)

> **No secrets, passwords or email addresses appear in this document, and none should be added.**

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

### Database `bidintel` — schema built, no data yet

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
| Data load into `bidintel` | **not started** — next step |
| `db.ts` (database layer for all Lambdas) | not started — critical path |
| Lambda deploys + API Gateway | not started |
| PostgREST on Fargate + ALB | not started (Terraform not yet written) |
| Cognito test users | not created |
| Frontend Cognito/PostgREST rewrite | not started |
| HNSW vector index | **deliberately skipped** — see below |

---

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
| **HNSW index skipped for now** | Lovable's dump types `tenders.embedding` as unconstrained `vector`, losing the `(1536)` dimension. HNSW requires a dimension. Left unconstrained by decision; semantic search still works, just without the index (sequential scan over ~22k vectors). Revisit with `ALTER TABLE tenders ALTER COLUMN embedding TYPE vector(1536)` then build HNSW with `SET maintenance_work_mem = '512MB'`. |

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
| `bidintel/openai` | `OPENAI_API_KEY` | **no — handover task** |
| `bidintel/ai-gateway` | Lovable gateway key (legacy, may not be needed) | no |
| `bidintel/resend` | Email keys for `daily-search-alerts` (deferred) | no |
| `bidintel/app-db` | Application database role credentials | no |
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
| **Semantic search needs the OpenAI key** | `semantic-search` embeds each query at request time. Without the key it degrades to keyword + CPV ranking, which it handles gracefully. 665 tenders also still need embedding. |
| **No HNSW index** | Vector search does a sequential scan over ~22k rows. Acceptable at this scale; revisit if latency is poor. |
| **`bidintel-1` is publicly accessible** | Security group restricts to one office IP plus the Lambda SG. A private-subnet rebuild is deferred. |
| **`bidintel-deploy` has AdministratorAccess** | Far more than needed. Deferred. |
| **Database master password has been used by tooling** | Rotate after launch. |
| **Vercel Pro decision is external** | Blocks both preview deploys and, potentially, the production merge at cutover. |
| **Data is a point-in-time copy** | Lovable keeps ingesting. Anything changed after 11 Sep needs re-exporting at cutover. |
| **`saved_searches`** | 7 rows exist in the app export and will load. Earlier concern that they were lost is withdrawn. |
| **Unique-index count differs from a text scan of the dump** | 70 built vs a rough text estimate of ~101. The difference is double-counting in the estimate, not a build failure. To be reconciled with a catalogue-to-catalogue diff before cutover. |

---

## Handover tasks — do next

**1. Load the OpenAI key.** First set a monthly spending limit in OpenAI's billing settings. Semantic
search will not work in testing without this. Run in a zsh Terminal window, **not** inside Claude
Code, using your own AWS profile:

```zsh
umask 077
read -rs "K?OpenAI key: " && printf '{"OPENAI_API_KEY":"%s"}' "$K" > /tmp/.oai && unset K && echo
aws secretsmanager put-secret-value --secret-id bidintel/openai --secret-string file:///tmp/.oai \
  --region eu-north-1 --profile <your-profile>
rm -P /tmp/.oai
```

Then enable `buyer-profile`, run `embed-tenders-batch` once manually for the 665 unembedded tenders,
and test semantic search locally.

**2. Continue the build** in this order: load data into `bidintel` → `db.ts` → deploy Lambdas and
API Gateway → PostgREST on Fargate and ALB (only after the grant/role lock-down passes) → create the
two internal test users → frontend rewrite on `aws-migration` → local end-to-end test.

---

## Pending — deferred until after testing

- Rotate the database master password once launch is done (Claude Code has used it)
- Replace `AdministratorAccess` on `bidintel-deploy` with scoped permissions
- Delete the Lovable export files from Lovable storage
- Remove the old `postgres` database and the final snapshots of `database-1/2/3` once `bidintel` is confirmed
- Import the remaining real users into Cognito (two internal test users exist)
- Full database security review: RLS behaviour per role and SECURITY DEFINER audit (basic grants and function lock-down are done before PostgREST goes live)
- Vercel Pro decision (owner: not the current engineer). Required because Hobby cannot deploy private GitHub organization repos, and Hobby terms are non-commercial. Check which repo production deploys from (Vercel → Settings → Git); if it is the organization repo, merging to `main` at cutover will be blocked without Pro.
- Cutover: pause Lovable writes, re-export anything changed since 11 Sep, load fresh `backfill_state`, enable EventBridge schedules, merge `aws-migration` to `main`, send users password reset emails
- Delete `~/bidintel-export/` from the local Mac once the load is confirmed
