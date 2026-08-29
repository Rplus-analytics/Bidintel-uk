# BidIntel — Supabase → AWS Migration Status (Read-Only Reconciliation)

**Date:** 2026-08-10  
**Mode:** Assessment only. No infrastructure, database, schema, code, or deployment configuration was modified.

Evidence classes used throughout: `VERIFIED FROM AWS`, `VERIFIED FROM CODE`, `VERIFIED FROM DATABASE` (source Supabase/Lovable Cloud DB), `HISTORICAL MIGRATION EVIDENCE`, `INFERRED`, `NOT VERIFIED`.

---

## 1. Executive Summary

**The AWS side of this migration could not be verified at all from this environment.**

- No AWS credentials are configured for this project/sandbox. `aws sts get-caller-identity` returns *"Unable to locate credentials"*; there is no `~/.aws` config, no `AWS_REGION`, and no project AWS access keys. (The only AWS-shaped environment values present belong to the Lovable platform's internal asset storage and are explicitly out of scope — they are not this project's AWS account and were not used.) → `VERIFIED FROM CODE/ENV`
- The repository contains **zero AWS migration artefacts**: no Terraform, CDK, CloudFormation, SAM, serverless config, Dockerfile, `aws-sdk`/`@aws-sdk` dependency, RDS connection config, Lambda handler, migration/import script, schema dump, or documentation from the other team member. → `VERIFIED FROM CODE`
- Therefore every AWS-side item in this report — RDS instance, tables, row counts, extensions, RPCs, RLS, services — is **NOT VERIFIED**. Nothing can be marked MATCHED, PARTIAL, or MISSING with evidence.
- What *was* verified is the **source of truth side**: the live Supabase/Lovable Cloud database (schema, row counts, extensions, functions, vector columns, RLS policies) and the complete Edge Function inventory from the repository. That gives a precise, current migration target specification.
- **Assessed stage: STAGE 0 — Assessment only**, from the evidence available to this environment. If the other team member has provisioned AWS resources, that work is invisible to this repository and this sandbox and must be handed over before Edge Function migration can start.

---

## 2. Previous Migration Evidence (HISTORICAL — not re-verified)

Reported minimal production table set: `tenders, notices, awards, award_suppliers, suppliers, buyers, cpv_codes, saved_bids, saved_searches, org_match_profiles, organisations, memberships, profiles, org_name_aliases`.

Reported key DB dependencies: `search_tenders_hybrid`, `pgvector`, `pg_trgm`, `current_org_id()`, `is_org_admin()`.

CSV exports were previously generated (in a prior session, into `/mnt/documents/exports/`). Those export files are **not present in the repository** and were not re-verified here. → `HISTORICAL MIGRATION EVIDENCE`

---

## 3. Current AWS Infrastructure

| Item | Status | Evidence |
|---|---|---|
| AWS credentials | **NOT AVAILABLE** | `aws sts get-caller-identity` → "Unable to locate credentials"; no `~/.aws` |
| AWS region | **NOT VERIFIED** | `AWS_REGION` / `AWS_DEFAULT_REGION` unset for this project |
| AWS RDS configuration in repo | **NOT FOUND** | no connection string, no `RDS`/`rds.amazonaws.com` reference anywhere in source |
| PostgreSQL (AWS) connectivity | **NOT VERIFIED** | the only reachable DB is Supabase (`PGHOST` resolves to a Supabase host) |
| IaC (Terraform / CDK / CloudFormation / SAM / Serverless) | **NOT FOUND** | repo scan |
| Migration / import / DDL / dump scripts | **NOT FOUND** | only `scripts/compute-buyer-totals.ts` exists (Supabase-based) |
| Handover documentation | **NOT FOUND** | `docs/` did not exist prior to this report |

**Reason connectivity could not be established:** no AWS credentials and no AWS endpoint are provided to this environment. This is an environment/handover gap, not a technical failure. Credentials must be supplied through the platform's secret store (never pasted into source).

---

## 4. AWS PostgreSQL Status

```
AWS PostgreSQL
--------------
Instance:      NOT VERIFIED
Engine:        NOT VERIFIED
Version:       NOT VERIFIED
Database:      NOT VERIFIED
Schemas:       NOT VERIFIED
Extensions:    NOT VERIFIED
Connectivity:  NOT VERIFIED
```

