// Sell2Wales / PCS shared ingest routine.
//
// Ported from supabase/functions/_shared/s2w-style.ts. Unlike its two sibling
// helpers this one created its own Supabase client at module scope and read
// Deno.env directly, so it needed converting. Everything below the client line
// — extractCpv, matchesCpv, the CPV prefix list, the notice-type loop, the row
// mapping and the ingest_runs bookkeeping — is unchanged.
//
// NOTE: no function in this batch currently imports ingestS2WStyle. It is
// ported because it lives in _shared and the ingestion set will need it if a
// Sell2Wales ingest is ever added; `contracts_scotland` has its own dedicated
// function (ingest-contracts-scotland) that does not use this path.

import { createDbClient } from "./db";

const TARGET_CPV_PREFIXES = ["72", "73", "79", "80", "85"];

const supabase = createDbClient();

function extractCpv(tender: any): string[] {
  const codes: string[] = [];
  const main = tender?.classification;
  if (main?.scheme === "CPV" && main?.id) codes.push(String(main.id));
  for (const ac of tender?.additionalClassifications ?? []) {
    if (ac?.scheme === "CPV" && ac?.id) codes.push(String(ac.id));
  }
  for (const item of tender?.items ?? []) {
    const ic = item?.classification;
    if (ic?.scheme === "CPV" && ic?.id) codes.push(String(ic.id));
    for (const ac of item?.additionalClassifications ?? []) {
      if (ac?.scheme === "CPV" && ac?.id) codes.push(String(ac.id));
    }
  }
  return Array.from(new Set(codes));
}

function matchesCpv(codes: string[]): boolean {
  return codes.some((c) =>
    TARGET_CPV_PREFIXES.some((p) => c.startsWith(p)),
  );
}

// Both Sell2Wales and PCS share the same API shape.
// Caller passes source key + base URL.
export async function ingestS2WStyle(
  source: "sell2wales" | "contracts_scotland",
  baseUrl: string,
  noticeTypes: number[] = [1, 2, 3, 4, 5, 6, 7],
) {
  const runStart = Date.now();
  const { data: run } = await supabase
    .from("ingest_runs")
    .insert({ source, started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = run!.id;

  const errors: any[] = [];
  let totalUpserted = 0;
  let scanned = 0;

  try {
    const now = new Date();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = now.getUTCFullYear();
    const dateFrom = `${mm}-${yyyy}`;

    for (const noticeType of noticeTypes) {
      const url = new URL(baseUrl);
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("noticeType", String(noticeType));
      url.searchParams.set("outputType", "0");
      url.searchParams.set("locale", "2057");

      let res: Response;
      try {
        res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      } catch (e: any) {
        errors.push({ noticeType, fetchError: e.message });
        continue;
      }
      const ctype = res.headers.get("content-type") ?? "";
      if (!res.ok || !ctype.includes("json")) {
        errors.push({ noticeType, status: res.status, contentType: ctype });
        continue;
      }
      const json: any = await res.json();
      const releases: any[] = json.releases ?? [];
      scanned += releases.length;
      if (releases.length === 0) continue;

      const rows: any[] = [];
      for (const r of releases) {
        const t = r.tender ?? {};
        const cpv = extractCpv(t);
        if (!matchesCpv(cpv)) continue;
        const ext = r.ocid ?? r.id;
        if (!ext) continue;
        const v = t.value ?? {};
        rows.push({
          source,
          external_id: String(ext),
          title: t.title ?? null,
          description: t.description ?? null,
          cpv_codes: cpv,
          buyer_name: r.buyer?.name ?? null,
          value_min: typeof v.amount === "number" ? v.amount : null,
          value_max: typeof v.amount === "number" ? v.amount : null,
          currency: v.currency ?? "GBP",
          source_url: t.documents?.[0]?.url ?? null,
          published_at: r.date ? new Date(r.date).toISOString() : null,
          deadline_at: t.tenderPeriod?.endDate
            ? new Date(t.tenderPeriod.endDate).toISOString()
            : null,
          raw_json: r,
        });
      }

      if (rows.length > 0) {
        const { error } = await supabase
          .from("tenders")
          .upsert(rows, { onConflict: "source,external_id" });
        if (error) errors.push({ noticeType, upsertError: error.message });
        else totalUpserted += rows.length;
      }
    }
  } catch (e: any) {
    errors.push({ fatal: e.message });
  }

  const duration = Date.now() - runStart;
  await supabase
    .from("ingest_runs")
    .update({
      finished_at: new Date().toISOString(),
      count: totalUpserted,
      errors: errors.length ? errors : null,
      duration_ms: duration,
    })
    .eq("id", runId);

  return { run_id: runId, scanned, count: totalUpserted, errors, duration_ms: duration };
}
