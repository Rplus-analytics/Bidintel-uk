// ============================================================================
// Database layer — semantic-search
// ============================================================================
//
// Connects as bidintel_api (LOGIN, NOBYPASSRLS) once that role exists, so the
// user-facing path is always subject to RLS. Until then it accepts whatever
// DATABASE_URL / DATABASE_SECRET_ARN provides.
//
// Pool at module scope, max: 1 — Lambda scales by process, so a larger pool
// multiplied by concurrency exhausts max_connections on a small instance.

import { Pool } from "pg";

export interface HybridSearchParams {
  query_embedding: number[] | null;
  query_text: string;
  match_count: number;
  since_ts: string;
  cpv_prefix: string | null;
  expansion_terms: string[];
  cpv_prefixes: string[];
  w_keyword: number;
  w_cpv: number;
  w_semantic: number;
  core_terms: string[];
  context_terms: string[];
  active_only: boolean;
  intent_domain: string | null;
}

export class DbNotConfiguredError extends Error {
  constructor(op: string) {
    super(`Database not configured: ${op}. Set DATABASE_URL or DATABASE_SECRET_ARN.`);
    this.name = "DbNotConfiguredError";
  }
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_SECRET_ARN);
}

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  let conn = process.env.DATABASE_URL;
  if (!conn && process.env.DATABASE_SECRET_ARN) {
    const { SecretsManagerClient, GetSecretValueCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({});
    const r = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DATABASE_SECRET_ARN }));
    const s = JSON.parse(r.SecretString || "{}");
    conn = `postgresql://${encodeURIComponent(s.PGUSER)}:${encodeURIComponent(s.PGPASSWORD)}@${s.PGHOST}:${s.PGPORT ?? 5432}/${s.PGDATABASE}`;
  }
  if (!conn) throw new DbNotConfiguredError("getPool");
  pool = new Pool({
    connectionString: conn,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

/** pgvector literal; null stays null so the keyword-only fallback still works. */
export function toVectorLiteral(vec: number[] | null): string | null {
  return vec === null ? null : `[${vec.join(",")}]`;
}

/**
 * The 14-argument search_tenders_hybrid call.
 *
 * NAMED argument notation, not positional. The live database carries FOUR
 * overloads (5, 10, 13 and 14 arg); positional binding could silently resolve
 * to a different one and return plausible-but-wrong rankings. Named notation
 * fails loudly instead.
 *
 * $1 may be NULL: when the OpenAI embed call fails, the caller still runs the
 * RPC with a null vector and degrades to keyword + CPV ranking. That is the
 * designed fallback, not an error path.
 */
const SQL = `
  SELECT * FROM search_tenders_hybrid(
    query_embedding => $1::vector,
    query_text      => $2::text,
    match_count     => $3::int,
    since_ts        => $4::timestamptz,
    cpv_prefix      => $5::text,
    expansion_terms => $6::text[],
    cpv_prefixes    => $7::text[],
    w_keyword       => $8::double precision,
    w_cpv           => $9::double precision,
    w_semantic      => $10::double precision,
    core_terms      => $11::text[],
    context_terms   => $12::text[],
    active_only     => $13::boolean,
    intent_domain   => $14::text
  )
`;

export async function searchTendersHybrid(p: HybridSearchParams): Promise<any[]> {
  const db = await getPool();
  const { rows } = await db.query(SQL, [
    toVectorLiteral(p.query_embedding), p.query_text, p.match_count, p.since_ts,
    p.cpv_prefix, p.expansion_terms, p.cpv_prefixes,
    p.w_keyword, p.w_cpv, p.w_semantic,
    p.core_terms, p.context_terms, p.active_only, p.intent_domain,
  ]);
  return rows;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
