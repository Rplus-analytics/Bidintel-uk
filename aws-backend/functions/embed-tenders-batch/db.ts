// ============================================================================
// DATABASE STUB — not yet wired to RDS
// ============================================================================
//
// Every function in this file throws until RDS exists. The SQL below is the
// literal translation of the PostgREST calls the Deno original makes, so
// implementing this is a matter of connecting a client and running them.
//
// TODO(rds): to implement —
//   1. `npm install pg` (and `@types/pg` as a devDependency) in this function.
//   2. Read the connection details from Secrets Manager, NOT from a plaintext
//      Lambda env var. The secret RDS creates has the shape
//      { username, password, host, port, dbname }.
//   3. Create the Pool at MODULE scope, not inside the handler, so it survives
//      warm invocations. Cap it hard: `max: 1` per container. Lambda scales by
//      process, so a pool of 10 across 50 concurrent containers is 500
//      connections and will exhaust `max_connections` on a small RDS instance.
//      Put RDS Proxy in front before concurrency goes above single digits.
//   4. Attach the Lambda to the RDS VPC (subnets + security group) and add
//      AWSLambdaVPCAccessExecutionRole to its execution role. Note that this
//      removes default internet access, and this function MUST still reach
//      ai.gateway.lovable.dev — so the subnets need a NAT gateway, or the
//      whole thing stops working in a way that looks like a hang, not an error.
//   5. Connect as a non-owner role that does NOT bypass RLS
//      (see aws-backend/auth/AUTH-MIGRATION-PLAN.md § 4.2). This function runs
//      as a service worker with no user context, so it needs a role explicitly
//      granted access to `tenders` rather than the app's per-request role.
//
// Nothing here has been executed. The SQL is written from the column names the
// Deno original selects and updates; verify it against the live schema before
// trusting it.

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
  constructor(operation: string) {
    super(
      `Database not configured: ${operation} requires RDS. ` +
      `This Lambda is a scaffold — see the TODO(rds) block in db.ts. ` +
      `The Supabase version of embed-tenders-batch remains the live implementation.`,
    );
    this.name = "DbNotConfiguredError";
  }
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_SECRET_ARN || process.env.DATABASE_URL);
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * Claim a batch of pending tenders by flipping them to 'processing'.
 *
 * NOTE — this deliberately differs from the Deno original, which does:
 *
 *     SELECT ... WHERE embedding_status = 'pending' ORDER BY published_at DESC LIMIT 50
 *     UPDATE tenders SET embedding_status = 'processing' WHERE id IN (...)
 *
 * as two separate statements. The comment there says "Claim a batch atomically"
 * but it is not atomic: two overlapping invocations (the cron fires every
 * minute; a slow batch can still be running) both SELECT the same rows and both
 * embed them, paying twice for the same vectors.
 *
 * The single statement below closes that race with FOR UPDATE SKIP LOCKED. If
 * you would rather reproduce the original's behaviour exactly, run the two
 * statements separately instead — but there is no good reason to.
 */
export const SQL_CLAIM_BATCH = `
  WITH claimed AS (
    SELECT id
      FROM tenders
     WHERE embedding_status = 'pending'
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE tenders t
     SET embedding_status = 'processing'
    FROM claimed c
   WHERE t.id = c.id
  RETURNING t.id, t.title, t.description, t.buyer_name,
            t.cpv_codes, t.primary_cpv, t.embedding_attempts
`;

/**
 * Mark one tender successfully embedded.
 *
 * $2 is a pgvector literal, NOT a JSON array — format it with
 * toVectorLiteral() below. The column is vector(1536); passing 3072 dimensions
 * fails at the database, not in the application.
 */
export const SQL_MARK_EMBEDDED = `
  UPDATE tenders
     SET embedding          = $2::vector,
         embedding_status   = 'completed',
         embedded_at        = now(),
         embedding_attempts = $3,
         embedding_error    = NULL
   WHERE id = $1
`;

/** Mark one tender failed; $2 is 'pending' (retry) or 'failed' (exhausted). */
export const SQL_MARK_FAILED = `
  UPDATE tenders
     SET embedding_status   = $2,
         embedding_attempts = $3,
         embedding_error    = $4
   WHERE id = $1
`;

/** pgvector wants '[0.1,0.2,...]', not '[0.1, 0.2]' or a JSON array. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Stubbed operations
// ---------------------------------------------------------------------------

/** Runs SQL_CLAIM_BATCH. Returns the claimed rows. */
export async function claimPendingBatch(_limit: number): Promise<PendingTender[]> {
  throw new DbNotConfiguredError("claimPendingBatch");
}

/** Runs SQL_MARK_EMBEDDED. */
export async function markEmbedded(
  _id: string,
  _embedding: number[],
  _attempts: number,
): Promise<void> {
  throw new DbNotConfiguredError("markEmbedded");
}

/** Runs SQL_MARK_FAILED. */
export async function markFailed(
  _id: string,
  _status: "pending" | "failed",
  _attempts: number,
  _error: string,
): Promise<void> {
  throw new DbNotConfiguredError("markFailed");
}
