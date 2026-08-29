import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertLinkedFromRelease } from "../_shared/ocds-linked.ts";
import { mirrorTendersToNotices } from "../_shared/notices-mirror.ts";

const TARGET_CPV_PREFIXES = ["72", "73", "79", "80", "85"];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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

function pickRegion(tender: any): string | null {
  for (const item of tender?.items ?? []) {
    for (const a of item?.deliveryAddresses ?? []) {
      if (a?.region) return a.region;
    }
  }
  return null;
}

function mapStatus(s: any): string {
  switch (String(s ?? "").toLowerCase()) {
    case "active": return "active";
    case "complete": case "completed": case "unsuccessful": return "complete";
    case "cancelled": case "canceled": return "cancelled";
    case "withdrawn": return "withdrawn";
    case "planned": case "planning": return "planned";
    default: return "unknown";
  }
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (auth !== Deno.env.get("INGEST_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const runStart = Date.now();
  const { data: run } = await supabase
    .from("ingest_runs")
    .insert({ source: "fts", started_at: new Date().toISOString() })
    .select("id")
    .single();
  const runId = run!.id;

  const errors: any[] = [];
  let totalUpserted = 0;
  let scanned = 0;

  try {
    const today = new Date();
    const from = new Date(today.getTime() - 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19);
    const to = today.toISOString().slice(0, 19);

    let nextUrl: string | null =
      `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages` +
      `?limit=100&updatedFrom=${from}&updatedTo=${to}`;

    let pages = 0;
    const maxPages = 50;

    while (nextUrl && pages < maxPages) {
      pages++;
      const res = await fetch(nextUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 BidIntel/1.0",
        },
      });
      if (!res.ok) {
        errors.push({ page: pages, status: res.status, body: (await res.text()).slice(0, 300) });
        break;
      }
      const json = await res.json();
      const releases: any[] = json.releases ?? [];
      scanned += releases.length;
      if (releases.length === 0) break;

      const rows: any[] = [];
      const releasesToLink: any[] = [];
      for (const r of releases) {
        const t = r.tender ?? {};
        const cpv = extractCpv(t);
        if (!matchesCpv(cpv)) continue;
        const ext = r.id ?? r.ocid;
        if (!ext) continue;
        const v = t.value ?? {};
        rows.push({
          source: "fts",
          external_id: String(ext),
          title: t.title ?? null,
          description: t.description ?? null,
          cpv_codes: cpv,
          primary_cpv: cpv[0] ?? null,
          buyer_name: r.buyer?.name ?? null,
          buyer_type: pickRegion(t),
          value_min: typeof v.amount === "number" ? v.amount : null,
          value_max: typeof v.amount === "number" ? v.amount : null,
          currency: v.currency ?? "GBP",
          source_url: `https://www.find-tender.service.gov.uk/Notice/${ext}`,
          published_at: r.date ? new Date(r.date).toISOString() : null,
          deadline_at: t.tenderPeriod?.endDate
            ? new Date(t.tenderPeriod.endDate).toISOString()
            : null,
          contract_start: (r.awards?.[0]?.contractPeriod?.startDate ?? t.contractPeriod?.startDate)
            ? new Date(r.awards?.[0]?.contractPeriod?.startDate ?? t.contractPeriod.startDate).toISOString()
            : null,
          contract_end: (r.awards?.[0]?.contractPeriod?.endDate ?? t.contractPeriod?.endDate)
            ? new Date(r.awards?.[0]?.contractPeriod?.endDate ?? t.contractPeriod.endDate).toISOString()
            : null,
          status: mapStatus(t.status),
          raw_json: r,
          ocid: r.ocid ?? null,
        });
        releasesToLink.push(r);
      }

      if (rows.length > 0) {
        const { data: upserted, error } = await supabase
          .from("tenders")
          .upsert(rows, { onConflict: "source,external_id" })
          .select("id,source,external_id");
        if (error) errors.push({ page: pages, upsertError: error.message });
        else {
          totalUpserted += rows.length;
          const mr = await mirrorTendersToNotices(supabase, rows);
          if (mr.error) errors.push({ page: pages, noticesMirror: mr.error });
          const idMap = new Map<string, string>();
          for (const u of upserted ?? []) idMap.set(`${u.source}:${u.external_id}`, u.id);
          for (const r of releasesToLink) {
            const ext = r.id ?? r.ocid;
            const tid = idMap.get(`fts:${ext}`);
            if (!tid) continue;
            const { errors: linkErrs } = await upsertLinkedFromRelease(supabase, "fts", r, tid, "GB");
            if (linkErrs.length) errors.push({ page: pages, linked: linkErrs });
          }
        }
      }

      nextUrl = json.links?.next ?? null;
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

  return Response.json({ run_id: runId, scanned, count: totalUpserted, errors, duration_ms: duration });
});