### Source (Supabase) baseline — `VERIFIED FROM DATABASE`

```
Engine:      PostgreSQL (Supabase managed)
Schema:      public (plus auth, storage, cron, vault, extensions)
Extensions:  pg_cron 1.6.4, pg_net 0.20.0, pg_stat_statements 1.11,
             pg_trgm 1.6, pgcrypto 1.3, plpgsql 1.0,
             supabase_vault 0.3.1, uuid-ossp 1.1, vector 0.8.0
```

---

## 5. Table Migration Status

AWS column is `UNKNOWN` for every row — no AWS connection was possible.

| Table | Expected | AWS Exists | Schema Match | AWS Row Count | Status |
|---|---|---|---|---|---|
| tenders | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| notices | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| awards | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| award_suppliers | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| suppliers | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| buyers | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| cpv_codes | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| saved_bids | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| saved_searches | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| org_match_profiles | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| organisations | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| memberships | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| profiles | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |
| org_name_aliases | Yes | UNKNOWN | UNKNOWN | UNKNOWN | **UNKNOWN** |

---

## 6. Data Migration Status — historical export vs. **current source** counts

Important: the source database is **live and still ingesting**. Current source counts already exceed the historical export counts, so the CSVs handed to the AWS team are a stale snapshot even if they imported cleanly.

| Table | Historical export | Current source (Supabase) | Drift since export | AWS | Difference |
|---|---:|---:|---:|---|---|
| tenders | 19,056 | **19,874** | +818 | UNKNOWN | NOT VERIFIED |
| notices | 19,323 | **20,136** | +813 | UNKNOWN | NOT VERIFIED |
| awards | 14,188 | **14,671** | +483 | UNKNOWN | NOT VERIFIED |
| award_suppliers | 20,076 | **20,478** | +402 | UNKNOWN | NOT VERIFIED |
| suppliers | 13,062 | **13,326** | +264 | UNKNOWN | NOT VERIFIED |
| buyers | 3,237 | **3,273** | +36 | UNKNOWN | NOT VERIFIED |
| cpv_codes | 9,454 | **9,454** | 0 | UNKNOWN | NOT VERIFIED |
| saved_bids | 3 | **3** | 0 | UNKNOWN | NOT VERIFIED |
| saved_searches | 7 | **7** | 0 | UNKNOWN | NOT VERIFIED |
| profiles | 7 | **7** | 0 | UNKNOWN | NOT VERIFIED |
| memberships | 6 | **6** | 0 | UNKNOWN | NOT VERIFIED |
| organisations | 1 | **1** | 0 | UNKNOWN | NOT VERIFIED |
| org_match_profiles | 1 | **1** | 0 | UNKNOWN | NOT VERIFIED |
| org_name_aliases | 6 | **6** | 0 | UNKNOWN | NOT VERIFIED |
| tenders_pcs | 34,067 | **34,978** | +911 | UNKNOWN | NOT VERIFIED |
| tenders_ccs | 554 | **560** | +6 | UNKNOWN | NOT VERIFIED |
| ingest_runs | 288,598 | **315,194** | +26,596 | UNKNOWN | NOT VERIFIED |
| backfill_state | 16 | **16** | 0 | UNKNOWN | NOT VERIFIED |
| raw_contracts_finder | ~625,453 | not re-counted (2.3 GB, count times out) | NOT VERIFIED | UNKNOWN | NOT VERIFIED |

Source counts: `VERIFIED FROM DATABASE` (2026-08-10). Discrepancies are reported, not reconciled.

---

## 7. PostgreSQL Functions / RPC Status

