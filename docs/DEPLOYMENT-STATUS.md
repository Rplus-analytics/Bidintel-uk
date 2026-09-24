# BidIntel — AWS Deployment Status

**Updated:** 2026-09-15 (RLS verified; deploys in progress) · **Branch:** `aws-migration` · **Account:** `008041477140` · **Region:** `eu-north-1`

Handoff document. Another engineer should be able to pick the work up from here.
Companion docs: [`DEPLOYMENT-PLAN.md`](DEPLOYMENT-PLAN.md) · [`BIDINTEL-STATUS.md`](BIDINTEL-STATUS.md) · [`RESTORE-LOVABLE-EXPORT.md`](RESTORE-LOVABLE-EXPORT.md) · [`../aws-backend/README.md`](../aws-backend/README.md)

> **No secrets, passwords or email addresses appear in this document, and none should be added.**

---

## ⏭️ EXACT NEXT STEP

**Add the two Cloudflare records so HTTPS can be finished.** Everything else is
blocked behind it. The ACM certificate requested on 15 Sep **FAILED** — ACM gives
up after 72 hours and neither record was ever added, so it must be re-requested
once DNS is ready.

Then: build the ingestion adapter (`_shared/db.ts`), which is the last thing
standing between this stack and cutover.

## Ingestion stopped on LOVABLE, around 8 September — before the migration

The "frozen at 7 Sep" symptom is **not** an artefact of the AWS copy. It is
present on the live Lovable system and predates this work.

Evidence, from the 11 Sep export itself — rows created per day in `tenders`:

| created_at | rows |
|---|---:|
| 2026-09-05 | 172 |
| 2026-09-06 | 2 |
| 2026-09-07 | 1 |
| 2026-09-08 | **127** |
| 2026-09-09 | **0** |
| 2026-09-10 | **1** |

Healthy daily ingestion through 8 Sep, then it stops. `max(published_at)` is
**7 Sep** and `max(created_at)` is 10 Sep (a single row). The export was taken on
**11 Sep**, so Lovable had already stopped ingesting three days before the copy
was made. The AWS database did not go stale — **it inherited a stale source.**

`ingest_runs` is empty in the export (0 rows), so it cannot narrow this further.

### Why this could not be confirmed against Lovable directly

The committed anon key reaches Lovable's PostgREST, but Lovable's `tenders`
policy is `auth.role() = 'authenticated'`, so anon reads are filtered to nothing
and every query returns `[]` **whether or not data exists**.

A control proved it: `published_at` between 1–5 Aug 2026 returns `[]` from
Lovable, while the AWS copy — taken from Lovable's own export — holds **317 rows**
for that exact window. So every `[]` from that key is meaningless.

This is the same trap as the semantic-search bug: under RLS, "no rows" and "no
permission" are indistinguishable. Any check of Lovable's freshness must be run
as an authenticated user or from the Lovable SQL editor.

### How to check Lovable yourself

In the Lovable Cloud / Supabase SQL editor:

```sql
-- Is anything arriving at all?
SELECT max(published_at) AS newest_published,
       max(created_at)   AS newest_row,
       count(*)          AS total
FROM tenders;

-- Where it stopped
SELECT created_at::date, count(*) FROM tenders
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;

-- The schedules themselves
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;

-- Recent runs, and why they failed
SELECT jobid, status, start_time, end_time, return_message
FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 30;
```

`cron.job_run_details` is the one that matters: it shows whether the jobs are
still firing and what they returned. If `active` is false, or the jobs are firing
and failing, that is the root cause and it is a **Lovable-side** problem to fix —
independent of this migration.

## ⚠️ WHO IS ACTUALLY ON WHICH BACKEND (checked 25 Sep)

**Nobody has used the AWS stack. All seven users are on Lovable.** This was
believed to be otherwise on 25 Sep; the evidence says clearly not:

| Check | Finding |
|---|---|
| `origin/main` contents | **No** `src/integrations/aws/` files; its client is still `createClient(VITE_SUPABASE_URL, …)` |
| `aws-migration` merged? | **No** — `git merge-base --is-ancestor` says it is not an ancestor of main |
| ACM certificate | **FAILED** — validation never completed |
| `api.bidintel.rplusai.co.uk` | **Does not resolve** — neither Cloudflare record was added |
| ALB listeners | **Port 80 only.** No HTTPS listener exists |
| ALB security group | One stale `/32` from 15 Sep. The endpoint was unreachable from *everywhere*, including the operator |
| PostgREST access log | **No request served since 17 Sep 05:53 UTC** |
| Rajesh's Cognito user | Still `FORCE_CHANGE_PASSWORD` — he has never completed an AWS sign-in |

So Vercel serves `main`, which is the **Lovable/Supabase** app. It works from any
device and loads data because Supabase is public — not because the AWS allowlist
was bypassed. **There is no AWS exposure, and there is no split-backend problem:
everyone is on one backend, the old one.**

The only AWS traffic is `REFRESH_TOKEN_AUTH` from a browser still holding a
Cognito session from 16 Sep. It refreshes tokens successfully and then reaches no
data, because the ALB was unreachable.

---


## 🚩 THREE THINGS NEED YOUR DECISION

**1. ~~Test user mapping~~ — RESOLVED 15 Sep.** The real accounts are
`@rplusanalytics.com`; `@rplusai.co.uk` was a wrong domain. Both Cognito users
now exist and are mapped to their existing `profiles.id`, so `auth.uid()`
returns the same UUID it did on Lovable and no foreign key changes.

| User | Role | Group | Status |
|---|---|---|---|
| `sanjanalagisetty111@gmail.com` | admin | `org_admin` | invited 15 Sep |
| `rajesh.boorgu@rplusanalytics.com` | admin | `org_admin` | invited 15 Sep |

Temporary passwords are valid **7 days — they expire 22 Sep 2026.** No
shared-profile workaround was used, and no user exists without a real profile
behind it.

**2. This account's total Lambda concurrency limit is 10, not 1000.**
That is the new-account default and it is shared by every function, so an
ingestion cron run and a user search compete for the same ten slots. Reserved
concurrency cannot be set at all while the cap is 10. Needs a Service Quotas
increase before cutover.

**3. Production hosting + HTTPS — owner: Karan.** Unchanged, and now blocking
more than before: see the HTTP risk below.

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
| Lambda deploys (5) | **DONE** — all five live, smoke-tested |
| API Gateway + Cognito authorizer | **DONE** — `https://tye76qu0y9.execute-api.eu-north-1.amazonaws.com` |
| PostgREST on Fargate + ALB | **DONE** — `http://bidintel-postgrest-1007768748.eu-north-1.elb.amazonaws.com` |
| Frontend Cognito auth | **DONE** — builds, typechecks, 4 tests green |
| Test users | **2 of 2** — both mapped to real profiles, both invited 15 Sep (passwords expire 22 Sep) |
| PostgREST on Fargate + ALB | not started (Terraform not yet written) |
| Cognito test users | not created |
| Frontend Cognito/PostgREST rewrite | not started |
| HNSW vector index | **DONE 2026-09-15** — `tenders_embedding_hnsw_idx`, 159 MB. Column altered to `vector(1536)` first, since HNSW cannot index an unconstrained `vector`. Planner confirmed using it: top-10 nearest neighbour in 5.3 ms |

---

## Every Supabase-specific API in `src/`, and what replaced it

The surface turned out to be small, which is why the frontend change is 200
lines rather than a rewrite. Nothing used Supabase Storage, Realtime, channels,
or `.rpc()`.

