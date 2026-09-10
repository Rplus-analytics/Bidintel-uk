# BidIntel — Project Status

**Last updated:** 2026-09-10
**Scope:** the Supabase → AWS migration, from the read-only assessment of 2026-08-10 to today.
**Status change 2026-09-10:** AWS access obtained; the account was swept read-only for the first time. Findings in [AWS account — verified state](#aws-account--verified-state-2026-09-10).
**Companion documents:** [`docs/migration/supabase-aws-migration-status.md`](migration/supabase-aws-migration-status.md) (the original assessment) · [`aws-backend/README.md`](../aws-backend/README.md) (deployment detail) · [`aws-backend/auth/AUTH-MIGRATION-PLAN.md`](../aws-backend/auth/AUTH-MIGRATION-PLAN.md) (auth design)

---
---

# PART 1 — EXECUTIVE SUMMARY

*Written for a non-technical reader. Terms are explained where they appear.*

## What BidIntel is

BidIntel is a search and intelligence platform for UK public-sector procurement. It continuously
collects contract notices — tenders being advertised, contracts being awarded — from official
government sources such as Contracts Finder, Find a Tender, Public Contracts Scotland and the EU's
TED, and brings them together in one searchable place. Users can search by meaning rather than just
keywords, save opportunities into a bid pipeline, set up alerts for new matching contracts, and
research the public bodies doing the buying. It currently serves one organisation with seven user
accounts, and holds roughly 20,000 tender records, 20,000 notices and 14,700 award records, on top
of a much larger raw archive of about 625,000 unprocessed source records.

## What this project is

BidIntel currently runs on **Supabase**, a hosted platform that bundles a database, user logins and
small server-side programs into one product. The goal is to move it onto **Amazon Web Services
(AWS)**, where each of those pieces becomes a separate, independently managed service. The reasons
are ownership and control: on AWS the infrastructure is defined in code the team owns, rather than
configured inside another company's dashboard.

The work splits into four parts: the **database**, the **29 server-side programs** (called
"functions") that fetch and process data, the **login system**, and the **website itself**.

## What has been accomplished

**All 29 server-side functions were catalogued, and 24 of them have been rewritten for AWS.**

The functions were rewritten in four batches, easiest first, so that each batch proved out the parts
of AWS the next batch would depend on:

1. **Four simple data-fetching functions** — these just pass requests through to government websites
   and touch nothing else. Fully working and tested against the live government APIs.
2. **Four search and AI functions** — the main search feature, plus the components that let users
   search by meaning rather than exact words.
3. **Ten daily data-collection functions** — the scheduled jobs that pull in new contract notices
   every day.
4. **Six historical catch-up functions** — the jobs that work backwards through years of archived
   records.

**Alongside that, three things were designed or documented:**

- **A complete plan for replacing the login system**, including the infrastructure written as code,
  ready to be switched on once an AWS account is available.
- **A precise inventory of what the database must contain** for the move to work — not just the
  tables, but the more easily-missed pieces (automatic rules, search indexes, permission rules) that
  a simple data export would silently leave behind.
- **A written record of every problem found along the way**, covered below.

**Nine real problems in the existing system were found and documented.** These were not the goal of
the work — they surfaced because migrating code requires reading it line by line. Four matter enough
to act on regardless of whether the AWS move proceeds:

- **Three internal maintenance jobs can be triggered by anyone on the internet.** Two require no
  password or key of any kind; the third requires only a key that is publicly visible in the
  website's own code. All three can write to the database. This is the most serious finding, and it
  is fixable today without waiting for the migration.
- **One data-collection job appears to be double-paying for AI processing.** Because of how it
  claims work, two overlapping runs can process the same records twice, and each processing step
  costs money. **This is still happening in the live system** — the fix exists only in the new,
  not-yet-running AWS version.
- **One function has never worked.** Its backup processing path produces data in a format the
  database rejects, so it fails every time it is used. Nothing in the website calls it, so the
  impact is nil, but it should be deleted or repaired rather than carried forward.
- **One data-collection job silently collects from three sources, not the seven it claims.** Four of
  the seven sources it tries to contact do not exist; the failures are swallowed without any error.

## What is still remaining

Nothing has been deployed to AWS. The rewritten code exists, compiles, and has been tested as far as
it can be without an AWS account — but the live system is still entirely on Supabase and is
completely unaffected.

The remaining work, largest first. **These estimates assume one experienced developer and are
indicative, not commitments** — the database and login items in particular could vary considerably
depending on decisions not yet made.

| Remaining work | What it involves | Rough effort |
|---|---|---|
| **Replace the login system** | Move seven user accounts to AWS, and rebuild the permission rules that currently live inside the database. Every user will need to set a new password — passwords cannot be transferred. Touches the website extensively. | **Largest single item** — 2-4 weeks |
| **Set up the database on AWS and move the data** | Create the database, recreate its structure exactly, move roughly 760,000 records (plus 315,000 log rows that are rebuildable and may not need moving), verify nothing was lost. Complicated by the live system still growing daily. | 1-2 weeks |
| **Connect the rewritten functions to the database** | The 24 rewritten functions currently stop at the point where they would talk to the database. The required database instructions are written down; they need implementing and testing. | 1-2 weeks |
| **Update the website** | The website currently talks to the database directly in 21 places across 9 files. Each needs redirecting through the new AWS services. | 1-2 weeks |
| **Rewrite the last 5 functions** | Deliberately left until last because all five depend on the login system being replaced first. | 3-5 days |
| **Set up the AWS infrastructure itself** | Accounts, networking, permissions, monitoring, scheduling. | 3-5 days |
| **Testing and switch-over** | Run both systems side by side, compare results, pick a switch-over window. | 1 week |

## Blocker status — cleared 2026-09-10

**The blocker that had held since August is gone.** Credentials were obtained on 2026-09-10 and the
account was surveyed. For the record, the answer to the assessment's open question #1 is: **account
`008041477140`, resources in `eu-north-1` (Stockholm)**.

### What the survey found

The August assessment could not see the AWS side at all, and hedged that a previous team member
might have taken the work as far as "Stage 3". The reality is **Stage 1**: some databases were
created in late July, and nothing else was ever built.

- **One database worth keeping** — `bidintel-1`, PostgreSQL 18.3, 200 GB, created 30 July.
- **Three databases that were experiments** — created 29-30 July, each holding 40 MB, i.e. empty.
  These have now been deleted.
- **Nothing else exists in any of the 17 enabled regions.** No application servers, no scheduling,
  no login system, no file storage, no stored application passwords.
- **The database appears to be empty.** Its storage has not changed in 14 days and nothing has
  connected to it. This still needs confirming by logging in, but on present evidence **no data was
  ever migrated**.
- **The earlier work was done by hand through the AWS web console**, not scripted. There is nothing
  to inherit, and nothing that has to be worked around.

### What that means for the plan

Mostly good news. A hand-built, empty database is easier to deal with than a half-migrated one: there
is no partial state to reconcile and no risk of silently inheriting a broken import. The two
questions that were expected to determine whether the database work took days or weeks — *was the
structure copied?* and *did the search data survive?* — are probably both moot, because there is
nothing there.

### Two problems the survey turned up

1. **Cost.** The account has spent **$431 since late July** on infrastructure that has never been
   used. Deleting the three unused databases removes roughly half of that going forward.
2. **Security.** Several resources were left open to the internet. Most were closed on 2026-09-10
   (see the technical section); **two items remain open at the time of writing** — an unused
   Windows server and a firewall rule allowing remote desktop access from anywhere.

### Decisions taken, and what is left

**Region: decided on 2026-09-10 — Stockholm (`eu-north-1`)**, where the database already sits.
Every design document and configuration file has been updated to match. All the AWS services the
plan depends on were checked and are available there.

Still open:

1. **A decision on the login system** — three viable options, and the choice materially changes the
   effort. Detail is in the technical section.
2. **What replaces the AI provider.** Four features — search, the AI writing assistant, buyer
   research, and the process that makes search work at all — currently call an AI service run by
   Lovable, the very platform this project is migrating away from. Nothing has been decided about
   what happens to that. If the Lovable subscription ends before this is resolved, search quality
   degrades and no new contracts become searchable. Detail in the technical section.
3. **Confirm the database is empty**, which takes one login and one command.

## Honest assessment of where this stands

The migration is roughly **40% complete by effort, and 0% deployed**. The rewriting is substantial
and has been verified as rigorously as possible without a live environment. The remaining 60% still
contains the two hardest items — the database move and the login replacement.

What changed on 2026-09-10 is that both are now *startable*. Access exists, and the earlier work
turns out not to have produced anything that constrains the approach. The next meaningful milestone
is a database on AWS with the correct structure and the data loaded, which is now a matter of doing
the work rather than waiting on anyone.

The most valuable thing that could happen this week is closing the two remaining open items above,
and one login to `bidintel-1` to confirm it is empty.

---
---

# PART 2 — TECHNICAL HANDOFF

## Architecture

### Current (live, serving users)

```
  Browser
     │
     ▼
  React 18 + Vite + TypeScript SPA  ──►  hosted on Vercel
  (shadcn/ui, TanStack Query, react-router)
     │
     ├─────────────► Supabase Postgres  (direct PostgREST queries, RLS-enforced)
     │                 · ~20k tenders, ~625k raw_contracts_finder (2.3 GB)
     │                 · pgvector 0.8.0, pg_trgm 1.6, pgcrypto, uuid-ossp
     │                 · pg_cron 1.6.4 + pg_net 0.20.0 drive every scheduled job
     │
     ├─────────────► Supabase Auth  (email/password; 7 users, 1 org)
     │
     └─────────────► 29 Supabase Edge Functions (Deno)
                       └─► Contracts Finder, Find a Tender, PCS, TED,
                           CKAN, CCS, Lovable AI Gateway, Resend
```

> **Note on Vercel:** the frontend is hosted on Vercel per the team, but **no `vercel.json` or
> `.vercel` directory is committed** — the project is configured through the Vercel dashboard. The
> root `README.md` is the untouched Lovable placeholder. Whoever picks this up will not find
> deployment config in the repo.

### Target

```
  Browser ──► SPA (Vercel, unchanged hosting)
                │
                ├─► Amazon Cognito                 (replaces Supabase Auth)
                ├─► API Gateway → Lambda           (replaces HTTP Edge Functions)
                ├─► EventBridge → Lambda           (replaces pg_cron + pg_net)
                └─► RDS PostgreSQL                 (replaces Supabase Postgres)
                     + Secrets Manager, CloudWatch, VPC/NAT
```

### Key architectural fact

The frontend currently **queries the database directly** via PostgREST, and Postgres row-level
security (RLS) is what stops one organisation reading another's data. There are **21 direct table
call sites across 9 files** (`AuthContext.tsx`, `useSavedBids.ts`, `useMatchProfile.ts`, two MCP
tools, `Settings.tsx`, `SavedSearches.tsx`, `Contracts.tsx`, `Admin.tsx`). On AWS these must go through Lambda endpoints, which means the
security model moves from the database into application code. That inversion is the single most
dangerous part of this migration and is covered in the auth plan.

## Repository layout

```
src/                                    frontend — DO NOT MODIFY during migration
supabase/                               live backend — DO NOT MODIFY during migration
  functions/          29 Deno edge functions
  migrations/         90 SQL migration files
aws-backend/                            the migration work
  README.md           deployment detail, timeouts, per-batch notes
  auth/               Cognito Terraform + AUTH-MIGRATION-PLAN.md
  functions/
    _shared/          ocds-linked.ts, notices-mirror.ts, s2w-style.ts, db.ts
    <24 functions>/   index.ts + package.json + tsconfig.json
docs/
  BIDINTEL-STATUS.md  this file
  migration/supabase-aws-migration-status.md
```

Build: `cd aws-backend && npm install && npm run typecheck && npm run build`.
All 24 functions typecheck and build clean. Batches 3-4 bundle with **esbuild** so `_shared` is
inlined into each function's single `dist/index.js` — zips stay independent, handler is always
`index.handler`.

## Function port status — 24 of 29

### Ported (24)

| Batch | Functions | Trigger | DB |
|---|---|---|---|
| **1 — stateless proxies** | `contracts-finder`, `find-a-tender`, `contracts-scotland`, `scrape-cf-notice` | API Gateway | none |
| **2 — search & AI** | `semantic-search`, `embed-tenders-batch`, `generate-tender-embedding`, `buyer-profile` | API GW / EventBridge | stubbed (`buyer-profile` needs none) |
| **3 — daily ingestion** | `ingest-cf`, `ingest-fts`, `ingest-contracts-scotland`, `ingest-cf-native`, `ingest-cf-bulk`, `ingest-source-full`, `scrape-ccs-digital-outcomes`, `sync-notices`, `normalize-raw-cf` | EventBridge | stubbed |
| | `ingest-trigger` | **API Gateway** — admin, not cron | stubbed |
| **4 — backfill workers** | `backfill-raw-cf`, `backfill-tick`, `backfill-source-tick`, `backfill-cf-bulk-tick` | EventBridge | stubbed |
| | `backfill-status` | **API Gateway** — operator-driven | stubbed |
| | `backfill-linked-tables` | **script-first**, HTTP handler fails closed | stubbed |

"Stubbed" means the function runs end-to-end — fetching, parsing, mapping — and stops at the
database boundary with a `DbNotConfiguredError` naming the exact table and operation it needed. The
target SQL is written out in `TODO(rds)` blocks.

### Not ported (5) — and why

| Function | Blocker |
|---|---|
| `bootstrap-org` | `supabase.auth.getUser` — creates an org and makes the caller its admin |
| `draft-bid-response` | `supabase.auth.getUser` + RLS — reads `saved_bids` as the calling user |
| `admin-create-user` | `supabase.auth.admin` API — **no direct AWS equivalent**; becomes 4 Cognito admin calls |
| `mcp` | Supabase OAuth issuer + RLS. Also auto-generated by `@lovable.dev/mcp-js` from `src/lib/mcp/` |
| `daily-search-alerts` | **Not strictly auth-blocked.** Uses `auth.getUser` only on an optional `currentUserOnly` path (line 717). Its real blocker is that it depends on `semantic-search` and `saved_searches` being live on AWS first. |

All five are step 7-8 in the original assessment's recommended order. Four genuinely cannot move
until Cognito exists; `daily-search-alerts` could move earlier if its dependencies do.

## Auth migration — summary

Full detail: [`aws-backend/auth/AUTH-MIGRATION-PLAN.md`](../aws-backend/auth/AUTH-MIGRATION-PLAN.md).
Infrastructure as **Terraform** (chosen over CDK: the User Pool is foundational infra other stacks
reference by ID, and CDK needs `cdk bootstrap` in an account that doesn't exist yet). Seven
resources, 17 variables, 13 outputs. **Not applied, and not run through `terraform validate`** — no
binary and no credentials available. HCL parses, all variable and resource references resolve;
provider-schema correctness is unverified.

**Design.** Email as username, admin-create-only (matching today — there is no sign-up form).
`custom:org_id` carries the organisation; Cognito **groups** `org_admin`/`org_member` carry the role.
That works because `memberships.user_id` is the PRIMARY KEY — **one organisation per user**. Two app
clients (SPA via SRP, MCP via authorization-code + PKCE), a resource server with four scopes, and a
hosted domain.

**The load-bearing control** is the SPA client's `write_attributes`: `email` and `name` only.
`custom:org_id` is deliberately excluded, so a user cannot move themselves into another org via
`updateUserAttributes`. Remove that and the tenancy model becomes an honour system.

**Four things that will bite:**

1. **Cognito's `sub` cannot be set on import**, and three tables have foreign keys to `auth.users`.
   Recommendation: keep existing UUIDs canonical and carry them as `custom:app_user_id`, so no
   production rows move and the authorizer needs no DB lookup.
2. **Passwords cannot be migrated** — Cognito's import rejects hashes. All 7 users land in
   `FORCE_CHANGE_PASSWORD`. The SPA needs a `NEW_PASSWORD_REQUIRED` screen it does not have today.
3. **RLS fails closed; application code fails open.** Forget a filter in a policy → zero rows.
   Forget one in a Lambda → every org's data. **Recommendation: keep RLS on RDS**, swapping
   `auth.uid()` for a `current_setting('app.org_id')` session GUC set per transaction. Because all
   19 policies are written against `current_org_id()`/`is_org_admin()` rather than `auth.uid()`
   directly, **they port essentially unchanged** — a large and slightly lucky win. Non-negotiables:
   `set_config(..., true)` (transaction-local) inside a transaction; connect as a **non-owner** role
   (owners bypass RLS silently); never interpolate claims into SQL.
4. **Cognito has no RFC 7591 dynamic client registration**, which MCP clients expect. Every client's
   redirect URI must be pre-registered.

**Open decision that changes the effort materially:** Cognito, custom JWT, or keep Supabase Auth
during a hybrid phase. Eight open questions are listed at the end of the auth plan.

## AWS account — verified state (2026-09-10)

First read-only survey of the account. Everything below was observed via `describe`/`list` calls
across **all 17 enabled regions**; nothing was created, modified or deleted by that survey.

```
Account : 008041477140
Identity: arn:aws:iam::008041477140:user/karan@rplusai.co.uk   (IAM user, long-lived keys)
Region  : eu-north-1 (Stockholm) — CONFIRMED AS THE TARGET REGION on 2026-09-10.
          Every artefact in aws-backend/ has been updated from its previous
          eu-west-2 (London) default to match.
```

### What exists

| Resource | Detail |
|---|---|
| **RDS `bidintel-1`** | PostgreSQL **18.3**, `db.m7g.large`, 200 GB, encrypted, 7-day backups, created 2026-07-30. Endpoint `bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com:5432`. Parameter group `default.postgres18` (unmodifiable AWS default). |
| **EC2 `i-05e9ed85e6b3d1494`** | **Windows**, `t3.micro`, **running since 2026-07-30**, public IP `16.171.144.85`. No `Name` tag, **no key pair**. SGs `ec2-rds-1`, `launch-wizard-1`. Undocumented — almost certainly a leftover of the console's "Connect RDS to EC2" wizard. |
| **EBS `vol-0d4eb922c79190942`** | 30 GB gp3, in-use — the EC2 root disk. |
| **4 Elastic IPs** | All attached to `RDSNetworkInterface` ENIs. Three belong to the deleted clusters and release automatically; one belongs to `bidintel-1`. |
| **4 Secrets Manager secrets** | `rds!cluster-*` / `rds!db-*` — AWS-managed RDS master passwords, not application secrets. |

### What does not exist — in any of the 17 regions

**Zero** Lambda functions · **zero** API Gateways (v1 or v2) · **zero** Cognito user pools ·
**zero** EventBridge rules · **zero** S3 buckets · **zero** NAT gateways · **zero** load balancers.

No S3 at all means **no Terraform state bucket**: the earlier work was console-driven, not IaC.
Nothing to import, nothing to reconcile.

### Is there data in `bidintel-1`? Almost certainly not

- `FreeStorageSpace` **flat for 14 days** (192.3 → 192.4 GiB free of 200 GiB — it went *up*, which
  is ordinary vacuum/WAL churn)
- `DatabaseConnections` = **0** over 24h
- ~7.7 GiB accounted for, which is within the range of an empty RDS PostgreSQL cluster's overhead
- **No manual snapshots** before 2026-09-10 — all nine were automated backups, so there is no trace
  of a deliberate import or restore
- The three Aurora clusters held **40 MiB each** — the Aurora floor, i.e. definitively empty

**Not confirmable without connecting.** The master password is in Secrets Manager; retrieve and
check with:

```bash
aws secretsmanager get-secret-value --secret-id 'rds!db-43ad15dc-5195-4062-b3a0-a56409a3950b' --profile rplusai
psql -h bidintel-1.c1wecgcw065t.eu-north-1.rds.amazonaws.com -U postgres -c '\dt'
```

### Two of the assessment's open questions now answered

- **Q1 — which account/region?** `008041477140`, `eu-north-1`.
- **Q4 — is `pg_cron` enabled?** **No, definitively.** `bidintel-1` uses `default.postgres18` with
  `shared_preload_libraries = pg_stat_statements,pg_tle`. `pg_cron` must be in that list, and the
  default parameter group cannot be edited — so a custom parameter group is required before any
  scheduled-job work, and none exists.
- Q2 (DDL or CSV only?) and Q3 (did embeddings survive?) are probably moot — nothing was imported.

### Remediation performed 2026-09-10 (by the account owner, via the console)

| Action | Verified |
|---|---|
| Restricted `sg-0ee45efaf95f0dce1` (`Bindintel-Db-sg`) port 5432 from `0.0.0.0/0` to `103.214.63.239/32` | ✅ confirmed |
| Deleted `database-1`, `database-2`, `database-3` with final snapshots | ✅ in progress — instances `deleting`, clusters `backing-up`, snapshots `database-{1,2,3}-final-snapshot` `creating` |
| Enabled deletion protection on `bidintel-1` | ❌ **did not take effect** — still `DeletionProtection: false` with no pending modification |

### Open security items as of 2026-09-10

| # | Item | Status |
|---|---|---|
| 1 | **`launch-wizard-1` (`sg-08ac652f4b2cb00bc`) allows TCP 3389 (RDP) from `0.0.0.0/0`**, and is **attached to the running Windows instance** (`eni-07b0b9e99cf01b998`, in-use). Open since 30 July. | **OPEN — highest priority** |
| 2 | The Windows EC2 instance itself is undocumented, unused, has no key pair, and has been running six weeks. | **OPEN** — terminate unless someone claims it |
| 3 | `bid1` (`sg-055d57fce57b486fc`) allows TCP 5432 from `0.0.0.0/0`. **Not attached to anything**, so not exploitable — but delete it before it gets attached to something. | **OPEN — low risk** |
| 4 | `bidintel-1` deletion protection off. | **OPEN** — retry the console change |
| 5 | `bidintel-1` is still `PubliclyAccessible: true`. Acceptable now the SG is a single IP, but a private subnet with a bastion or VPN is the stronger posture, and it is what the Lambda functions will need anyway once they are VPC-attached. | Accepted risk |

Beyond those, **no security group in any of the 17 regions allows `0.0.0.0/0` or `::/0` on any
port** — swept and confirmed.

### Cost

Actual spend from Cost Explorer. Everything is in `eu-north-1`; "NoRegion" is tax.

| Service | Aug 2026 | Sep 1-10 | Total |
|---|---:|---:|---:|
| RDS | $216.46 | $94.11 | $310.57 |
| Tax | $50.81 | $21.04 | $71.85 |
| VPC (public IPv4 addresses) | $18.60 | $5.50 | $24.10 |
| EC2 — Compute (the Windows box) | $14.88 | $4.36 | $19.24 |
| EC2 — Other (the 30 GB volume) | $2.51 | $0.76 | $3.27 |
| Secrets Manager | $1.60 | $0.49 | $2.09 |
| **Total** | **$304.86** | **$126.26** | **$431.12** |

Non-RDS spend is **$48.70**, i.e. ~$32/month, almost all of it the four public IPv4 addresses and
the idle Windows instance. Deleting the three clusters removes three of those IPs and roughly half
the RDS line; terminating the EC2 instance removes the rest.

## Open decision: the Lovable AI Gateway dependency

**This is not in the original assessment, the `aws-backend/README.md`, or the auth plan. It was
found on 2026-09-10 while checking Bedrock availability, and it needs a decision.**

The migration moves off Supabase. It does **not** currently move off Lovable — four functions call
`https://ai.gateway.lovable.dev` with a `LOVABLE_API_KEY`, and the ported AWS versions call exactly
the same endpoint. Lovable is the platform this project is leaving.

### Exactly what each call requests

| Function | Endpoint | Model | Dimensions / notes |
|---|---|---|---|
| `embed-tenders-batch` | `/v1/embeddings` | `openai/text-embedding-3-small` | **1536** — no `dimensions` parameter is sent, so the model's native default applies. Matches `vector(1536)`. |
| `semantic-search` | `/v1/embeddings` | `openai/text-embedding-3-small` | **1536**, same call shape. Must match the stored vectors exactly or ranking is meaningless. |
| `buyer-profile` | `/v1/chat/completions` | `google/gemini-2.5-flash` | Tool/function-calling, one tool `return_buyer_profile` |
| `draft-bid-response` | `/v1/chat/completions` | `google/gemini-2.5-pro` | Not yet ported — one of the 5 auth-blocked functions |

Note the two embedding callers **must always agree**. `embed-tenders-batch` writes the stored
vectors and `semantic-search` embeds the query; if they ever use different models, every similarity
score becomes noise — silently, with no error.

`generate-tender-embedding` does *not* use the gateway (it calls Voyage and OpenAI directly), and is
broken anyway — see the bugs section.

### What breaks if Lovable is switched off

- **`embed-tenders-batch`** stops, so newly ingested tenders are never embedded and never appear in
  semantic search results. Silent — the ingestion jobs keep succeeding.
- **`semantic-search`** degrades to keyword + CPV ranking. It handles this deliberately: the embed
  failure is caught, `embeddingAvailable: false` is returned, and the RPC still runs with a null
  vector. So it fails gracefully, but search quality drops.
- **`buyer-profile`** returns `AI not configured` (500).
- **`draft-bid-response`** breaks entirely when ported.

### Options

| Option | Embedding model | Re-embed needed? | Notes |
|---|---|---|---|
| **A. Keep paying Lovable for gateway access only** | unchanged | **No** | Zero work, zero risk. But retains a dependency on the platform being exited, and a single point of failure outside AWS. |
| **B. Call OpenAI directly** | `text-embedding-3-small` — *the same model* | **No** — vectors stay comparable | Lowest-risk exit. Needs an OpenAI account and `OPENAI_API_KEY` in Secrets Manager. Chat models need separate replacements for the two Gemini calls. |
| **C. Move to Amazon Bedrock** | `cohere.embed-v4:0` (supports 1536, so no schema change) or `amazon.titan-embed-text-v2:0` (1024/512/256 — **would require a schema change**) | **Yes — all ~20,000 tenders** | Vectors from a different model are not comparable, so the entire corpus must be re-embedded and the HNSW index rebuilt. In exchange: everything inside AWS, IAM-authenticated, no third-party key. Bedrock in `eu-north-1` offers 43 models incl. 12 Anthropic, so the two Gemini chat calls have good replacements. |

**Not yet recommended** — pending the embedding-coverage counts below, which determine how much
re-embedding option C actually implies.

### Establishing the re-embedding cost

Run against the **Supabase source** database. The repo's migrations do not define the `vector`
columns (they were added through the dashboard — see the bugs section), so this discovers them from
the catalogue rather than assuming a list:

```sql
-- 1. Which columns are vectors, and of what dimension?
SELECT c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type
FROM   pg_attribute a
JOIN   pg_class     c ON c.oid = a.attrelid
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  a.attnum > 0
  AND  NOT a.attisdropped
  AND  format_type(a.atttypid, a.atttypmod) LIKE 'vector%'
ORDER  BY 1, 2;

-- 2. Coverage: populated vs total, for every vector column found above.
SELECT c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS type,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM %I.%I WHERE %I IS NOT NULL',
                 n.nspname, c.relname, a.attname), false, true, ''))
       )[1]::text::bigint AS embedded_rows,
       (xpath('/row/c/text()', query_to_xml(
          format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
          false, true, ''))
       )[1]::text::bigint AS total_rows
FROM   pg_attribute a
JOIN   pg_class     c ON c.oid = a.attrelid
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  a.attnum > 0
  AND  NOT a.attisdropped
  AND  format_type(a.atttypid, a.atttypmod) LIKE 'vector%'
ORDER  BY 1, 2;
```

Both are read-only. The second counts every row in each table, so on `tenders` (~20k) it is instant;
if a vector column ever turns up on `raw_contracts_finder` (~625k) expect it to take longer.

Worth also checking the pipeline's own bookkeeping, which is cheaper than counting and shows whether
anything is stuck:

```sql
SELECT embedding_status, count(*) FROM public.tenders GROUP BY 1 ORDER BY 2 DESC;
```

The migration assessment lists vector columns on `tenders`, `tenders_pcs`, `tenders_fts` and
`companies`, all `vector(1536)`, plus a legacy `notices.embedding` that is **`jsonb`, not a vector**
— the query above correctly excludes it. Only `tenders.embedding` has an HNSW index
(`tenders_embedding_hnsw_idx`).

## Bugs and security issues found

Nine issues, found by reading the code during porting. Severity is my assessment.

### 1. Three internet-reachable, write-capable maintenance endpoints — **HIGH**

Checked `supabase/config.toml` against each function's in-code auth check:

| Function | `verify_jwt` | In-code check | Actual exposure |
|---|---|---|---|
| `backfill-raw-cf` | **false** | none | **fully public URL, no credential at all** |
| `backfill-cf-bulk-tick` | **false** | none | **fully public URL, no credential at all** |
| `backfill-linked-tables` | true | **commented out** | anon key suffices — and the anon key ships in the frontend bundle |
| `backfill-status` | true | none | same as above; idempotent recompute only, so lower impact |
| `backfill-tick` | false | `INGEST_SECRET` | public URL, shared-secret gated |

`backfill-linked-tables` carries this verbatim:

```
// TEMP: auth disabled for one-off backfill run
// const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
```

All write with the service-role key. Note the exposure ranking is **not** what the comment suggests:
`backfill-raw-cf` and `backfill-cf-bulk-tick` are worse, requiring no credential whatsoever.

**Fix:** on AWS, moving the four cron workers to EventBridge deletes the problem — they get no URL.
On Supabase today, set `verify_jwt = true` and add real checks. **This is fixable now, in hours,
independently of the migration.**

### 2. `embed-tenders-batch` can pay twice for the same embeddings — **MEDIUM, live**

The code comments claim "Claim a batch atomically", but it is two statements:

```ts
// SELECT 50 rows WHERE embedding_status = 'pending'
// then separately: UPDATE those rows SET embedding_status = 'processing'
```

Cron fires every minute; a slow batch still running when the next fires means both select the same
rows and both call the paid AI Gateway for them.

**Status: still live on Supabase.** The AWS port's `db.ts` contains the correct single-statement
version using `FOR UPDATE SKIP LOCKED`, but that code is not running. Fixing production means
changing the Supabase function, which was out of scope for an additive migration.

### 3. `generate-tender-embedding` has never worked on its fallback path — **LOW**

`tenders.embedding` is `vector(1536)`. Voyage `voyage-large-2` returns 1536 (fits); the OpenAI
fallback `text-embedding-3-large` returns **3072** (rejected by the database, every time).
Separately, `voyage-large-2` has been retired by Voyage, so the primary path likely fails too and
everything falls through to the broken fallback. **Nothing in `/src` calls this function** — the
live pipeline is `embed-tenders-batch`. Delete it, or repoint both providers at 1536-dim models.

### 4. `sync-notices` silently collects from 3 sources, not 7 — **MEDIUM**

Its source list names `ted-eu`, `sell2wales`, `etenders-ireland`, `etenders-ni`. **No edge function
with any of those names exists.** They 404, and `callSource` swallows the failure and returns `[]`.
It has only ever synced `contracts-finder`, `contracts-scotland` and `find-a-tender`. The list was
preserved rather than trimmed, because deleting entries changes behaviour if those are ever written.

### 5. The migration files are not a complete record of the database — **MEDIUM, affects planning**

Replaying every `CREATE POLICY` minus every `DROP POLICY` across the 90 migration files yields **19
live RLS policies** on the 6 tables the app reads. The original assessment cites *25 across 8
tables* — and **no `CREATE POLICY` for `companies`, `matches` or `user_actions` appears anywhere in
`supabase/migrations/`**. Those were created through the Supabase dashboard.

**Consequence: do not port RLS from the migration files.** Dump the live set with
`SELECT * FROM pg_policies WHERE schemaname = 'public'`. The same caution applies to any
dashboard-created index, trigger or grant.

### 6. `saved_searches` is admin-only, and probably shouldn't be — **MEDIUM**

Policy history: a permissive read policy was added 2026-06-08, dropped 2026-06-10, and an org-scoped
`FOR ALL` policy added 2026-06-11. The end state is a single policy requiring **both**
`organisation_id = current_org_id()` **and** `is_org_admin()`, with no read policy beneath it. So a
non-admin member gets **zero rows** — not their org's rows, none — from 7 frontend call sites.
Confirm whether that is intended before it is reproduced on AWS.

### 7. `scrape-cf-notice` is mis-documented in the original assessment — **LOW**

Section 10 row 14 and the section 11 matrix both record it as a stateless proxy with no DB
dependencies. It actually reads 50 rows from `cf_scrape_queue`, writes results back, and inserts
into `ingest_runs`. It is a queue worker. Only its scrape-and-parse half is ported.

### 8. `ingest-trigger`'s admin check is self-asserted — **MEDIUM, becomes relevant at port time**

It gates on `user.user_metadata.role !== "admin"`. `user_metadata` is **user-editable**. The Cognito
equivalent is `org_admin` group membership, which is not. Flagged as `TODO(auth)`; do not port as-is.

### 9. Minor observations — **LOW**

- `admin-create-user` upserts `memberships` with `onConflict: "user_id,organisation_id"` while the
  PK is `user_id` alone — the conflict target doesn't match a unique constraint, so the upsert errors
  rather than updating when a user already has a membership.
- `backfill-cf-bulk-tick` logs the wrong month: an explicit `month` key followed by `...metrics`,
  where `metrics` is reassigned in the loop, so the spread overwrites it with the *last* month
  processed. Log-only; `prev` still records the start.
- `backfill-tick` declares `TARGET_CPV_PREFIXES` and never reads it — `matchesCpv()` unconditionally
  returns `true`, deliberately, since 2010-2014 notices lack consistent CPV codes.
- `scrape-ccs-digital-outcomes`'s `decodeEntities` handles numeric entities and six named ones, but
  not `&pound;` — a value rendered that way yields `value_number = null`. Literal `£` and `&#163;`
  both work.
- `semantic-search`'s `classifyDomain` scores by summing matched hint *lengths*, so a longer generic
  hint beats a shorter specific one: `"hmrc tax advisory"` classifies as `consultancy` (hint
  `"advisory"`, 8 chars) not `gov_finance` (hint `"hmrc"`, 4). Dual-run validation will reproduce
  this identically on both sides and therefore will not catch it.

All nine were preserved in the ports rather than silently fixed, with one deliberate exception:
`backfill-linked-tables`' handler **fails closed** (requires `BACKFILL_LINKED_TABLES_ENABLED=true`
*and* a matching `BACKFILL_ADMIN_TOKEN`; an unset token authorises nothing). Porting that one
faithfully would have meant shipping an unauthenticated write endpoint to a new cloud.

## Porting problems with no clean equivalent

- **`EdgeRuntime.waitUntil` does not exist on Lambda.** `ingest-cf-bulk`'s fan-out used it to keep
  working *after* the response returned. Lambda freezes on return, so that work would be **silently
  dropped — looking like success while ingesting nothing**. Stubbed as `invokeSelfAsync()` with the
  exact `InvokeCommand` in a `TODO(fanout)`. SQS is the better answer for a 31-day month.
  `{month, sync: true}` needs no fan-out and works today.
- **Deno's `std/csv` is unavailable.** Replaced with `csv-parse` (`columns: true` ≡ `skipFirstRow`)
  behind a shim leaving call sites unchanged. Verified on a synthetic CKAN-shaped CSV including
  quoted commas; **not** against a real CKAN file.
- **`Deno.createHttpClient({ caCerts })` has no Node equivalent.** Both `contracts-scotland` and
  `backfill-source-tick` embed a Sectigo intermediate certificate. Replaced with an `undici` `Agent`
  as the fetch dispatcher, with the cert **appended to `tls.rootCertificates`** — appending matters,
  because supplying `ca` alone *replaces* the default trust store. Verified live: a real request to
  `api.publiccontractsscotland.gov.uk` returned HTTP 200 with 17 releases.
- **Timeout budgets are tuned to Supabase, not Lambda.** Worst case: `sync-notices` allows 140s × 7
  sequential sources ≈ **16 minutes, past Lambda's 900s ceiling**; it survives today only because
  four sources 404 instantly. `ingest-source-full`, `backfill-tick` and `backfill-source-tick` have
  **no wall-clock budget at all**. `ingest-cf-native`'s `MAX_RUNTIME_MS` (50s) and `LOCK_MS` (120s)
  are coupled — raise one without the other and a tick outlives its own advisory lock. Full table in
  [`aws-backend/README.md`](../aws-backend/README.md#timeouts).

## Verification approach

Fidelity was established by **mechanical diff, not review**. For every ported function, the helper
region was diffed against the original and is byte-identical except for documented runtime-shell
changes. Where logic is tuned, it was **spliced** from the original rather than retyped: the
`semantic-search` domain taxonomy (13,881 chars / 287 lines), both Sectigo certificates, and the CCS
HTML parser.

Executed, not just compiled:

- CCS scraper extracted every field from sample listing HTML; `parseMoney("£1,250,000.50")` → `1250000.5`
- `nestRow` mapped a CKAN `releases/0/tender/title` CSV row to the right nested OCDS shape
- Cursor arithmetic across year boundaries: `nextMonth(2024,11)` → `{2025,0}`; `prevMonth(2015,1)` →
  `{2014,12}`; `pcsWeekRange(2024,52)` → Dec 30-31 → `{2025,0}`; `monthRange(2024,1)` → Feb 29
- `semantic-search` domain classification on 8 queries; confirmed generic IT CPVs do **not** leak
  into cyber queries (the file's stated anti-goal)
- `ingest-source-full` ran its **real FTS pipeline against the live gov.uk API** and stopped exactly
  at `upsert on "tenders_fts"`
- `backfill-linked-tables`' guard matrix, including that an **unset** token authorises nothing

**Not verified:** every SQL statement in the `db.ts` files, the `search_tenders_hybrid` argument
binding, any AI Gateway call, the CSV shim against a real CKAN file, and all Terraform beyond HCL
parsing.

## Next steps, in order

| # | Step | Blocked by |
|---|---|---|
| 0a | **Close RDP to the world.** `launch-wizard-1` / `sg-08ac652f4b2cb00bc` allows 3389 from `0.0.0.0/0` and is attached to a running Windows instance. | **Nothing — do this now** |
| 0b | **Terminate `i-05e9ed85e6b3d1494`** unless someone claims it, and delete the unattached `bid1` SG. | Nothing |
| 0c | **Retry deletion protection on `bidintel-1`** — the console change did not take. | Nothing |
| 0d | **Close the three exposed endpoints on Supabase.** Set `verify_jwt = true`, add real checks. | Nothing |
| 1 | ~~Obtain AWS account ID, region and credentials.~~ **DONE 2026-09-10** — `008041477140`, `eu-north-1`. | — |
| 2 | ~~Establish what the earlier team member created.~~ **DONE 2026-09-10** — four databases, nothing else, almost certainly no data. Confirm empty with one `psql` login. | — |
| 2a | ~~Decide the region.~~ **DONE 2026-09-10 — `eu-north-1` (Stockholm)**, where `bidintel-1` already lives. All Terraform defaults updated. Every service the plan needs was verified available there. | — |
| 3 | Provision RDS: **a custom parameter group** (the default `default.postgres18` cannot be edited and lacks `pg_cron`), pgvector + pg_trgm, `vector(1536)` columns, the `tenders_embedding_hnsw_idx` HNSW index. Port `search_tenders_hybrid` — **the exact 14-arg overload**, from `pg_get_functiondef`, not from a migration file. Note the target is **PostgreSQL 18.3**, newer than the Supabase source — verify extension availability. | Step 2a |
| 4 | Port RLS from `pg_policies` (**not** the migration files — see finding 5), swapping `auth.uid()` for the session GUC. Test with the **app role, not the owner** — owners bypass RLS and every test passes for the wrong reason. | Step 3 |
| 5 | `terraform apply` the Cognito stack into a **dev** pool (`aws_region` now defaults to `eu-north-1`). Last easy moment to change custom attributes — the schema is immutable afterwards. | The auth decision |
| 6 | Implement `_shared/db.ts` and the per-function `db.ts` files against RDS. VPC + NAT (these functions need outbound internet), pool `max: 1`, non-owner role. | Step 3 |
| 7 | Deploy batch 1 + `buyer-profile` (no DB, no VPC). Byte-diff 20 fixed queries against Supabase. | Step 6 |
| 8 | Deploy `embed-tenders-batch`, then `semantic-search`. Golden-query harness: 30 queries, ≥95% top-20 overlap. | Steps 3, 6 |
| 9 | Deploy ingestion + backfill on EventBridge. **Reserved concurrency 1** on all six cursor-keeping workers. DLQ + Errors alarm on every one. | Steps 3, 6 |
| 10 | Build `requireAuth`, port the 4 auth functions, import the 7 users, add the `NEW_PASSWORD_REQUIRED` screen. | Steps 4, 5 |
| 11 | Frontend cutover behind a flag. `src/lib/contractsFinder.ts:49` (`invokeSource`) is the single seam for the three search proxies. Separately, 21 direct table call sites across 9 files need new endpoints. | Step 10 |
| 12 | Final delta-sync by `updated_at` after pausing ingestion, then switch over. | Everything |

## Things that will trip you up

- **Do not modify `/supabase` or `/src`.** The migration is additive; the live app depends on both.
- **`supabase/functions/mcp/index.ts` is auto-generated** by `@lovable.dev/mcp-js` from
  `src/lib/mcp/`. A `vite build` regenerates it. Edit the source, never the bundle.
- **Root `tsconfig.json` has `"files": []`.** Plain `npx tsc --noEmit` checks *nothing* and exits 0.
  The real command is `tsc -b`.
- **`npm install` may fail** with an `EEXIST` cache error; use `--cache <dir>` to work around it.
- **The source database is still ingesting.** Every row count in the assessment is already stale
  (tenders +818 and `ingest_runs` +26,596 versus the export). A final delta-sync is mandatory.
- **CSV exports lose triggers.** Canonical-name and derived-status triggers are invisible in a data
  export; without them, new AWS ingests produce NULL canonicals and "Unknown" statuses — a bug
  already fixed once in this app.
- **The cron schedules in `aws-backend/README.md` are placeholders.** The real cadences live in
  `pg_cron`, which no session so far has been able to read. Get them with
  `SELECT jobname, schedule, command FROM cron.job;` before cutting over.

---

*For deployment commands, IAM policies, EventBridge rules, timeout guidance and per-batch porting
notes, see [`aws-backend/README.md`](../aws-backend/README.md).*
