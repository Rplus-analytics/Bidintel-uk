## Procurement Status Normalization

Goal: replace ad-hoc `status` with a normalized `derived_status` (`Active | Complete | Planned | Cancelled | Withdrawn | Unknown`) computed from the most reliable source, with raw `source_status` preserved for audit. Drive Unknown below 1%.

### Current state
- `tenders.status` (enum) is ~45% Unknown (29,068 / 64,184), dominated by TED rows whose `raw_json` only carries `notice-type` (e.g. `cn-standard`, `can-standard`, `pin-only`, `tenderCancellation`, `awardUpdate`).
- CF/FTS already map OCDS `tender.status` and tags but lose nuance (PIN, award-only, cancellation tags).
- No single field unifies the four feeds; UI re-derives badges in 3 places.

### Schema (migration)
Add to `public.tenders` and `public.notices`:
- `source_status text` — raw upstream status string (lowercased, untranslated)
- `derived_status text` — one of `active|complete|planned|cancelled|withdrawn|unknown`

Index: `(derived_status)` and `(source, derived_status)` for filter perf.

### Derivation function `public.compute_derived_status(...)`

Priority order (first hit wins):
1. **source_status valid** → map verbatim
   `active→active`, `complete|completed|unsuccessful→complete`,
   `cancelled|canceled→cancelled`, `withdrawn→withdrawn`,
   `planned|planning→planned`.
2. **Tag / notice-type inference**
   - OCDS tag contains `tenderCancellation` → `cancelled`
   - OCDS tag contains `withdrawn|tenderWithdrawal` → `withdrawn`
   - OCDS tag contains `award|contract|awardUpdate|contractUpdate|contractAmendment|contractTermination` → `complete`
   - OCDS tag contains `planning` OR TED `notice-type` starts with `pin` → `planned`
   - TED `notice-type` starts with `can` (contract-award-notice) → `complete`
   - TED `notice-type` starts with `cn` (contract-notice) → use deadline rule
3. **Date inference**
   - `award_date` present → `complete`
   - `deadline_at > now()` → `active`
   - `deadline_at <= now()` (and no award) → `complete`
4. Fallback → `unknown`.

Implemented as a STABLE SQL function taking `(source, raw_json jsonb, notice_type text, source_status text, deadline_at timestamptz, award_date timestamptz)`.

### Backfill (one-shot SQL in same migration)
- Populate `source_status` from JSON for each source:
  - cf/fts: `raw_json->'tender'->>'status'` + tags from `raw_json->'tag'`
  - ted: `raw_json->>'notice-type'`
  - contracts_scotland: existing `status` column
- Populate `derived_status = compute_derived_status(...)` for every row in `tenders` and mirror to `notices`.

Expected result: TED `can*`/`cn*`/`pin*` rows resolve, OCDS tag-only rows resolve, dropping Unknown to a sub-1% residual (rows with neither tag, notice-type, dates, nor status).

### Trigger
`BEFORE INSERT OR UPDATE` on `tenders` — recompute `derived_status` whenever `source_status`, `raw_json`, `notice_type`, `deadline_at`, or `award_date` changes. Same trigger on `notices`.

### Ingest function updates
`ingest-cf`, `ingest-fts`, `ingest-contracts-scotland`, TED ingest path (`raw_ted` → tenders): set `source_status` from the upstream payload; leave `derived_status` to the trigger.

### RPC + read path
- `search_tenders_hybrid` return list extended with `derived_status` (no scoring change).
- `useStoredNotices` selects `derived_status` and maps it onto `ContractsFinderNotice.status`.
- `Contracts.tsx` `LiveStatusBadge` reads `derived_status` directly; drop the local re-mapping.
- Saved-search filters, `daily-search-alerts`, and `useMatchProfile` query/filter on `derived_status`.

### Admin metrics (EmbeddingStatusCard sibling: `StatusCoverageCard`)
Three counters via a small SQL view `v_status_coverage`:
- **Source Status Coverage** — `% rows where source_status is not null/empty`
- **Derived Status Coverage** — `% rows where derived_status <> 'unknown'`
- **Remaining Unknown** — absolute count, with breakdown by source

Added to `src/pages/Admin.tsx` next to embedding card.

### File touch list
- `supabase/migrations/<new>.sql` — columns, function, trigger, backfill, view
- `supabase/functions/ingest-cf/index.ts`, `ingest-fts/index.ts`, `ingest-contracts-scotland/index.ts` — set `source_status`
- `src/hooks/useStoredNotices.ts` — select+map `derived_status`
- `src/pages/Contracts.tsx` — use `derived_status` for badge + filter
- `src/pages/SavedSearches.tsx`, `supabase/functions/daily-search-alerts/index.ts`, `src/hooks/useMatchProfile.ts` — filter on `derived_status`
- `src/components/StatusCoverageCard.tsx` (new) + `src/pages/Admin.tsx`

### Non-goals
- No change to scoring weights or semantic search behaviour.
- Old `status` enum column kept untouched for now (read-compat); marked for removal after Phase 2.