| Supabase API | Used at | Replacement |
|---|---|---|
| `supabase.from(...)` | 46 calls across 17 tables | **Unchanged.** Still the real supabase-js query builder; only its transport is repointed at our PostgREST. `postgrest-js` IS what Supabase runs |
| `supabase.auth.signInWithPassword` | `Auth.tsx` | Cognito SRP via `amazon-cognito-identity-js` |
| `supabase.auth.getSession` | `AuthContext.tsx`, `OAuthConsent.tsx` | `cognito.getSession()` — also the refresh path; the library exchanges the refresh token when the ID token is stale |
| `supabase.auth.signOut` | `AuthContext.tsx` | `cognito.signOut()` — clears localStorage unconditionally |
| `supabase.auth.onAuthStateChange` | `AuthContext.tsx` | Local listener set, same `{ data: { subscription } }` return shape |
| `supabase.auth.oauth` (Lovable extension) | `OAuthConsent.tsx` | **No equivalent.** Guarded to return a clear error instead of throwing on `undefined`. Route `/.lovable/oauth/consent` is unreachable without a Lovable MCP client |
| `supabase.functions.invoke` | 9 call sites | `POST ${VITE_API_BASE_URL}/<name>`, Cognito ID token attached |
| Supabase Storage | — | not used |
| Supabase Realtime / channels | — | not used |
| `supabase.rpc()` | — | not used directly; `search_tenders_hybrid` is reached through the `semantic-search` Lambda |

### The nine `invoke()` call sites

| Function | Call site | Status |
|---|---|---|
| `semantic-search` | `hooks/useSemanticSearch.ts` | **live** |
| `buyer-profile` | `pages/Buyers.tsx`, `pages/ContractsFinderBuyers.tsx` | **live** |
| `contracts-finder` | `lib/contractsFinder.ts` | **live** |
| `contracts-scotland` | `lib/contractsFinder.ts` | **live** |
| `find-a-tender` | `lib/contractsFinder.ts` | **live** |
| `sync-notices` | `pages/Admin.tsx` | ported, not exposed through the API (it is a worker) |
| `embed-tenders-batch` | `components/EmbeddingStatusCard.tsx` | ported, not exposed through the API (it is a worker) |
| `draft-bid-response` | `components/BidDraftPanel.tsx` | **never ported** |
| `daily-search-alerts` | `pages/SavedSearches.tsx` | **never ported** |
| `admin-create-user` | `pages/Admin.tsx` | **replaced by Cognito** — create users in the Cognito console for now |
| `ted-eu`, `sell2wales`, `etenders-ireland`, `etenders-ni` | `lib/contractsFinder.ts` (`searchAllSources`) | **never existed on Supabase either** — `searchAllSources` has always fired them into a `Promise.allSettled` that swallows the failure |

Each of these returns a clear named error rather than a 404, so a missing
function is reported as itself instead of as "search failed".

## HTTPS setup (Cloudflare DNS)

`api.bidintel.rplusai.co.uk` — a NEW hostname. **`bidintel.rplusai.co.uk` is not
touched**: that is the live Lovable site, and repointing it is a cutover step.

### Step 1 — validate the certificate

Add in Cloudflare, **DNS only (grey cloud)**:

| Type | Name | Value |
|---|---|---|
| CNAME | `_8b1f82d1ea772c10115b5883cc6f4fcb.api.bidintel` | `_d9eee77267a928cefa68beaff901a805.wzccmgtwzk.acm-validations.aws` |

**Why DNS-only is not optional here.** A proxied (orange cloud) record makes
Cloudflare answer with its own anycast IPs instead of the CNAME target. ACM
resolves the record and compares the value, finds Cloudflare's A records rather
than the `acm-validations.aws` target, and the certificate never leaves
`PENDING_VALIDATION`. Cloudflare will not proxy a `_`-prefixed record anyway, but
set it explicitly rather than relying on that.

Cloudflare appends the zone name, so enter the name **without** `.rplusai.co.uk`
— pasting the fully-qualified name usually yields
`…api.bidintel.rplusai.co.uk.rplusai.co.uk`. Cloudflare also strips a trailing
dot; leave it off.

ACM polls every few minutes. Verify with:

```bash
aws acm describe-certificate --profile bidintel-deploy --region eu-north-1 \
  --certificate-arn "$(cd aws-backend/infra/phase6-postgrest && terraform output -raw acm_certificate_arn)" \
  --query 'Certificate.Status'
```

Leave the validation record in place permanently — ACM re-checks it to renew
automatically. Deleting it after issuance means the certificate silently fails to
renew and the listener breaks in 13 months.

### Step 2 — the endpoint record, and the listener

| Type | Name | Value |
|---|---|---|
| CNAME | `api.bidintel` | `bidintel-postgrest-1007768748.eu-north-1.elb.amazonaws.com` |

**DNS only (grey cloud) here too, and this one is a real decision, not a
formality.** Proxying would work in the sense that requests arrive — but:

- **It breaks the IP allowlist.** Traffic would reach the ALB from Cloudflare's
  edge, so the security group would have to admit Cloudflare's published ranges
  instead of named testers. That is a large, shared, public IP set: the
  allowlist would stop meaning anything.
- **It puts a third party in the token path.** Proxied means Cloudflare
  terminates TLS, so every Cognito ID token is in plaintext at their edge. The
  entire point of this exercise is to stop tokens crossing anything in the clear.
- It buys nothing we need. Cloudflare's caching, WAF and DDoS protection are
  aimed at public sites; this is an authenticated JSON API for seven people.

DNS-only keeps the TLS session end-to-end between the browser and our ALB, with
our own ACM certificate, and keeps the security group meaningful.

Then:

```bash
cd aws-backend/infra/phase6-postgrest
terraform apply -var enable_https=true     # adds 443, turns 80 into a redirect
```

The two-stage flag exists because a listener referencing an unissued certificate
fails the apply, and issuance waits on a human editing DNS.

### CORS

Checked, not assumed: PostgREST **echoes** the browser's requested headers into
`Access-Control-Allow-Headers`, so `content-type`, `prefer`, `range` and
`accept-profile` are all allowed and writes and pagination work. Its default
`Access-Control-Allow-Origin: *` is safe here precisely because it holds no
ambient authority — no cookies, no session; every request must carry a bearer
token the caller obtained from Cognito, and the API Gateway side is separately
pinned to `http://localhost:8080`.

## Known interaction: excluded `write_attributes` vs `NEW_PASSWORD_REQUIRED`

**Worth knowing before touching either side, because the two look unrelated and
the error names neither of them.**

`custom:app_user_id` and `custom:org_id` are deliberately excluded from the SPA
client's `write_attributes`. That is a real security control, not tidiness: those
claims are what `auth.uid()` and the org-scoping RLS policies trust, so a user
able to write them could re-point their own identity at another user's rows.
They are readable, never writable.

The interaction: Cognito's `NEW_PASSWORD_REQUIRED` challenge hands the client the
user's **current** attributes — including those two. The obvious implementation
passes that object straight back to `completeNewPasswordChallenge`, and Cognito
rejects the whole call:

```
Input attributes include non-writable attributes for the client 4ua1vhje9gmm3kekuk6spvf1r
```

The account is fine, the password is correct, and the challenge is valid; only
the echo is wrong. The error text names no attribute, so it reads like a client
misconfiguration and invites "fix" by adding the attributes to
`write_attributes` — **which would remove the control entirely.**

**The fix belongs in the client.** Build the payload from the challenge's
`requiredAttributes` — the list Cognito says must be supplied — never from the
attributes it hands over. On this pool that list is empty: `email` is the only
required attribute (besides system-managed `sub`) and it is already set, being
the sign-in identifier. See `src/integrations/aws/cognito.ts`.

A partial fix is worse than none: an earlier version deleted `email` and
`email_verified` but missed the two `custom:` ones, which looked correct and
failed identically.

