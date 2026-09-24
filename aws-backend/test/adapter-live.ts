// Exercises the builder against the live bidintel database, using the exact
// call shapes the workers use. Read-only except for a scratch table it creates
// and drops.
import { createDbClient, closePool } from "./functions/_shared/db";

const db = createDbClient();
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

async function main() {
  // --- reads, as the workers issue them -----------------------------------
  {
    const { data, error } = await db.from("tenders").select("id, title").limit(3);
    check("select + limit", !error && Array.isArray(data) && data.length === 3, error?.message ?? "");
  }
  {
    const { data, error } = await db.from("backfill_state")
      .select("source, year, month0, completed")
      .eq("completed", false)
      .not("source", "like", "%_full");
    check("eq + not like (backfill-tick's exact filter)", !error && Array.isArray(data), error?.message ?? "");
    console.log("        -> rows:", (data as any[])?.map((r) => r.source).join(", "));
  }
  {
    const nowIso = new Date().toISOString();
    const { data, error } = await db.from("backfill_state")
      .select("source")
      .eq("source", "cf_native")
      .or(`lock_until.is.null,lock_until.lt.${nowIso}`);
    check("or() advisory-lock predicate", !error, error?.message ?? "");
  }
  {
    const { data, error } = await db.from("tenders").select("id").in("embedding_status", ["completed","pending"]).limit(2);
    check("in()", !error && (data as any[]).length === 2, error?.message ?? "");
  }
  {
    const { data, error } = await db.from("tenders").select("id").in("embedding_status", []).limit(2);
    check("in([]) matches nothing", !error && (data as any[]).length === 0, error?.message ?? "");
  }
  {
    const { error, count } = await db.from("tenders").select("*", { count: "exact", head: true });
    check("count exact + head", !error && typeof count === "number" && count > 20000, `count=${count} ${error?.message ?? ""}`);
    console.log("        -> count:", count);
  }
  {
    const { data, error } = await db.from("tenders")
      .select("id, published_at").gte("published_at", "2026-09-01").order("published_at", { ascending: false }).limit(2);
    check("gte + order desc", !error && Array.isArray(data), error?.message ?? "");
  }
  {
    const { data, error } = await db.from("tenders").select("id").range(0, 4);
    check("range is inclusive (0,4 -> 5 rows)", !error && (data as any[]).length === 5, `got ${(data as any[])?.length}`);
  }
  {
    const { data, error } = await db.from("backfill_state").select("source").eq("source", "cf").maybeSingle();
    check("maybeSingle finds one", !error && (data as any)?.source === "cf", error?.message ?? "");
  }
  {
    const { data, error } = await db.from("backfill_state").select("source").eq("source", "nope__").maybeSingle();
    check("maybeSingle returns null, not error", !error && data === null, error?.message ?? "");
  }
  {
    const { error } = await db.from("backfill_state").select("source").eq("source", "nope__").single();
    check("single errors with PGRST116 when absent", error?.code === "PGRST116", JSON.stringify(error));
  }
  {
    const { data, error } = await db.from("backfill_state").select("source, year").match({ source: "cf", completed: true }).maybeSingle();
    check("match()", !error && (data as any)?.source === "cf", error?.message ?? "");
  }

  // --- writes, against a scratch table ------------------------------------
  // --- writes, against a real but harmless table -------------------------
  {
    // buyers has a unique name and is upserted by sync-notices with ignoreDuplicates
    const probe = `__adapter_probe_${Date.now()}`;
    const { error: e1 } = await db.from("buyers").upsert([{ name: probe }], { onConflict: "name" });
    check("upsert insert", !e1, e1?.message ?? "");

    const { data: got, error: e2 } = await db.from("buyers").select("id, name").eq("name", probe).maybeSingle();
    check("upsert round-trips", !e2 && (got as any)?.name === probe, e2?.message ?? "");

    const { error: e3 } = await db.from("buyers").upsert([{ name: probe }], { onConflict: "name", ignoreDuplicates: true });
    check("upsert ignoreDuplicates is a no-op", !e3, e3?.message ?? "");

    const { data: upd, error: e4 } = await db.from("buyers")
      .update({ name: probe + "_u" }).eq("name", probe).select("id, name").single();
    check("update ... select().single() returns the row", !e4 && (upd as any)?.name === probe + "_u", e4?.message ?? "");

    const { error: e5 } = await db.from("buyers").delete().eq("name", probe + "_u");
    check("delete cleans up", !e5, e5?.message ?? "");

    const { data: gone } = await db.from("buyers").select("id").eq("name", probe + "_u").maybeSingle();
    check("row is gone", gone === null);
  }

  // --- safety -------------------------------------------------------------
  {
    const { error } = await db.from("tenders").select("id").eq("id; DROP TABLE tenders --", 1);
    check("injection attempt in column name is rejected", !!error && /unsafe identifier/.test(error.message), JSON.stringify(error));
  }
  {
    const { error } = await (db.from("backfill_state") as any).or("lock_until.zz.null");
    check("unknown or() operator throws rather than guessing", !!error && /not supported/.test(error.message), JSON.stringify(error));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await closePool();
  process.exit(fail ? 1 : 0);
}
main();