| Function / RPC | Source (Supabase) | AWS | Dependencies | Status |
|---|---|---|---|---|
| `search_tenders_hybrid` — **4 overloads** (5-arg, 10-arg, 13-arg, 14-arg) | EXISTS | UNKNOWN | `tenders` (+`embedding vector(1536)`, `search_tsv`), `vector`, `pg_trgm`; NOT security-definer | NOT VERIFIED |
| `current_org_id()` | EXISTS, **SECURITY DEFINER** | UNKNOWN | `memberships`, `auth.uid()` | NOT VERIFIED |
| `is_org_admin()` | EXISTS, **SECURITY DEFINER** | UNKNOWN | `memberships`, `auth.uid()` | NOT VERIFIED |
| `handle_new_user()` | EXISTS, SECURITY DEFINER trigger | UNKNOWN | `auth.users` trigger, `profiles` | NOT VERIFIED |
| `canonicalize_org_name(text)` / `normalize_org_name(text)` | EXISTS | UNKNOWN | pure SQL; used by canonical-name triggers on tenders/awards/buyers/suppliers/OCDS | NOT VERIFIED |
| `compute_derived_status(...)` + `notices_set_derived_status()` trigger | EXISTS | UNKNOWN | pure SQL/trigger | NOT VERIFIED |
| `backfill_status_all / _cs / _fts / _notices / _ted` | EXISTS (SECURITY DEFINER) | UNKNOWN | tenders, notices | NOT VERIFIED |
| `refresh_tenders_cf_full_mat()` | EXISTS (SECURITY DEFINER) | UNKNOWN | materialized view | NOT VERIFIED |
| Views `v_status_coverage`, `v_status_coverage_by_source` | EXISTS | UNKNOWN | used by `backfill-status` | NOT VERIFIED |

**Critical note:** `search_tenders_hybrid` exists in **four overloads**. Any AWS port must recreate the exact signature the `semantic-search` function calls (the 14-arg variant with `core_terms`, `context_terms`, `active_only`, `intent_domain`), or the RPC call fails. → `VERIFIED FROM DATABASE` + `VERIFIED FROM CODE`

---

## 8. Extensions / Vector Search Status

| Extension | Required | Source installed | AWS installed | Status |
|---|---|---|---|---|
| `vector` (pgvector) | Yes — hybrid search, embeddings | **0.8.0** | UNKNOWN | NOT VERIFIED |
| `pg_trgm` | Yes — fuzzy/keyword scoring | **1.6** | UNKNOWN | NOT VERIFIED |
| `pgcrypto` | Yes — `gen_random_uuid()` defaults | 1.3 | UNKNOWN | NOT VERIFIED |
| `uuid-ossp` | Likely | 1.1 | UNKNOWN | NOT VERIFIED |
| `pg_cron` | Yes — all scheduled ingest/alert jobs | 1.6.4 | UNKNOWN | NOT VERIFIED (RDS supports it; must be enabled via parameter group) |
| `pg_net` | Yes — cron jobs call Edge Functions over HTTP | 0.20.0 | UNKNOWN | **NOT AVAILABLE ON RDS** — must be replaced by EventBridge → Lambda |
| `pg_stat_statements` | Optional | 1.11 | UNKNOWN | NOT VERIFIED |
| `supabase_vault` | Supabase-only | 0.3.1 | N/A | Replace with Secrets Manager |

### Vector search — actual implementation (`VERIFIED FROM DATABASE`)

Embeddings are stored as **columns**, not in separate `embeddings` / `tender_embeddings` / `search_index` tables (confirms the prior audit):

| Table | Column | Type | Dimensions |
|---|---|---|---|
| `tenders` | `embedding` | `vector` | **1536** |
| `tenders_pcs` | `embedding` | `vector` | 1536 |
| `tenders_fts` | `embedding` | `vector` | 1536 |
| `companies` | `embedding` | `vector` | 1536 |
| `notices` | `embedding` | **`jsonb`** (legacy, not a vector column) | n/a |

Vector index: **`tenders_embedding_hnsw_idx`** (HNSW) on `tenders.embedding`. No IVFFlat index found. Full index-list enumeration timed out on one query, so the presence of *additional* trigram/tsvector indexes is `NOT VERIFIED` in this pass — but `tenders.search_tsv` and `tenders_fts.search_tsv` tsvector columns exist and are used by the RPC.

Embedding pipeline: `embed-tenders-batch` uses **`openai/text-embedding-3-small` via the Lovable AI Gateway** (1536 dims) and drives `tenders.embedding_status / embedding_attempts / embedded_at / embedding_error`. The older `generate-tender-embedding` uses Voyage `voyage-large-2` with OpenAI `text-embedding-3-large` fallback — **dimension-incompatible with the 1536 column** and appears to be legacy. → `VERIFIED FROM CODE`

