// ============================================================================
// A PostgREST-shaped query builder over `pg`
// ============================================================================
//
// The sixteen ingestion and backfill workers were ported from Deno with their
// database calls left exactly as they were written against supabase-js:
//
//   await db.from("tenders").upsert(rows, { onConflict: "ocid" })
//   await db.from("backfill_state").update({...}).eq("source", s).select().single()
//
// Rewriting those call sites as SQL would mean touching all sixteen functions
// and re-reviewing logic that is already correct. Instead this translates that
// (small, closed) subset of the builder into SQL, so every call site stays
// byte-identical and only the transport underneath changes.
//
// SCOPE IS DELIBERATELY NARROW. It implements what the workers actually call,
// measured by grepping them, and nothing else:
//
//   select insert upsert update delete
//   eq neq in gte lte gt lt or not match
//   order range limit single maybeSingle
//   select("*", { count: "exact", head: true })
//
// An unsupported operator throws by name rather than silently producing wrong
// SQL. That matters more here than completeness: a filter that is quietly
// dropped turns "update this one row" into "update every row".
//
// RETURN SHAPE is supabase-js's `{ data, error }`, never a throw, because every
// call site checks `error` rather than using try/catch.

import type { PoolClient } from "pg";

export interface Result<T = any> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

type Cond = { sql: string; values: any[] };

// Identifiers cannot be parameterised, so they are validated instead. Anything
// that is not a plain lower_snake identifier (optionally schema-qualified) is
// rejected outright rather than escaped — the workers only ever use literal
// table and column names, so a value failing this is a bug, not input.
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function ident(name: string): string {
  const n = name.trim();
  if (!IDENT.test(n)) throw new Error(`unsafe identifier: ${JSON.stringify(name)}`);
  return `"${n}"`;
}

/** `"id, source, raw_json"` -> `"id", "source", "raw_json"`; `*` stays `*`. */
function columnList(cols: string): string {
  const t = cols.trim();
  if (t === "" || t === "*") return "*";
  return t.split(",").map((c) => ident(c)).join(", ");
}

