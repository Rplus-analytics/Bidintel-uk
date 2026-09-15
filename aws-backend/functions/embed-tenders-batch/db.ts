// ============================================================================
// Database layer — embed-tenders-batch
// ============================================================================
//
// Pool at MODULE scope with max: 1. Lambda scales by process, so a pool of 10
// across 50 concurrent containers is 500 connections and would exhaust
// max_connections on a small RDS instance. One connection per container, reused
// across warm invocations.

import { Pool, type PoolClient } from "pg";

export interface PendingTender {
  id: string;
  title: string | null;
  description: string | null;
  buyer_name: string | null;
  cpv_codes: string[] | null;
  primary_cpv: string | null;
  embedding_attempts: number | null;
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
    // Fetched once per container, then cached in the module-scope pool.
    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({});
    const r = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DATABASE_SECRET_ARN }));
    const s = JSON.parse(r.SecretString || "{}");
    conn = `postgresql://${encodeURIComponent(s.PGUSER ?? s.username)}:${encodeURIComponent(s.PGPASSWORD ?? s.password)}@${s.PGHOST ?? s.host}:${s.PGPORT ?? s.port ?? 5432}/${s.PGDATABASE ?? s.dbname}`;
  }
  if (!conn) throw new DbNotConfiguredError("getPool");
  pool = new Pool({
    connectionString: conn,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: { rejectUnauthorized: false }, // RDS uses its own CA
  });
  return pool;
}

/** pgvector wants '[0.1,0.2,…]', not a JSON array. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Claim a batch atomically.
 *
 * FOR UPDATE SKIP LOCKED in a single statement, deliberately unlike the Deno
 * original which did SELECT then UPDATE separately. The comment there said
 * "atomically" but it was not: two overlapping runs claimed the same rows and
 * paid twice for the same vectors. This closes that.
 */
const SQL_CLAIM_BATCH = `
  WITH claimed AS (
    SELECT id FROM tenders
     WHERE embedding_status = 'pending'
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE tenders t SET embedding_status = 'processing'
    FROM claimed c WHERE t.id = c.id
  RETURNING t.id, t.title, t.description, t.buyer_name,
            t.cpv_codes, t.primary_cpv, t.embedding_attempts
`;

export async function claimPendingBatch(limit: number): Promise<PendingTender[]> {
  const p = await getPool();
  const { rows } = await p.query(SQL_CLAIM_BATCH, [limit]);
  return rows as PendingTender[];
}

export async function markEmbedded(id: string, embedding: number[], attempts: number): Promise<void> {
  const p = await getPool();
  await p.query(
    `UPDATE tenders
        SET embedding = $2::vector, embedding_status = 'completed', embedded_at = now(),
            embedding_attempts = $3, embedding_error = NULL
      WHERE id = $1`,
    [id, toVectorLiteral(embedding), attempts],
  );
}

export async function markFailed(
  id: string, status: "pending" | "failed", attempts: number, error: string,
): Promise<void> {
  const p = await getPool();
  await p.query(
    `UPDATE tenders SET embedding_status = $2, embedding_attempts = $3, embedding_error = $4 WHERE id = $1`,
    [id, status, attempts, error],
  );
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