---

## 9. RLS / Auth Migration Status

```
AUTH MIGRATION STATUS
---------------------
Supabase auth dependency:  HEAVY — auth.uid() is referenced by 25 RLS policies
                           across 8 tables, plus two SECURITY DEFINER helpers.
AWS replacement:           NOT VERIFIED — no evidence of any JWT/session-GUC
                           replacement in the repository.
RLS migration:             NOT VERIFIED
Blocking Edge Functions:   All user-scoped functions (see matrix, §11)
```

Tables whose RLS depends on `auth.uid()` / `current_org_id()` / `is_org_admin()` (`VERIFIED FROM DATABASE`):
`organisations` (2), `profiles` (4), `memberships` (4), `saved_bids` (4), `org_match_profiles` (4), `saved_searches` (4), `companies` (1), `matches` (1), `user_actions` (1).

Everything else (`tenders`, `notices`, `awards`, `suppliers`, `buyers`, `cpv_codes`, `org_name_aliases`, OCDS mirrors) is **public-read, write-denied** — those tables carry no auth dependency and are the easy part of the migration.

The frontend still authenticates entirely through Supabase Auth (`src/integrations/supabase/client.ts`, `AuthContext`, `ProtectedRoute`), and the MCP server issues OAuth via Supabase (`src/pages/OAuthConsent.tsx`, `supabase/functions/mcp`). On RDS there is no `auth.uid()`; the standard replacement is a per-connection GUC (`set_config('request.jwt.claims', ...)`) plus a `current_setting()`-based `auth_uid()` shim, or moving authorization into the application/Lambda layer. **No such replacement exists today.** → `VERIFIED FROM CODE`

---

## 10. Edge Function Inventory (30 functions, `VERIFIED FROM CODE`)

Triggers: `HTTP` = invoked by the app; `CRON` = scheduled (cron schedules live in `pg_cron`, which this role cannot read — schedules are `NOT VERIFIED`); `ADMIN` = manual/ops.

