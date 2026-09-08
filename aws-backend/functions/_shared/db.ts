// ============================================================================
// DATABASE STUB — shared by the ingestion Lambdas
// ============================================================================
//
// The ingestion functions and the OCDS helpers make ~40 distinct PostgREST
// calls between them. Rewriting every one as raw SQL up front would mean
// rewriting the function bodies, which would forfeit the byte-for-byte fidelity
// that makes this batch reviewable against the Deno originals.
//
// So this file provides a PostgREST-SHAPED stub instead: the same fluent
// surface the Supabase client exposes, where every terminal operation rejects
// with a DbNotConfiguredError naming the table and operation attempted. The
// function bodies therefore stay identical to the originals, and the work left
// to do is localised here.
//
// TO BE CLEAR ABOUT WHAT THIS IS NOT: the real implementation is NOT
// "make this stub talk to Postgres". Do not build a mini-PostgREST. The real
// port replaces each call site with the SQL documented in the SQL_NOTES block
// below, behind a small typed data-access module per function — the shape used
// by semantic-search/db.ts and embed-tenders-batch/db.ts in the previous batch.
// This stub exists so the ported logic can be reviewed and diffed NOW, before
// RDS exists, without inventing SQL that nobody can run or test.
//
// TODO(rds): implementation checklist —
//   1. `npm install pg` (+ `@types/pg`) per function that needs it.
//   2. Read credentials from Secrets Manager, not a plaintext Lambda env var.
//   3. Module-scope Pool with `max: 1` per container; RDS Proxy in front once
//      concurrency rises. Lambda scales by process, so a pool of 10 across 50
//      containers is 500 connections.
//   4. VPC attach + `AWSLambdaVPCAccessExecutionRole`. NOTE: attaching to a VPC
//      removes default internet access, and every one of these functions makes
//      outbound calls to gov.uk / CKAN / TED. Without a NAT gateway they hang
//      until timeout rather than failing fast.
//   5. Connect as a non-owner role that does not bypass RLS.
//
// ============================================================================
// SQL_NOTES — the operations the ported code performs, by table
// ============================================================================
//
// ingest_runs  (every ingest function)
//   insert  : INSERT INTO ingest_runs (source, started_at) VALUES ($1, now())
//             RETURNING id
//   update  : UPDATE ingest_runs SET finished_at = now(), count = $2,
//                    errors = $3::jsonb, duration_ms = $4 WHERE id = $1
//
// tenders  (ingest-cf, ingest-fts, ingest-contracts-scotland,
//           normalize-raw-cf, scrape-ccs-digital-outcomes)
//   upsert  : INSERT INTO tenders (...) VALUES (...)
//             ON CONFLICT (source, external_id) DO UPDATE SET ...
//             RETURNING id, source, external_id
//             -- the RETURNING clause matters: ingest-cf/-fts build an id map
//             -- from it to link child rows. Do not drop it.
//   update  : UPDATE tenders SET buyer_id = $2 WHERE id = $1
//             UPDATE tenders SET contract_start = $2, contract_end = $3 WHERE id = $1
//             UPDATE tenders SET status = $2, primary_cpv = $3, country = $4,
//                    notice_type = $5, region = $6 WHERE id = $1   (TED enrich)
//
// tenders_fts / tenders_ted / tenders_pcs  (ingest-source-full)
//   upsert  : INSERT INTO tenders_<src> (...) ON CONFLICT (source, external_id) DO UPDATE SET ...
//
// tenders_ccs / raw_ccs_digital_outcomes  (scrape-ccs-digital-outcomes)
//   upsert  : ON CONFLICT (source, external_id) / ON CONFLICT (project_id)
//
// notices  (notices-mirror.ts, sync-notices)
//   upsert  : INSERT INTO notices (...) ON CONFLICT (source, external_id) DO UPDATE SET ...
//
// notices_sync_log  (sync-notices)
//   insert  : INSERT INTO notices_sync_log (started_at, finished_at, source, inserted, error)
//
// buyers  (ocds-linked.ts, sync-notices)
//   upsert  : ON CONFLICT (external_id) when the release carries a buyer id,
//             otherwise ON CONFLICT (name). RETURNING id.
//             -- two different conflict targets on the same table; both unique
//             -- constraints must exist on RDS or the upsert errors at runtime.
//   select  : SELECT id, name FROM buyers WHERE name = ANY($1)
//
// suppliers        upsert ON CONFLICT (external_id) or (name), RETURNING id
// awards           upsert ON CONFLICT (source, external_id), RETURNING id
// award_suppliers  upsert ON CONFLICT (award_id, supplier_id)
// tender_cpv       upsert ON CONFLICT (tender_id, cpv_code)
// tender_lots      upsert ON CONFLICT (tender_id, lot_number)
// tender_documents DELETE WHERE tender_id = $1, then INSERT (no unique key —
//                  delete-then-insert is how the original stays idempotent)
//
// raw_cf_native  (ingest-cf-native)
//   select  : SELECT notice_id FROM raw_cf_native WHERE notice_id = ANY($1)
//   insert  : INSERT INTO raw_cf_native (notice_id, payload, fetched_at)
//
// raw_contracts_finder  (normalize-raw-cf)
//   select  : SELECT payload, published_date FROM raw_contracts_finder
//              WHERE published_date >= $1 AND published_date < $2
//              ORDER BY published_date DESC LIMIT $3 OFFSET $4
//   select  : SELECT payload FROM raw_contracts_finder WHERE ocid = $1
//
// cf_bulk_upload  (ingest-cf-bulk)
//   upsert  : ON CONFLICT (notice_identifier)
//
// backfill_state  (ingest-cf-native, normalize-raw-cf, scrape-ccs-digital-outcomes)
//   select  : SELECT * FROM backfill_state WHERE source = $1
//   upsert  : ON CONFLICT (source)
//   update  : UPDATE backfill_state SET lock_until = $2
//              WHERE source = $1 AND (lock_until IS NULL OR lock_until < now())
//             RETURNING source
//             -- ingest-cf-native's advisory lock. The conditional UPDATE ... 
//             -- RETURNING is what makes it atomic; preserve it exactly, or
//             -- concurrent ticks will both think they hold the lock.
//   update  : UPDATE backfill_state SET year=$2, month0=$3, cursor_date=$4,
//                    completed=$5, last_run_at=now(), lock_until=NULL
//              WHERE source = $1 AND cursor_date = $6 RETURNING source
//             -- the `AND cursor_date = <expected>` is an optimistic-concurrency
//             -- check; the original throws if it matches no row. Keep it.