export class QueryBuilder<T = any> implements PromiseLike<Result<T>> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private columns = "*";
  private rows: any[] = [];
  private patch: Record<string, any> = {};
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private conds: Cond[] = [];
  private orderBy: string[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private countExact = false;
  private headOnly = false;
  // An explicit .select() after a write means RETURNING.
  private returning = false;

  // A builder-time failure (a bad identifier, an unsupported operator) is
  // recorded rather than thrown. Call sites destructure `{ data, error }` and
  // never wrap the chain in try/catch, so a synchronous throw from .eq() would
  // escape as an unhandled exception instead of the error they check.
  private buildError: string | null = null;

  constructor(private table: string, private run: (sql: string, values: any[]) => Promise<any[]>) {}

  private guard<R>(fn: () => R, fallback: R): R {
    if (this.buildError) return fallback;
    try {
      return fn();
    } catch (e: any) {
      this.buildError = e?.message || String(e);
      return fallback;
    }
  }

  // --- shape -------------------------------------------------------------

  select(cols = "*", opts?: { count?: string; head?: boolean }): this {
    if (this.op === "select") {
      this.columns = cols;
    } else {
      // .update(...).select() -> RETURNING
      this.returning = true;
      this.columns = cols;
    }
    if (opts?.count === "exact") this.countExact = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(rows: any): this {
    this.op = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = "upsert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts?.onConflict ?? null;
    // NOT cosmetic. `ignoreDuplicates: true` is DO NOTHING — an existing row is
    // left exactly as it is. The default is DO UPDATE, which overwrites it.
    // sync-notices relies on this: it mirrors notices from several sources and
    // must not let a later, thinner record clobber a richer one already stored.
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
    return this;
  }

  update(patch: Record<string, any>): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }

  delete(): this {
    this.op = "delete";
    return this;
  }

  // --- filters -----------------------------------------------------------

  private cmp(col: string, operator: string, value: any): this {
    return this.guard(() => this.cmpUnsafe(col, operator, value), this);
  }

  private cmpUnsafe(col: string, operator: string, value: any): this {
    if (value === null && (operator === "=" || operator === "<>")) {
      this.conds.push({ sql: `${ident(col)} IS ${operator === "=" ? "" : "NOT "}NULL`, values: [] });
      return this;
    }
    this.conds.push({ sql: `${ident(col)} ${operator} ?`, values: [value] });
    return this;
  }

  eq(col: string, v: any): this { return this.cmp(col, "=", v); }
  neq(col: string, v: any): this { return this.cmp(col, "<>", v); }
  gt(col: string, v: any): this { return this.cmp(col, ">", v); }
  gte(col: string, v: any): this { return this.cmp(col, ">=", v); }
  lt(col: string, v: any): this { return this.cmp(col, "<", v); }
  lte(col: string, v: any): this { return this.cmp(col, "<=", v); }

  in(col: string, values: any[]): this {
    return this.guard(() => this.inUnsafe(col, values), this);
  }

  private inUnsafe(col: string, values: any[]): this {
    if (!Array.isArray(values) || values.length === 0) {
      // PostgREST's `in.()` matches nothing. `IN ()` is a syntax error in SQL,
      // so it becomes a constant false — same result, valid statement.
      this.conds.push({ sql: "false", values: [] });
      return this;
    }
    this.conds.push({ sql: `${ident(col)} = ANY(?)`, values: [values] });
    return this;
  }

  is(col: string, v: any): this {
    return this.guard(() => this.isUnsafe(col, v), this);
  }

  private isUnsafe(col: string, v: any): this {
    if (v !== null) throw new Error(`.is() supports only null (got ${JSON.stringify(v)})`);
    this.conds.push({ sql: `${ident(col)} IS NULL`, values: [] });
    return this;
  }

  like(col: string, pattern: string): this { return this.cmp(col, "LIKE", pattern); }
  ilike(col: string, pattern: string): this { return this.cmp(col, "ILIKE", pattern); }

  /** `.not("raw_json", "is", null)` and `.not("source", "like", "%_full")`. */
  not(col: string, operator: string, v: any): this {
    return this.guard(() => this.notUnsafe(col, operator, v), this);
  }

  private notUnsafe(col: string, operator: string, v: any): this {
    switch (operator) {
      case "is":
        if (v !== null) throw new Error(`.not(col,"is",...) supports only null`);
        this.conds.push({ sql: `${ident(col)} IS NOT NULL`, values: [] });
        return this;
      case "like":
        this.conds.push({ sql: `${ident(col)} NOT LIKE ?`, values: [v] });
        return this;
      case "ilike":
        this.conds.push({ sql: `${ident(col)} NOT ILIKE ?`, values: [v] });
        return this;
      case "eq":
        this.conds.push({ sql: `${ident(col)} IS DISTINCT FROM ?`, values: [v] });
        return this;
      default:
        throw new Error(`.not() operator not supported: ${operator}`);
    }
  }

  /** `{ source: "cf", year: 2026 }` -> `source = $1 AND year = $2`. */
  match(q: Record<string, any>): this {
    for (const [k, v] of Object.entries(q)) this.eq(k, v);
    return this;
  }

  /**
   * PostgREST's `.or()`, supporting only the one form the workers use:
   *
   *   .or(`lock_until.is.null,lock_until.lt.${nowIso}`)
   *
   * This is the advisory-lock predicate in ingest-cf-native and backfill-tick.
   * Getting it wrong means two concurrent ticks both believe they hold the
   * lock, so it is parsed strictly and throws on anything unrecognised rather
   * than guessing.
   */
  or(filter: string): this {
    return this.guard(() => this.orUnsafe(filter), this);
  }

  private orUnsafe(filter: string): this {
    const parts = filter.split(",").map((p) => p.trim()).filter(Boolean);
    const sqls: string[] = [];
    const values: any[] = [];
    for (const p of parts) {
      const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-z]+)\.(.*)$/.exec(p);
      if (!m) throw new Error(`.or() clause not parseable: ${JSON.stringify(p)}`);
      const [, col, opName, rawVal] = m;
      switch (opName) {
        case "is":
          if (rawVal !== "null") throw new Error(`.or() is.<x> supports only null: ${p}`);
          sqls.push(`${ident(col)} IS NULL`);
          break;
        case "eq": sqls.push(`${ident(col)} = ?`); values.push(rawVal); break;
        case "neq": sqls.push(`${ident(col)} <> ?`); values.push(rawVal); break;
        case "lt": sqls.push(`${ident(col)} < ?`); values.push(rawVal); break;
        case "lte": sqls.push(`${ident(col)} <= ?`); values.push(rawVal); break;
        case "gt": sqls.push(`${ident(col)} > ?`); values.push(rawVal); break;
        case "gte": sqls.push(`${ident(col)} >= ?`); values.push(rawVal); break;
        default: throw new Error(`.or() operator not supported: ${opName} in ${p}`);
      }
    }
    this.conds.push({ sql: `(${sqls.join(" OR ")})`, values });
    return this;
  }

  // --- modifiers ---------------------------------------------------------

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    return this.guard(() => this.orderUnsafe(col, opts), this);
  }

  private orderUnsafe(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const dir = opts?.ascending === false ? "DESC" : "ASC";
    const nulls = opts?.nullsFirst === true ? " NULLS FIRST" : " NULLS LAST";
    this.orderBy.push(`${ident(col)} ${dir}${nulls}`);
    return this;
  }

  limit(n: number): this { this.limitN = n; return this; }

  /** PostgREST ranges are INCLUSIVE at both ends. */
  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  single(): this { this.wantSingle = true; return this; }
  maybeSingle(): this { this.wantMaybeSingle = true; return this; }

  // --- compilation -------------------------------------------------------

  private where(): { sql: string; values: any[] } {
    if (this.conds.length === 0) return { sql: "", values: [] };
    const values: any[] = [];
    const parts = this.conds.map((c) => {
      let s = c.sql;
      for (const v of c.values) {
        values.push(v);
        s = s.replace("?", `$${values.length}`);
      }
      return s;
    });
    return { sql: ` WHERE ${parts.join(" AND ")}`, values };
  }

  private compile(): { sql: string; values: any[] } {
    const t = ident(this.table);

    if (this.op === "select") {
      const w = this.where();
      if (this.countExact && this.headOnly) {
        return { sql: `SELECT count(*)::int AS __count FROM ${t}${w.sql}`, values: w.values };
      }
      let sql = `SELECT ${columnList(this.columns)} FROM ${t}${w.sql}`;
      if (this.orderBy.length) sql += ` ORDER BY ${this.orderBy.join(", ")}`;
      if (this.limitN != null) sql += ` LIMIT ${Number(this.limitN)}`;
      if (this.offsetN != null) sql += ` OFFSET ${Number(this.offsetN)}`;
      return { sql, values: w.values };
    }

    if (this.op === "insert" || this.op === "upsert") {
      if (this.rows.length === 0) return { sql: "SELECT 1 WHERE false", values: [] };
      // Union of keys across rows: the workers build row objects from upstream
      // payloads where an optional field can be absent in some rows. Taking
      // only the first row's keys would silently drop those columns.
      const cols = Array.from(new Set(this.rows.flatMap((r) => Object.keys(r))));
      const values: any[] = [];
      const tuples = this.rows.map((r) => {
        const ph = cols.map((c) => {
          values.push(r[c] === undefined ? null : r[c]);
          return `$${values.length}`;
        });
        return `(${ph.join(", ")})`;
      });
      let sql = `INSERT INTO ${t} (${cols.map(ident).join(", ")}) VALUES ${tuples.join(", ")}`;
      if (this.op === "upsert") {
        if (this.onConflict) {
          const target = this.onConflict.split(",").map((c) => ident(c)).join(", ");
          const sets = cols
            .filter((c) => !this.onConflict!.split(",").map((x) => x.trim()).includes(c))
            .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
          sql += (sets.length && !this.ignoreDuplicates)
            ? ` ON CONFLICT (${target}) DO UPDATE SET ${sets.join(", ")}`
            : ` ON CONFLICT (${target}) DO NOTHING`;
        } else {
          sql += " ON CONFLICT DO NOTHING";
        }
      }
      if (this.returning || this.wantSingle || this.wantMaybeSingle) {
        sql += ` RETURNING ${columnList(this.columns)}`;
      }
      return { sql, values };
    }

    if (this.op === "update") {
      const values: any[] = [];
      const sets = Object.entries(this.patch).map(([k, v]) => {
        values.push(v);
        return `${ident(k)} = $${values.length}`;
      });
      if (sets.length === 0) throw new Error("update() with no columns");
      // WHERE placeholders must continue the same numbering as SET.
      const w = this.conds.length
        ? (() => {
            const parts = this.conds.map((c) => {
              let s = c.sql;
              for (const v of c.values) {
                values.push(v);
                s = s.replace("?", `$${values.length}`);
              }
              return s;
            });
            return ` WHERE ${parts.join(" AND ")}`;
          })()
        : "";
      let sql = `UPDATE ${t} SET ${sets.join(", ")}${w}`;
      if (this.returning || this.wantSingle || this.wantMaybeSingle) {
        sql += ` RETURNING ${columnList(this.columns)}`;
      }
      return { sql, values };
    }

    // delete
    const w = this.where();
    let sql = `DELETE FROM ${t}${w.sql}`;
    if (this.returning || this.wantSingle || this.wantMaybeSingle) {
      sql += ` RETURNING ${columnList(this.columns)}`;
    }
    return { sql, values: w.values };
  }

  async exec(): Promise<Result<T>> {
    if (this.buildError) return { data: null, error: { message: this.buildError } };

    let sql: string;
    let values: any[];
    try {
      ({ sql, values } = this.compile());
    } catch (e: any) {
      // A compile failure is a programming error, but it is still returned in
      // the `error` channel so the call sites' existing handling applies.
      return { data: null, error: { message: e?.message || String(e) } };
    }

    try {
      const rows = await this.run(sql, values);

      if (this.countExact && this.headOnly) {
        return { data: null, error: null, count: rows[0]?.__count ?? 0 };
      }

      if (this.wantSingle) {
        if (rows.length !== 1) {
          // Matches PostgREST's PGRST116, which several call sites rely on to
          // detect "the optimistic-concurrency check matched no row".
          return {
            data: null,
            error: {
              message: `JSON object requested, multiple (or no) rows returned (got ${rows.length})`,
              code: "PGRST116",
            },
          };
        }
        return { data: rows[0] as T, error: null };
      }

      if (this.wantMaybeSingle) {
        if (rows.length > 1) {
          return {
            data: null,
            error: { message: `multiple rows returned (got ${rows.length})`, code: "PGRST116" },
          };
        }
        return { data: (rows[0] ?? null) as T, error: null };
      }

      return { data: rows as unknown as T, error: null, count: this.countExact ? rows.length : undefined };
    } catch (e: any) {
      return { data: null, error: { message: e?.message || String(e), code: e?.code } };
    }
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((v: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}
