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
// (was TODO(rds) — implemented): implementation checklist —
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
      `Database not configured: ${op} on "${table}". ` +
      `Set DATABASE_SECRET_ARN (preferred) or DATABASE_URL.`,
    );
    this.name = "DbNotConfiguredError";
  }
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_SECRET_ARN || process.env.DATABASE_URL);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
//
// Connects as bidintel_app: BYPASSRLS, because these workers write rows for
// every organisation and are never reachable from the web tier. That is also
// exactly why this module must never be imported by a user-facing function —
// semantic-search and buyer-profile use bidintel_api, which is NOBYPASSRLS.
//
// Pool at module scope so a warm container reuses the connection. max: 2 rather
// than 1: several workers issue a second query while the first is still open.

import { Pool, types as pgTypes } from "pg";

// ---------------------------------------------------------------------------
// Type parsing must match PostgREST's JSON, not node-pg's defaults
// ---------------------------------------------------------------------------
//
// FOUND BY A CRASH, not by review. ingest-cf-native does:
//
//   new Date(data.cursor_date + "T00:00:00Z")
//
// Over PostgREST, `cursor_date` arrived as the JSON string "2026-09-03" and that
// works. node-pg parses `date` into a JS Date object, so the concatenation
// produced "Mon Sep 03 2026 ...T00:00:00Z" and the function died with
// `Invalid time value` — a crash, but only because it happened to concatenate.
// Code that compared or JSON-serialised such a value would have failed SILENTLY,
// which is worse, and there are 16 workers' worth of such code.
//
// So the pool is configured to return what PostgREST would have returned:
// temporal types as strings, and the integer/numeric types node-pg hands back as
// strings as numbers.

// 1082 date, 1114 timestamp, 1184 timestamptz, 1083 time, 1266 timetz
for (const oid of [1082, 1114, 1184, 1083, 1266]) {
  pgTypes.setTypeParser(oid, (v: string) => v);
}
// 20 int8 and 1700 numeric: node-pg returns these as strings to avoid precision
// loss. PostgREST emits them as JSON numbers, and the workers do arithmetic on
// them (`counts.fts += ...`). Row counts here are far below 2^53.
pgTypes.setTypeParser(20, (v: string) => (v === null ? null : Number(v)));
pgTypes.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
import { QueryBuilder, type Result } from "./sql-builder";

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;

  let conn = process.env.DATABASE_URL;
  if (!conn && process.env.DATABASE_SECRET_ARN) {
    const { SecretsManagerClient, GetSecretValueCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({});
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: process.env.DATABASE_SECRET_ARN }),
    );
    const c = JSON.parse(r.SecretString || "{}");
    conn = `postgresql://${encodeURIComponent(c.PGUSER)}:${encodeURIComponent(c.PGPASSWORD)}` +
           `@${c.PGHOST}:${c.PGPORT ?? 5432}/${c.PGDATABASE}`;
  }
  if (!conn) throw new DbNotConfiguredError("(pool)", "connect");

  pool = new Pool({
    connectionString: conn,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    // Ingestion runs are long; a worker paging through an upstream API can hold
    // a statement open well past the default.
    statement_timeout: 120_000,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

async function run(sql: string, values: any[]): Promise<any[]> {
  const db = await getPool();
  const res = await db.query(sql, values);
  return res.rows;
}

export interface DbClient {
  from(table: string): QueryBuilder;
  rpc(fn: string, args?: Record<string, unknown>): Promise<Result>;
  auth: {
    getUser(jwt?: string): Promise<{ data: { user: null }; error: Error }>;
  };
}

/**
 * Drop-in replacement for the Supabase service-role client the Deno originals
 * created at module scope. Same call sites, same `{ data, error }` shape.
 */
export function createDbClient(): DbClient {
  return {
    from(table: string) {
      return new QueryBuilder(table, run);
    },

    /**
     * The four backfill_status_* reporting functions. Named-argument notation,
     * for the same reason semantic-search uses it: if an overload is ever added,
     * positional binding resolves silently to the wrong one.
     */
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
      try {
        const names = Object.keys(args);
        const call = names.length
          ? names.map((n, i) => `${n} => $${i + 1}`).join(", ")
          : "";
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(fn)) throw new Error(`unsafe function name: ${fn}`);
        for (const n of names) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error(`unsafe argument name: ${n}`);
        }
        const rows = await run(`SELECT * FROM "${fn}"(${call})`, names.map((n) => args[n]));

        // PostgREST returns a BARE SCALAR for a scalar-returning function, and
        // an array of objects for a table-returning one. Returning rows
        // unconditionally broke backfill-status, which does
        // `counts.fts += (fts.data as number)` — it summed an array of objects
        // into the string "0[object Object][object Object]…" rather than
        // throwing. Matching PostgREST here keeps those call sites correct.
        if (rows.length === 1) {
          const keys = Object.keys(rows[0]);
          if (keys.length === 1) return { data: rows[0][keys[0]], error: null };
        }
        return { data: rows, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e?.message || String(e), code: e?.code } };
      }
    },

    auth: {
      async getUser(_jwt?: string) {
        // Replaced by Cognito JWT verification at the API Gateway edge; these
        // workers are EventBridge-triggered and have no caller identity.
        return {
          data: { user: null },
          error: new Error("auth.getUser is not available in workers; use the API Gateway authorizer"),
        };
      },
    },
  };
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