| # | Function | Trigger | Reads | Writes | RPCs | External APIs | Supabase deps | AWS readiness |
|---|---|---|---|---|---|---|---|---|
| 1 | `semantic-search` | HTTP | tenders (via RPC) | — | `search_tenders_hybrid` | Lovable AI Gateway (embeddings) | service-role client, RPC | Medium |
| 2 | `daily-search-alerts` | CRON | saved_searches, tenders | ingest_runs | — | Resend, contractsfinder | service role, `auth.getUser` | Medium |
| 3 | `embed-tenders-batch` | CRON | tenders | tenders | — | Lovable AI Gateway | service role | **Low (easiest)** |
| 4 | `generate-tender-embedding` | HTTP | tenders | tenders | — | Voyage, OpenAI | service role | Low (legacy, dim mismatch) |
| 5 | `ingest-cf` | CRON | — | tenders, ingest_runs | — | Contracts Finder | service role, `INGEST_SECRET` | Medium |
| 6 | `ingest-cf-native` | CRON | — | raw_cf_native, ingest_runs, backfill_state | — | Contracts Finder | service role | Medium |
| 7 | `ingest-cf-bulk` | CRON | — | cf_bulk_upload, ingest_runs | — | CKAN, Contracts Finder | service role | Medium |
| 8 | `ingest-fts` | CRON | — | tenders, ingest_runs | — | Find a Tender | service role | Medium |
| 9 | `ingest-contracts-scotland` | CRON | — | tenders, ingest_runs | — | PCS, r.jina.ai | service role | Medium |
| 10 | `ingest-source-full` | ADMIN | — | tenders_fts, tenders_pcs, tenders_ted | — | FTS, PCS, TED | service role | Medium |
| 11 | `ingest-trigger` | ADMIN | — | — | — | fan-out to other functions | `auth.getUser`, admin role check | Medium |
| 12 | `normalize-raw-cf` | CRON | raw_contracts_finder | tenders, ingest_runs, backfill_state | — | Contracts Finder | service role | Medium |
| 13 | `scrape-ccs-digital-outcomes` | CRON | — | raw_ccs_digital_outcomes, tenders_ccs, tenders, ingest_runs | — | CCS redirect service | service role | Medium |
| 14 | `scrape-cf-notice` | HTTP | — | — | — | Contracts Finder (HTML scrape) | **none** | **Very low** |
| 15 | `contracts-finder` | HTTP | — | — | — | Contracts Finder API | **none** | **Very low** |
| 16 | `contracts-scotland` | HTTP | — | — | — | PCS API | **none** | **Very low** |
| 17 | `find-a-tender` | HTTP | — | — | — | FTS OCDS API | **none** | **Very low** |
| 18 | `buyer-profile` | HTTP | — | — | — | Lovable AI Gateway, LinkedIn | none (AI key only) | Low |
| 19 | `draft-bid-response` | HTTP | saved_bids | — | — | Lovable AI Gateway | anon client + user JWT, RLS | High (auth) |
| 20 | `admin-create-user` | ADMIN | profiles, memberships | profiles, memberships | — | — | **`auth.admin` API** | High |
| 21 | `bootstrap-org` | HTTP | organisations, memberships | organisations, memberships | — | — | `auth.getUser` | High |
| 22 | `mcp` | HTTP (OAuth) | tenders, awards, saved_bids, saved_searches | — | — | — | **Supabase OAuth + RLS** | High |
| 23 | `sync-notices` | CRON | — | notices, buyers, notices_sync_log | — | — | service role | Medium |
| 24 | `backfill-status` | ADMIN | v_status_coverage(_by_source) | — | `backfill_status_cs/_fts/_notices/_ted` | — | service role, 4 RPCs | Medium |
| 25 | `backfill-tick` | CRON | backfill_state | tenders | — | TED, CF, FTS, Sell2Wales, eu-supply | service role | Medium |
| 26 | `backfill-source-tick` | CRON | backfill_state | raw_fts, raw_ted | — | TED, PCS, FTS, r.jina.ai | service role | Medium |
| 27 | `backfill-raw-cf` | CRON | backfill_state | raw_contracts_finder, ingest_runs | — | Contracts Finder | service role | Medium |
| 28 | `backfill-cf-bulk-tick` | CRON | backfill_state | cf_bulk_upload, ingest_runs | — | — | service role | Medium |
| 29 | `backfill-linked-tables` | ADMIN | tenders | buyers, tender_lots, tender_cpv, tender_documents, awards, suppliers, award_suppliers | — | — | service role, **auth disabled (TEMP)** | Medium |
| 30 | `_shared` (`ocds-linked.ts`, `notices-mirror.ts`, `s2w-style.ts`) | library | — | — | — | — | shared by ingest functions | port once |

`supabase/config.toml` sets `verify_jwt = false` for 10 functions; the rest rely on platform JWT verification. → `VERIFIED FROM CODE`

---

## 11. Edge Function → AWS Database Dependency Matrix

