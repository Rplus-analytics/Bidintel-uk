// ============================================================================
// Database layer — semantic-search
// ============================================================================
//
// Connects as bidintel_api (LOGIN, NOBYPASSRLS) once that role exists, so the
// user-facing path is always subject to RLS. Until then it accepts whatever
// DATABASE_URL / DATABASE_SECRET_ARN provides.
//
// Pool at module scope, max: 2 — Lambda scales by process, so a large pool
// multiplied by concurrency exhausts max_connections on a small instance. Two
// rather than one because every query now checks out a dedicated client for the
// duration of a transaction (see withIdentity); with max: 1 a second concurrent
// request inside the same container would queue behind the first.

import { Pool } from "pg";

/**
 * The caller's identity, taken from the API Gateway JWT authorizer.
 *
 * Passed through to Postgres on every query. See withIdentity() below for why
 * this is not optional.
 */
export type JwtClaims = Record<string, string | number | boolean | null | undefined>;

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
    max: 2,
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

/**
 * Run `fn` as the authenticated end user rather than as bidintel_api.
 *
 * WHY THIS IS NOT OPTIONAL — and how its absence was found. Without it, the
 * search returned:
 *
 *     status=200  results=0  rpcError=null  embeddingAvailable=true
 *
 * A clean, successful, EMPTY answer. Nothing failed. The RLS policy on
 * `tenders` is `USING (auth.role() = 'authenticated')`, and auth.role() reads
 * the `request.jwt.claims` GUC; with no claims set it returns NULL, the policy
 * is false for every row, and RLS silently filters the entire table. The 22,691
 * rows were there the whole time.
 *
 * This is the failure mode RLS always has: it removes rows, it does not raise.
 * A missing identity therefore looks exactly like "no matching tenders".
 *
 * MECHANICS, and why each part matters:
 *
 *   SET LOCAL — not SET. Lambda reuses a container, and the pool holds the same
 *     backend across invocations. A session-level SET ROLE would leak one
 *     caller's identity into the next request on that connection. SET LOCAL is
 *     scoped to the transaction and is unwound by COMMIT and by ROLLBACK alike.
 *
 *   explicit BEGIN/COMMIT — SET LOCAL outside a transaction block is a no-op
 *     with only a warning, so the transaction is what makes it take effect.
 *
 *   SET ROLE authenticated — bidintel_api is NOINHERIT, so it holds the
 *     `authenticated` privileges only while it has explicitly assumed the role.
 *     This mirrors exactly what PostgREST does with the same token.
 *
 *   ROLLBACK in the catch — returning a connection to the pool mid-transaction
 *     would leave the next caller inside a failed transaction block.
 */
async function withIdentity<T>(claims: JwtClaims, fn: (c: any) => Promise<T>): Promise<T> {
  const db = await getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    // Parameterised: the claims are attacker-influenced (they come from a token
    // whose custom attributes a user may be able to affect) and must never be
    // interpolated into SQL text.
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function searchTendersHybrid(p: HybridSearchParams, claims: JwtClaims): Promise<any[]> {
  return withIdentity(claims, async (client) => {
    const { rows } = await client.query(SQL, [
      toVectorLiteral(p.query_embedding), p.query_text, p.match_count, p.since_ts,
      p.cpv_prefix, p.expansion_terms, p.cpv_prefixes,
      p.w_keyword, p.w_cpv, p.w_semantic,
      p.core_terms, p.context_terms, p.active_only, p.intent_domain,
    ]);
    return rows;
  });
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
