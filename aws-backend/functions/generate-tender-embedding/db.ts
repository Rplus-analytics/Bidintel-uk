// ============================================================================
// Database layer — generate-tender-embedding
// ============================================================================
//
// Single-tender embedding path. Connects as bidintel_app (BYPASSRLS) like the
// other workers; it writes rows for every organisation and is never reachable
// from the web tier.
//
// Pool at module scope, max: 1 — this function does two statements per
// invocation and Lambda scales by process, so a larger pool multiplied by
// concurrency exhausts max_connections.

export interface TenderRow {
  id: string;
  title: string | null;
  description: string | null;
  cpv_codes: string[] | null;
}

export class DbNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `Database not configured: ${operation} requires RDS. ` +
      `This Lambda is a scaffold — see the TODO(rds) block in db.ts.`,
    );
    this.name = "DbNotConfiguredError";
  }
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_SECRET_ARN || process.env.DATABASE_URL);
}

/** Equivalent of `.from("tenders").select(...).eq("id", id).maybeSingle()`. */
export const SQL_GET_TENDER = `
  SELECT id, title, description, cpv_codes
    FROM tenders
   WHERE id = $1
`;

/**
 * Equivalent of `.from("tenders").update({ embedding }).eq("id", id)`.
 *
 * $2 is a pgvector literal — see toVectorLiteral(). The column is vector(1536)
 * and WILL reject the OpenAI fallback path; see the dimension warning in index.ts.
 */
export const SQL_SET_EMBEDDING = `
  UPDATE tenders
     SET embedding = $2::vector
   WHERE id = $1
`;

export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

import { Pool } from "pg";

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  let conn = process.env.DATABASE_URL;
  if (!conn && process.env.DATABASE_SECRET_ARN) {
    const { SecretsManagerClient, GetSecretValueCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({});
    const r = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DATABASE_SECRET_ARN }));
    const c = JSON.parse(r.SecretString || "{}");
    conn = `postgresql://${encodeURIComponent(c.PGUSER)}:${encodeURIComponent(c.PGPASSWORD)}` +
           `@${c.PGHOST}:${c.PGPORT ?? 5432}/${c.PGDATABASE}`;
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

/** Runs SQL_GET_TENDER. Returns null when no row matches (maybeSingle semantics). */
export async function getTenderById(id: string): Promise<TenderRow | null> {
  const db = await getPool();
  const { rows } = await db.query(SQL_GET_TENDER, [id]);
  return (rows[0] as TenderRow) ?? null;
}

/** Runs SQL_SET_EMBEDDING. */
export async function setEmbedding(id: string, embedding: number[]): Promise<void> {
  const db = await getPool();
  // The column is vector(1536). A provider returning a different width fails
  // here with a dimension error rather than silently storing a vector that
  // would make every similarity score meaningless.
  await db.query(SQL_SET_EMBEDDING, [id, toVectorLiteral(embedding)]);
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
