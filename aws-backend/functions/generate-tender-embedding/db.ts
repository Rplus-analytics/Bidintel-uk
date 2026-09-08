// ============================================================================
// DATABASE STUB — not yet wired to RDS
// ============================================================================
//
// See embed-tenders-batch/db.ts for the full TODO(rds) checklist (pg client,
// Secrets Manager, module-scope pool with max:1, VPC + NAT for outbound AI
// calls, non-owner role). The same applies here.
//
// Nothing here has been executed.

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

/** Runs SQL_GET_TENDER. Returns null when no row matches (maybeSingle semantics). */
export async function getTenderById(_id: string): Promise<TenderRow | null> {
  throw new DbNotConfiguredError("getTenderById");
}

/** Runs SQL_SET_EMBEDDING. */
export async function setEmbedding(_id: string, _embedding: number[]): Promise<void> {
  throw new DbNotConfiguredError("setEmbedding");
}