Regression cover: `./scripts/test-live-auth.sh` provisions a throwaway
`FORCE_CHANGE_PASSWORD` user, drives the real module through challenge →
completion → token, asserts `role` / `app_user_id` / `token_use` survive, and
deletes the user. It is the only test that can catch this class of bug — both
failures here were Cognito rejecting a request the client was perfectly happy to
construct, so neither typechecking nor any offline test would have seen them.
`npm test` skips it unless the env vars are set.

## Setting up a second tester (what Rajesh needs)

> **There is no shareable test URL.** Vercel deploys the `main` branch against
> Lovable Cloud, and previewing `aws-migration` there needs a Vercel Pro seat
> we do not have. Even with one it would not work yet: a Vercel preview is
> HTTPS, and browsers block an HTTPS page from calling the **HTTP** PostgREST
> ALB as mixed content. So **every tester runs the app locally** until the
> HTTPS decision lands. This is a consequence of that open decision, not a
> separate problem.

**1. Repo access.** Push access to `Rplus-analytics/Bidintel-uk`, then:

```bash
git clone https://github.com/Rplus-analytics/Bidintel-uk.git
cd Bidintel-uk
git checkout aws-migration          # NEVER test on main — that is Lovable
```

**2. Node 20 or newer.** `node -v`. Vite 5 and the build both assume it; the
repo has no `.nvmrc`, so this has to be checked by hand.

```bash
npm install                          # includes amazon-cognito-identity-js
```

**3. `.env.local`.** Copy `.env.example` — the values are already filled in and
none of them is a secret:

```
VITE_COGNITO_USER_POOL_ID=eu-north-1_9LKk8RR6t
VITE_COGNITO_CLIENT_ID=4ua1vhje9gmm3kekuk6spvf1r
VITE_COGNITO_REGION=eu-north-1
VITE_POSTGREST_URL=http://bidintel-postgrest-1007768748.eu-north-1.elb.amazonaws.com
VITE_API_BASE_URL=https://tye76qu0y9.execute-api.eu-north-1.amazonaws.com
```

**4. His IP on the security groups — the step that is easy to forget.**
API Gateway is open to the internet and protected by the Cognito authorizer, so
sign-in and search work from anywhere. **PostgREST does not**: the ALB admits a
short allowlist of addresses, because the listener is plain HTTP and carries ID
tokens in cleartext.

The symptom if this is missed is misleading: **sign-in succeeds, then every page
is empty and nothing errors visibly** — the ALB simply never answers.

Someone with the `bidintel-deploy` profile runs, from the repo:

```bash
./scripts/allow-ip.sh rajesh 203.0.113.7     # his public IP
./scripts/allow-ip.sh --list                 # confirm
```

He can find his IP at `curl https://checkip.amazonaws.com`. This opens **both**
`tcp/5432` on the RDS security group and `tcp/80` on the ALB security group.
Home broadband addresses change, so expect to re-run it; rules are tagged
`bidintel-access:<label>` and only same-label rules are replaced, so updating
one person never disconnects another.

```bash
npm run dev                          # http://localhost:8080
```

First sign-in shows a "choose a new password" screen. That is the expected
`FORCE_CHANGE_PASSWORD` flow, not an error.

## Test checklist — AWS vs Lovable, side by side

Open the same page in both and compare. **A page that renders but shows no data
is the signature of an auth problem, not a data problem** — RLS removes rows, it
does not raise.

### Auth
- [ ] Sign in with a wrong password → "Incorrect email or password"
- [ ] Sign in with an unknown email → **the same message** (deliberate: the pool has `PreventUserExistenceErrors` on, so the two must be indistinguishable or it leaks which accounts exist)
- [ ] First sign-in → "choose a new password" screen appears
- [ ] New password below policy (12 chars, upper, lower, number) → rejected with the reason
- [ ] Mismatched confirmation → "Passwords do not match", no network call
- [ ] Successful sign-in → lands on the dashboard, org name shown in the header
- [ ] **Refresh the page → still signed in** (session restored from localStorage)
- [ ] **Leave the tab open for over an hour, then act** → still works (ID token is 60 min; the refresh token is 30 days and the exchange is transparent)
- [ ] Sign out → returns to `/auth`, and a refresh does not restore the session
- [ ] Visit a protected route while signed out → redirected to `/auth`