| Edge Function | AWS DB Ready? | Required tables | Required RPCs | Required extensions | Auth dep | External dep | Blocker |
|---|---|---|---|---|---|---|---|
| `contracts-finder` | **N/A (no DB)** | none | none | none | none | CF API | **None** — pure proxy |
| `find-a-tender` | **N/A (no DB)** | none | none | none | none | FTS API | **None** — pure proxy |
| `contracts-scotland` | **N/A (no DB)** | none | none | none | none | PCS API | **None** — pure proxy |
| `scrape-cf-notice` | **N/A (no DB)** | none | none | none | none | CF HTML | **None** — pure proxy |
| `buyer-profile` | N/A | none | none | none | none | AI Gateway | AI key in Secrets Manager |
| `embed-tenders-batch` | UNKNOWN | tenders (+`embedding vector(1536)`, `embedding_status`) | none | **pgvector** | service role only | AI Gateway | AWS `tenders` + pgvector unverified |
| `generate-tender-embedding` | UNKNOWN | tenders | none | pgvector | service role | Voyage/OpenAI | Legacy; 3072-dim mismatch |
| `semantic-search` | UNKNOWN | tenders (embedding, search_tsv) | **`search_tenders_hybrid` (14-arg)** | **pgvector + pg_trgm** | service role | AI Gateway | RPC + HNSW index + extensions unverified on AWS |
| `sync-notices` | UNKNOWN | notices, buyers, notices_sync_log | none | pgcrypto | service role | — | `notices_sync_log` not in minimal set |
| `ingest-cf` / `ingest-fts` / `ingest-contracts-scotland` | UNKNOWN | tenders, ingest_runs | none | pgcrypto | service role | source APIs | Canonical-name + derived-status **triggers** must exist on AWS |
| `ingest-cf-native` / `ingest-cf-bulk` / `backfill-*` / `normalize-raw-cf` | UNKNOWN | raw_*, cf_bulk_upload, backfill_state, ingest_runs, tenders | none | — | service role | source APIs | Pipeline tables outside minimal set |
| `scrape-ccs-digital-outcomes` | UNKNOWN | raw_ccs_digital_outcomes, tenders_ccs, tenders, ingest_runs | none | — | service role | CCS | `raw_ccs_digital_outcomes` not in minimal set |
| `backfill-status` | UNKNOWN | v_status_coverage views | 4 backfill RPCs | — | service role | — | Views + 4 SECURITY DEFINER functions |
| `backfill-linked-tables` | UNKNOWN | tenders → 7 linked tables | none | — | **none (temporarily disabled)** | — | Auth hole; FKs must exist |
| `daily-search-alerts` | UNKNOWN | saved_searches, tenders, ingest_runs | none | pgvector (semantic path) | service role + user context | Resend | Depends on semantic pipeline + `idx_tenders_deadline_published` |
| `draft-bid-response` | UNKNOWN | saved_bids | none | — | **user JWT + RLS** | AI Gateway | **auth.uid() replacement** |
| `bootstrap-org` | UNKNOWN | organisations, memberships | none | — | **auth.getUser** | — | **Supabase Auth** |
| `admin-create-user` | UNKNOWN | profiles, memberships | none | — | **auth.admin API** | — | **Supabase Auth admin API — no AWS equivalent yet** |
| `mcp` | UNKNOWN | tenders, awards, saved_bids, saved_searches | none | — | **Supabase OAuth + RLS** | — | **OAuth server + RLS** |

Chain for the flagship path:
```
semantic-search → search_tenders_hybrid (14-arg) → tenders.embedding vector(1536)
                                                 + tenders.search_tsv
                                                 + tenders_embedding_hnsw_idx
                                                 → pgvector 0.8.0 + pg_trgm 1.6
                                                 → AWS PostgreSQL  [NOT VERIFIED]
```

---

## 12. AWS Service Readiness

| Service | Status | Evidence |
|---|---|---|
| RDS PostgreSQL | **NOT VERIFIED** | no credentials, no endpoint, no repo config |
| Lambda | **NOT VERIFIED** | no handlers, no IaC, no deployment config |
| API Gateway | **NOT VERIFIED** | — |
| EventBridge | **NOT VERIFIED** | — (currently `pg_cron` + `pg_net`) |
| SQS | **NOT VERIFIED** | — |
| Secrets Manager | **NOT VERIFIED** | secrets currently in Supabase function env |
| CloudWatch | **NOT VERIFIED** | — |
| IAM roles | **NOT VERIFIED** | — |
| VPC / security groups | **NOT VERIFIED** | — |

---

## 13. Migration Stage

**STAGE 0 — Assessment only** (from the evidence available here).

Evidence:
- No AWS credentials, endpoint, or region reachable from this environment.
- No IaC, deployment, migration, DDL, or import artefact in the repository.
- No Lambda handler, no `@aws-sdk` dependency, no AWS connection configuration.
- The application is 100% Supabase-wired: `src/integrations/supabase/client.ts`, 30 Supabase Edge Functions, 100+ SQL migrations under `supabase/migrations/`, Supabase Auth throughout.
- The prior work product is CSV exports + an audit document — both assessment/extraction artefacts, not migrated infrastructure.

**Caveat:** if the other team member created RDS resources in an AWS account outside this repository and sandbox, the true stage could be as high as STAGE 3. That cannot be confirmed or denied here → the stage above is `INFERRED` from absence of evidence, and the AWS side remains `NOT VERIFIED`.

---

## 14. Blockers