export class DbNotConfiguredError extends Error {
  constructor(table: string, op: string) {
    super(
      `Database not configured: ${op} on "${table}" requires RDS. ` +
      `This Lambda is a scaffold — see the TODO(rds) block in functions/_shared/db.ts. ` +
      `The Supabase version remains the live implementation.`,
    );
    this.name = "DbNotConfiguredError";
  }
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_SECRET_ARN || process.env.DATABASE_URL);
}

/**
 * Chainable stub matching the subset of the PostgREST builder these functions
 * use. Every method returns `this`; awaiting it rejects.
 */
class StubQueryBuilder implements PromiseLike<never> {
  constructor(private table: string, private op = "query") {}

  private mark(op: string): this {
    this.op = op;
    return this;
  }

  select(_cols?: string): this { return this.op === "query" ? this.mark("select") : this; }
  insert(_rows?: unknown): this { return this.mark("insert"); }
  upsert(_rows?: unknown, _opts?: unknown): this { return this.mark("upsert"); }
  update(_patch?: unknown): this { return this.mark("update"); }
  delete(): this { return this.mark("delete"); }

  eq(_c?: string, _v?: unknown): this { return this; }
  neq(_c?: string, _v?: unknown): this { return this; }
  in(_c?: string, _v?: unknown[]): this { return this; }
  gte(_c?: string, _v?: unknown): this { return this; }
  lte(_c?: string, _v?: unknown): this { return this; }
  gt(_c?: string, _v?: unknown): this { return this; }
  lt(_c?: string, _v?: unknown): this { return this; }
  or(_filter?: string): this { return this; }
  // PostgREST negation/pattern filters. `.not()` is used by backfill-linked-tables
  // (`.not("raw_json", "is", null)`) and backfill-tick (`.not("source", "like", "%_full")`);
  // the rest are here so an added call site cannot silently break the chain
  // before it reaches the throw.
  not(_c?: string, _op?: string, _v?: unknown): this { return this; }
  is(_c?: string, _v?: unknown): this { return this; }
  like(_c?: string, _v?: unknown): this { return this; }
  ilike(_c?: string, _v?: unknown): this { return this; }
  filter(_c?: string, _op?: string, _v?: unknown): this { return this; }
  match(_q?: Record<string, unknown>): this { return this; }
  contains(_c?: string, _v?: unknown): this { return this; }
  order(_c?: string, _o?: unknown): this { return this; }
  range(_f?: number, _t?: number): this { return this; }
  limit(_n?: number): this { return this; }
  single(): this { return this; }
  maybeSingle(): this { return this; }

  then<R1 = never, R2 = never>(
    _onfulfilled?: ((value: never) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.reject(new DbNotConfiguredError(this.table, this.op)).then(
      undefined,
      onrejected ?? undefined,
    ) as PromiseLike<R1 | R2>;
  }

  catch(onrejected?: ((reason: unknown) => unknown) | null) {
    return Promise.reject(new DbNotConfiguredError(this.table, this.op)).catch(
      onrejected ?? undefined,
    );
  }
}

export interface DbClient {
  from(table: string): any;
  rpc(fn: string, args?: unknown): any;
  auth: {
    getUser(jwt?: string): Promise<{ data: { user: null }; error: Error }>;
  };
}

/**
 * Drop-in stand-in for the Supabase service-role client the Deno originals
 * create at module scope. Swap this for a real data-access module per the
 * TODO(rds) checklist above.
 */
export function createDbClient(): DbClient {
  return {
    from(table: string) {
      return new StubQueryBuilder(table);
    },
    rpc(fn: string) {
      return new StubQueryBuilder(`rpc:${fn}`, "rpc");
    },
    auth: {
      async getUser(_jwt?: string) {
        // TODO(auth): replaced by Cognito JWT verification, not a database call.
        // See aws-backend/auth/AUTH-MIGRATION-PLAN.md § 4.
        return {
          data: { user: null },
          error: new DbNotConfiguredError("auth.users", "getUser"),
        };
      },
    },
  };
}