### Pages
- [ ] `/` Dashboard — counts and recent tenders
- [ ] `/contracts` Contracts
- [ ] `/open-bids` Open bids, and `/open-bids/:id` detail
- [ ] `/pipeline` Bid pipeline
- [ ] `/expiring` Expiring contracts
- [ ] `/analytics` Analytics charts
- [ ] `/buyers` Buyers — **click a buyer to generate a profile** (exercises `buyer-profile` on OpenAI; expect a description and an org chart)
- [ ] `/suppliers` Suppliers
- [ ] `/saved-searches` — **the per-user table.** You should see only your own
- [ ] `/conferences`, `/speakers`, `/speakers/:slug`
- [ ] `/frameworks` Frameworks
- [ ] `/contracts-finder` — live Contracts Finder search
- [ ] `/contracts-finder-buyers`
- [ ] `/settings`
- [ ] `/admin` — visible only to org admins

### Search
- [ ] Semantic search returns relevant results, not just keyword matches
- [ ] A query with no matches returns an empty state, not an error
- [ ] Search on Lovable and on AWS for the same term — **ordering should be very close**; the embeddings are identical vectors (same `text-embedding-3-small` model), so large differences mean something is wrong

### Known differences — expected, not bugs
- [ ] "Create user" in `/admin` fails — `admin-create-user` is replaced by Cognito
- [ ] Bid drafting fails — `draft-bid-response` not ported
- [ ] "Send alerts" on saved searches fails — `daily-search-alerts` not ported
- [ ] "All sources" search returns fewer sources — TED, Sell2Wales, eTenders IE/NI never existed
- [ ] **Data is a point-in-time copy from 11 Sep and is not updating** — see below

## ⚠️ The daily ingesters look back only 24 HOURS

`ingest-cf` and `ingest-fts` both compute their window as:

```ts
const from = new Date(today.getTime() - 24 * 60 * 60 * 1000);
```

A fixed one-day window, with no cursor and no memory of the last successful run.

**Any outage longer than a day leaves a permanent hole.** Miss three days and
those three days are never fetched — the next run asks only for the last 24
hours, succeeds, reports success, and the gap stays. Nothing alarms, because
from the worker's point of view nothing failed.

**This is exactly the 8 September failure mode**, and it is why that gap does not
self-heal. It will recur on the next outage of more than a day unless something
changes.

### Recommendation

Make the window derive from the data rather than from the clock:

```ts
// Start from the newest row we actually hold, minus a safety overlap, and
// clamp so a long outage cannot ask for an unbounded range in one go.
const newest = await db.from("tenders").select("published_at")
  .order("published_at", { ascending: false }).limit(1).maybeSingle();
const since = newest?.published_at
  ? new Date(Date.parse(newest.published_at) - 48 * 3600_000)  // 48h overlap
  : new Date(Date.now() - 7 * 86400_000);
const from = new Date(Math.max(since.getTime(), Date.now() - 30 * 86400_000));
```

Three properties worth having, none of which the current code has:

- **Self-healing.** After any outage the next run asks for everything missed.
- **Overlapping.** A 48-hour overlap costs a few re-upserts (both feeds are
  idempotent on `ocid` / `notice_identifier`) and absorbs upstream publishers
  backdating a notice, which they do.
- **Bounded.** The 30-day clamp stops a month-long outage turning the first
  recovery run into a full-table scrape that times out — it walks back instead.

Not applied yet: it changes ingestion behaviour, and the priority was to get the
existing logic running unmodified first so any difference is attributable. Worth
doing before the schedules are enabled for real.

## Ingestion adapter — BUILT (25 Sep), not yet deployed

`_shared/db.ts` is no longer a stub. `_shared/sql-builder.ts` translates the
PostgREST-shaped calls the sixteen workers already make into SQL over `pg`, so
every call site stays byte-identical and only the transport changes.