1. **No AWS access from this environment** — nothing on the AWS side can be verified, so no Edge Function migration can be validated. *(hard blocker)*
2. **No handover artefacts** — no schema DDL, import logs, or notes from the previous migration work; import completeness is unknowable.
3. **Auth model has no AWS replacement** — 25 RLS policies and 2 SECURITY DEFINER helpers depend on `auth.uid()`; Supabase Auth still issues all app and MCP tokens.
4. **`pg_net` is unavailable on RDS** — every `pg_cron` + `pg_net` scheduled invocation must be re-platformed to EventBridge → Lambda.
5. **Extension/vector parity unproven** — pgvector 0.8.0, pg_trgm 1.6, the HNSW index, and `vector(1536)` columns must all exist on RDS; a CSV row-count match proves none of this.
6. **`search_tenders_hybrid` has 4 overloads** — porting the wrong signature silently breaks search.
7. **Data drift** — the source has grown since the exports (tenders +818, ingest_runs +26,596); a final cutover delta-sync is mandatory.
8. **Pipeline tables outside the "minimal 14"** — `raw_contracts_finder`, `raw_cf_native`, `cf_bulk_upload`, `raw_ccs_digital_outcomes`, `raw_fts`, `notices_sync_log`, `tenders_fts`, `backfill_state` are required if ingestion moves too.

### Table classification

| Table | Classification |
|---|---|
| tenders, notices, awards, award_suppliers, suppliers, buyers, cpv_codes | PRODUCTION APPLICATION |
| saved_bids, saved_searches, profiles, memberships, organisations, org_match_profiles, org_name_aliases | PRODUCTION APPLICATION (user state — must migrate exactly) |
| tenders_pcs, tenders_ccs, tenders_fts | INGESTION PIPELINE / SEARCH SUPPORT |
| raw_contracts_finder, raw_cf_native, raw_fts, cf_bulk_upload, raw_ccs_digital_outcomes | INGESTION PIPELINE (large; rebuildable from source APIs) |
| backfill_state, cf_scrape_queue | PIPELINE STATE |
| ingest_runs, notices_sync_log | OPTIONAL / REBUILDABLE (logs — 315k rows, low value) |
| tenders.embedding + HNSW index | SEARCH SUPPORT (regenerable, but costly) |

---

## 15. Recommended First Edge Function

**`contracts-finder`** (or equally `find-a-tender` / `contracts-scotland` / `scrape-cf-notice`).

Rationale — deliberately **not** `semantic-search`:

| Criterion | `contracts-finder` | `semantic-search` |
|---|---|---|
| AWS DB readiness required | **None — zero DB access** | tenders + RPC + pgvector + pg_trgm + HNSW |
| Dependencies | 1 public API | 5+ |
| Supabase-specific APIs | **None** | service-role client, RPC |
| Auth requirements | **None** | none (but service role) |
| Testable independently | **Yes — deterministic HTTP diff** | Only after full DB migration |
| Business risk | **Low — read-only proxy** | High — core product surface |
| Rollback | **Trivial — flip one client URL** | Complex |

It is a pure stateless fetch/transform proxy, so it validates the entire AWS delivery path (Lambda + API Gateway + IAM + CORS + Secrets Manager + CloudWatch + Deno→Node port conventions) **with zero database dependency**, while the RDS reconciliation continues in parallel. If `contracts-finder` is not currently on a critical path, `scrape-cf-notice` is an even lower-risk equivalent.

---

## 16. Recommended Edge Function Migration Order

