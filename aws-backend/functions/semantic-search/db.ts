// ============================================================================
// DATABASE STUB — not yet wired to RDS
// ============================================================================
//
// See embed-tenders-batch/db.ts for the full TODO(rds) checklist. Two extra
// prerequisites apply to THIS function specifically, and neither is optional:
//
//   * pgvector and pg_trgm must be installed on the RDS instance, and the HNSW
//     index `tenders_embedding_hnsw_idx` must exist on tenders.embedding.
//     Without the index the query still returns correct rows — it just does a
//     sequential scan over ~20k vectors and gets slow enough to time out.
//   * `search_tenders_hybrid` must be ported with the EXACT 14-argument
//     signature. It exists in four overloads on the source database (5, 10, 13
//     and 14 arg). Postgres resolves overloads by argument list, so porting the
//     wrong one produces "function does not exist" at best and silently
//     different ranking at worst.
//
// Get the authoritative definition from the source database rather than from
// any migration file:
//
//   SELECT pg_get_functiondef(oid)
//     FROM pg_proc
//    WHERE proname = 'search_tenders_hybrid';
//
// Nothing here has been executed.

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

/**
 * The 14-argument search_tenders_hybrid call.
 *
 * NAMED argument notation (`arg => $n`) is used deliberately rather than
 * positional. Positional binding would silently pick a different overload if
 * the argument order on RDS differs from what this file assumes, and the
 * failure mode would be wrong search results rather than an error. Named
 * notation fails loudly instead.
 *
 * $1 may be NULL: when the AI Gateway embed call fails, the original still runs
 * the RPC with a null embedding and degrades to keyword + CPV ranking. Preserve
 * that — it is the function's fallback path, not an error case.
 */
export const SQL_SEARCH_TENDERS_HYBRID = `
  SELECT *
    FROM search_tenders_hybrid(
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

/** pgvector wants '[0.1,0.2,...]'; null stays null so the keyword-only path works. */
export function toVectorLiteral(vec: number[] | null): string | null {
  return vec === null ? null : `[${vec.join(",")}]`;
}

/**
 * Runs SQL_SEARCH_TENDERS_HYBRID and returns the rows.
 *
 * TODO(rds): implement as —
 *   const { rows } = await pool.query(SQL_SEARCH_TENDERS_HYBRID, [
 *     toVectorLiteral(p.query_embedding), p.query_text, p.match_count,
 *     p.since_ts, p.cpv_prefix, p.expansion_terms, p.cpv_prefixes,
 *     p.w_keyword, p.w_cpv, p.w_semantic, p.core_terms, p.context_terms,
 *     p.active_only, p.intent_domain,
 *   ]);
 *   return rows;
 *
 * Note node-postgres maps a JS string[] onto text[] natively, so
 * expansion_terms / cpv_prefixes / core_terms / context_terms pass straight
 * through with no serialisation.
 */
export async function searchTendersHybrid(_params: HybridSearchParams): Promise<any[]> {
  throw new DbNotConfiguredError("searchTendersHybrid");
}