Scope is deliberately closed — what the workers actually call, measured by
grepping them: `select insert upsert update delete`, `eq neq in gte lte gt lt or
not match`, `order range limit single maybeSingle`, and
`select("*", {count:"exact", head:true})`. An unsupported operator throws **by
name**; that matters more than completeness, because a filter silently dropped
turns "update this one row" into "update every row".

All 19 worker functions typecheck against it. `aws-backend/test/adapter-live.ts`
runs 20 assertions against the real database: **20 passed, 0 failed.**

### Three things the live test caught that nothing else would have

1. **All 14 trigger functions were un-executable by `bidintel_app`.** The
   blanket `REVOKE EXECUTE ... FROM PUBLIC` in `05-grants.sql` left
   `tenders_search_tsv_update`, `tenders_set_derived_status`,
   `buyers_set_canonical`, `set_updated_at` and ten others unreachable, so
   **every** worker INSERT or UPDATE would have failed at the trigger, on every
   table that matters. Masked until now because `embed-tenders-batch` had only
   ever run on the RDS master credentials, which are superuser. This is the
   second time that revoke has bitten — pgvector was the first.
2. **`.eq()` threw synchronously out of the chain.** Call sites destructure
   `{ data, error }` and never wrap in try/catch, so a bad identifier would have
   escaped as an unhandled exception rather than the error they check. Builder
   failures are now recorded and returned through the normal channel.
3. **`ignoreDuplicates` is not cosmetic.** `sync-notices` upserts buyers with
   `ignoreDuplicates: true`, which is `DO NOTHING` — an existing row is left
   alone. The default is `DO UPDATE`, which would let a later, thinner record
   clobber a richer one.

### Still to do before it ingests

- Deploy the workers (a phase-7 Terraform stack) with `DATABASE_SECRET_ARN`
  pointing at `bidintel/worker-db`, on EventBridge schedules.
- **Switch `embed-tenders-batch` off the RDS master credentials** — it is the
  last thing holding them, and the masking above is exactly why that matters.
- Monitoring, so a silent stop cannot recur. See below.

## Cutover comparison: AWS will hold MORE than Lovable, and that is correct

Once AWS backfills 8–24 Sep, it holds a window Lovable never ingested. **Row
counts will not match, and requiring them to match would be requiring AWS to
reproduce Lovable's outage.**

So `count(*)` is the wrong check. It was only ever a proxy for "did the copy
work", and it stops being one the moment the two systems diverge legitimately.

### What to check instead

**1. Containment, not equality.** Every tender Lovable holds must exist on AWS.
The reverse is expected to fail, and that is the point.

```sql
-- Run on AWS. Should be 0. Compare against a list of Lovable ocids.
SELECT count(*) FROM lovable_ocids l
WHERE NOT EXISTS (SELECT 1 FROM tenders t WHERE t.ocid = l.ocid);
```

**2. Agreement on the shared window.** Restrict both sides to
`published_at <= 2026-09-07`, where the two systems should be identical, and
compare counts there. A mismatch inside that window is a real migration defect;
a difference after it is the backfill working.

```sql
SELECT count(*), min(published_at), max(published_at)
FROM tenders WHERE published_at <= '2026-09-07';
```

**3. Per-row fidelity on a sample.** Pick ~200 ocids spanning the whole range and
compare the fields the app actually renders — title, buyer, value, deadline,
CPV, status. Counts matching while a field is silently null everywhere is a
failure mode counts cannot see.

**4. The application, not the database.** Same search on both, same filters,
compare the top 20. The point of the migration is that the app behaves the same,
and search ranking depends on embeddings, `search_tsv` and the HNSW index, none
of which a row count exercises.

**5. Explain the surplus, do not just accept it.** Every AWS row with
`published_at > 2026-09-07` should be attributable to the backfill of a known
window. A surplus outside 8–24 Sep means something ingested more than intended —
duplicates from an overlapping cursor, say — and that is worth catching before
cutover rather than after.