1. **`contracts-finder`** — proves Lambda + API Gateway + CORS + observability. Prereqs: AWS account access. Target: Lambda (Node/TS) behind API Gateway. DB deps: none. Validation: byte-diff responses against the Supabase version for 20 fixed queries.
2. **`find-a-tender`, `contracts-scotland`, `scrape-cf-notice`** — same pattern, batch-migrated. Validates the porting template. DB deps: none.
3. **`buyer-profile`** — introduces **Secrets Manager** (AI key) with still no DB. Validation: same-prompt output comparison.
4. **`embed-tenders-batch`** — **first DB-touching function**. Prereqs: RDS verified, `tenders` present with `embedding vector(1536)` + `embedding_status`, pgvector installed. Target: Lambda on an **EventBridge** schedule (first `pg_cron`→EventBridge replacement). Validation: run against a restored snapshot; compare embedded counts and cosine similarity vs. Supabase-generated vectors.
5. **`semantic-search`** — prereqs: `search_tenders_hybrid` (14-arg) ported verbatim, HNSW index built, pg_trgm installed. Validation: run 30 benchmark queries (e.g. "school catering") against both and diff the top-20 ordering and score breakdowns.
6. **Ingestion set** — `ingest-fts`, `ingest-cf`, `ingest-contracts-scotland`, then `ingest-cf-native`/`-bulk`, `normalize-raw-cf`, `scrape-ccs-digital-outcomes`, `sync-notices`, `backfill-*`. Prereqs: raw/pipeline tables + canonical-name and derived-status triggers on RDS; EventBridge schedules. Validation: dual-run into AWS and diff upserted rows against Supabase for the same window.
7. **`daily-search-alerts`** — after semantic search and `saved_searches` are live. Prereqs: Resend key in Secrets Manager, `idx_tenders_deadline_published` recreated. Validation: dry-run mode sending only to an internal address; compare recipient/result sets.
8. **Auth-dependent set — LAST**: `bootstrap-org`, `draft-bid-response`, `admin-create-user`, `mcp`. Prereqs: the auth decision (Cognito vs. keep Supabase Auth vs. custom JWT) plus the RLS/`auth.uid()` replacement. These define the frontend cutover.

---

## 17. Validation Strategy

- **Schema:** diff `information_schema.columns`, `pg_constraint`, and `pg_indexes` between Supabase and RDS per table — not row counts alone.
- **Data:** per-table `count(*)`, plus `md5` of ordered natural keys (`source||external_id`) and min/max `published_at` to detect truncated imports (the historical `raw_contracts_finder` export truncated at 117,247 rows once already).
- **Functions:** compare `pg_get_functiondef` text for each RPC; assert the exact 14-arg `search_tenders_hybrid` signature exists.
- **Vectors:** assert `atttypmod = 1536` and the HNSW index exists; spot-check cosine distances for 100 known tender pairs.
- **Search quality:** golden-query harness — 30 queries, compare top-20 IDs + score components across both backends; require ≥95% overlap.
- **Edge Functions:** shadow/dual-run each migrated Lambda against the Supabase original with identical payloads and diff JSON responses before switching any client.
- **Cutover:** final delta-sync by `updated_at`/`created_at` after ingestion is paused.

---

## 18. Risks

1. **Silent data truncation** during large CSV imports (already observed historically) — row-count checks alone would miss it.
2. **Embedding loss** — if `tenders.embedding` did not survive CSV round-tripping, search quality collapses; re-embedding ~20k rows costs AI credits and time.
3. **Signature drift** on `search_tenders_hybrid` overloads.
4. **Auth rewrite scope** — replacing `auth.uid()` touches 25 RLS policies and the whole frontend; the highest-effort, highest-risk item.
5. **`pg_net` removal** breaks every scheduled job unless EventBridge is stood up first.
6. **Ongoing drift** — Supabase keeps ingesting during migration; any long freeze is itself a business risk.
7. **Trigger omission** — canonical-name and derived-status triggers are invisible in CSV exports; without them new AWS ingests produce NULL canonicals and "Unknown" statuses (a bug already fixed once in this app).
8. **Two teams, one database** — parallel unlogged changes on AWS could invalidate this report at any time.

---

## 19. Open Questions

1. Which AWS account/region hosts the RDS instance, and can read-only credentials be provided to this environment via the secret store?
2. Did the other team member import schema **DDL** (constraints, indexes, triggers, functions, RLS) or only CSV data?
3. Do `pgvector` and `pg_trgm` exist on the RDS instance, and were embeddings imported or are they NULL?
4. Is `pg_cron` enabled in the RDS parameter group, or is EventBridge the intended scheduler?
5. What is the target auth model — Amazon Cognito, custom JWT, or keep Supabase Auth during a hybrid phase?
6. Is the ingestion pipeline in scope, or will AWS run production reads only while Supabase keeps ingesting during transition?
7. Are the 625k `raw_contracts_finder` rows required on AWS, or acceptable to rebuild from source APIs?
8. Lambda vs. ECS/Fargate for long-running ingest jobs (several exceed Lambda's 15-minute ceiling)?
9. Is there an agreed cutover date / acceptable freeze window?