## Closing the 8 Sep gap: the backfill workers CANNOT do it

Asked whether `backfill-tick` and `backfill-source-tick` can close 8 Sep → now
from the `backfill_state` cursor: **no, not as they stand.**

`backfill-tick` selects `.eq("completed", false)` and excludes `%_full`. Every
recent source is parked at `completed = true`, because `isCurrentOrFuture()`
marks a source complete once its cursor reaches the current month. Only two rows
are live — `raw_cf` (at 2015-01) and `ccs_digital_outcomes` — and both are
walking deep history, not the present.

What each ingester would actually do if switched on today:

| Worker | Window | Closes 8–25 Sep? |
|---|---|---|
| `sync-notices` | **6 months** | **Yes** — one run covers it, for every source it fans out to |
| `ingest-cf-native` | 7-day cursor from `cursor_date` (2026-09-03), `completed=true` | Only after `completed=false`; then ~3 ticks |
| `ingest-cf` | **fixed 24 hours** | **No** — picks up from today only |
| `ingest-fts` | **fixed 24 hours** | **No** — picks up from today only |
| `backfill-tick` | skips completed rows | **No** |

So the gap does **not** self-heal. `ingest-cf` and `ingest-fts` would leave
8–24 Sep permanently missing. To close it deliberately:

```sql
-- Re-walk September for the forward-walking sources.
UPDATE backfill_state SET completed = false, year = 2026, month0 = 8, lock_until = NULL
WHERE source IN ('cf', 'fts', 'cf_native');
```

then let `backfill-tick` run. Rough cost: one month per source per tick, three
sources, plus `sync-notices` covering the rest in a single pass — on a 5-minute
schedule that is **under an hour** of wall clock, dominated by upstream API
paging rather than by the database. Embedding the new rows adds roughly a minute
per 500 tenders at the batch size used.

Worth doing this **before** cutover rather than after, so the comparison against
Lovable is like-for-like.

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
| **Sign-in rejected the emailed temporary password** | **Diagnosed 15 Sep; invitation resent.** Not a config fault. CloudTrail's `RespondToAuthChallenge` event (`PASSWORD_VERIFIER` step) showed `NotAuthorizedException: Incorrect username or password`, with `additionalEventData.sub` present — so the user resolved correctly and only the password was rejected. Verified independently that SRP + a temporary password + `FORCE_CHANGE_PASSWORD` works on this pool and that `newPasswordRequired` fires as the frontend expects, by creating a throwaway user with a known temporary password and running the frontend's exact code path. Pool config, client flows, `.env.local` and username handling were all confirmed correct, so the emailed value itself was the only remaining variable. A fresh invitation was sent (the previous temporary password is now invalid). Two contributing frontend weaknesses fixed: an expired temporary password was being reported as "Incorrect email or password", and a pasted password was not trimmed |
| **New-password screen rejected the challenge** | **FIXED.** `completeNewPasswordChallenge` was echoing the challenge's attributes back, including the two non-writable custom claims → "Input attributes include non-writable attributes". Fixed in the client, NOT by loosening `write_attributes`. See "Known interaction" above |
| **Blank page at localhost:8080** | **FIXED 15 Sep.** `amazon-cognito-identity-js` depends on `buffer@4.9.2`, a Node shim that references the bare identifier `global`, which browsers do not have. It threw `ReferenceError: global is not defined` at import time; because the auth layer is imported near the root of the module graph, React never mounted and the page rendered blank with nothing in the UI to indicate why. Fixed with `define: { global: "globalThis" }` in `vite.config.ts`. Confirmed in headless Chrome: no exceptions, `/auth` renders the sign-in form |
| **No shareable test URL** | Vercel deploys `main` against Lovable; previewing `aws-migration` needs a Pro seat, and an HTTPS preview cannot call the HTTP ALB anyway. Every tester must run locally — see "Setting up a second tester" |
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
