import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertLinkedFromRelease, enrichTedTender } from "../_shared/ocds-linked.ts";
import { mirrorTendersToNotices } from "../_shared/notices-mirror.ts";

const TARGET_CPV_PREFIXES = ["72", "73", "79", "80", "85"];

// Cap rows ingested per source per tick to avoid CPU time-outs.
const MAX_ROWS_PER_TICK = 200;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// CPV filter intentionally disabled for backfill — historical notices (esp. 2010-2014)
// often lack consistent CPV codes. We ingest everything and filter at query/display time.
function matchesCpv(_codes: string[]): boolean {
  return true;
}

// TED returns dates like "2023-01-02+01:00" (date + tz offset, no time).
// Convert to a parseable ISO string before calling new Date().
function parseTedDate(v: any): string | null {
  if (!v) return null;
  let s = String(v);
  // If only a date portion (YYYY-MM-DD) followed by an offset, insert T00:00:00.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})([+\-]\d{2}:?\d{2}|Z)?$/);
  if (m) s = `${m[1]}T00:00:00${m[2] ?? "Z"}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function monthRange(year: number, month0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month0, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

function nextMonth(year: number, month0: number): { year: number; month0: number } {
  return month0 === 11
    ? { year: year + 1, month0: 0 }
    : { year, month0: month0 + 1 };
}

function isCurrentOrFuture(year: number, month0: number): boolean {
  const now = new Date();
  const cy = now.getUTCFullYear();
  const cm = now.getUTCMonth();
  return year > cy || (year === cy && month0 >= cm);
}

async function upsertRows(
  rows: any[],
  releases?: any[],
  source?: string,
  countryDefault = "GB",
) {
  if (!rows.length) return 0;
  const { data: upserted, error } = await supabase
    .from("tenders")
    .upsert(rows, { onConflict: "source,external_id" })
    .select("id,source,external_id");
  if (error) throw new Error(error.message);

  // Mirror to legacy notices table.
  try {
    const mr = await mirrorTendersToNotices(supabase, rows);
    if (mr.error) console.warn(`[backfill-tick:${source}] notices mirror error`, mr.error);
  } catch (e: any) {
    console.warn(`[backfill-tick:${source}] notices mirror fatal`, e.message);
  }

  const linkErrors: any[] = [];
  if (releases && source) {
    const idMap = new Map<string, string>();
    for (const u of upserted ?? []) idMap.set(`${u.source}:${u.external_id}`, u.id);
    for (let i = 0; i < releases.length; i++) {
      const r = releases[i];
      const ext = rows[i]?.external_id;
      const tid = idMap.get(`${source}:${ext}`);
      if (!tid) continue;
      try {
        const { errors: errs } = await upsertLinkedFromRelease(supabase, source, r, tid, countryDefault);
        if (errs?.length) linkErrors.push({ ext, errs });
      } catch (e: any) { linkErrors.push({ ext, fatal: e.message }); }
    }
  }
  // For TED, releases is undefined (flat shape) — enrich each row from raw_json.
  if (source === "ted" && upserted) {
    for (let i = 0; i < rows.length; i++) {
      const u = upserted.find((x: any) => x.external_id === rows[i].external_id);
      if (!u) continue;
      try {
        const { errors: errs } = await enrichTedTender(supabase, u.id, rows[i].raw_json);
        if (errs?.length) linkErrors.push({ ext: rows[i].external_id, errs });
      } catch (e: any) { linkErrors.push({ ext: rows[i].external_id, fatal: e.message }); }
    }
  }
  if (linkErrors.length) console.warn(`[backfill-tick:${source}] link errors`, JSON.stringify(linkErrors).slice(0, 2000));
  return rows.length;
}

// ---------- Source-specific fetchers ----------

async function backfillFts(from: string, to: string): Promise<number> {
  let nextUrl: string | null =
    `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages` +
    `?limit=100&updatedFrom=${from}T00:00:00&updatedTo=${to}T23:59:59`;
  let count = 0;
  let pages = 0;
  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) break;
    const json = await res.json();
    const releases: any[] = json.releases ?? [];
    if (!releases.length) break;
    const rows: any[] = [];
    const rels: any[] = [];
    for (const r of releases) {
      const t = r.tender ?? {};
      const items: any[] = t.items ?? [];
      const cpv = items
        .map((it) => it?.classification?.id)
        .filter((x) => typeof x === "string");
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
        value_min: typeof v.amount === "number" ? v.amount : null,
        value_max: typeof v.amount === "number" ? v.amount : null,
        currency: v.currency ?? "GBP",
        source_url: `https://www.find-tender.service.gov.uk/Notice/${ext}`,
        published_at: r.date ? new Date(r.date).toISOString() : null,
        deadline_at: t.tenderPeriod?.endDate
          ? new Date(t.tenderPeriod.endDate).toISOString()
          : null,
        raw_json: r,
        ocid: r.ocid ?? null,
      });
      rels.push(r);
    }
    count += await upsertRows(rows, rels, "fts", "GB");
    if (count >= MAX_ROWS_PER_TICK) break;
    nextUrl = json.links?.next ?? null;
    pages++;
    if (pages > 200) break;
  }
  return count;
}

async function backfillCf(from: string, to: string): Promise<number> {
  let startAt = 0;
  let count = 0;
  while (true) {
    const url = new URL(
      "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search",
    );
    url.searchParams.set("publishedFrom", from);
    url.searchParams.set("publishedTo", to);
    url.searchParams.set("limit", "100");
    url.searchParams.set("startAt", String(startAt));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) break;
    const json = await res.json();
    const releases: any[] = json.results ?? json.releases ?? [];
    if (!releases.length) break;
    const rows: any[] = [];
    const rels: any[] = [];
    for (const r of releases) {
      const t = r.tender ?? {};
      const items: any[] = t.items ?? [];
      const cpv = items
        .map((it) => it?.classification?.id)
        .filter((x) => typeof x === "string");
      if (!matchesCpv(cpv)) continue;
      const ext = r.ocid ?? t.id;
      if (!ext) continue;
      const v = t.value ?? {};
      rows.push({
        source: "cf",
        external_id: String(ext),
        title: t.title ?? null,
        description: t.description ?? null,
        cpv_codes: cpv,
        primary_cpv: cpv[0] ?? null,
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
        ocid: r.ocid ?? null,
      });
      rels.push(r);
    }
    count += await upsertRows(rows, rels, "cf", "GB");
    if (count >= MAX_ROWS_PER_TICK) break;
    if (releases.length < 100) break;
    startAt += 100;
    if (startAt > 20000) break;
  }
  return count;
}

async function backfillTed(from: string, to: string): Promise<number> {
  let page = 1;
  let count = 0;
  while (true) {
    const body = {
      query: `publication-date>=${from.replace(/-/g, "")} AND publication-date<=${to.replace(/-/g, "")}`,
      fields: [
        "publication-number",
        "notice-title",
        "description-lot",
        "classification-cpv",
        "buyer-name",
        "publication-date",
        "deadline-receipt-tender-date-lot",
        "links",
      ],
      page,
      limit: 100,
      scope: "ALL",
    };
    const res = await fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) break;
    const json = await res.json();
    const notices: any[] = json.notices ?? [];
    if (!notices.length) break;
    const rows: any[] = [];
    for (const n of notices) {
      const cpvRaw = n["classification-cpv"];
      const cpv: string[] = (Array.isArray(cpvRaw) ? cpvRaw : [cpvRaw])
        .map((c: any) => (typeof c === "string" ? c : c?.code))
        .filter(Boolean);
      if (!matchesCpv(cpv)) continue;
      const ext = n["publication-number"];
      if (!ext) continue;
      const titleObj = n["notice-title"];
      const title =
        typeof titleObj === "string" ? titleObj : titleObj?.eng ?? null;
      const descObj = n["description-lot"];
      const description =
        typeof descObj === "string" ? descObj : descObj?.eng ?? null;
      rows.push({
        source: "ted",
        external_id: String(ext),
        title,
        description,
        cpv_codes: cpv,
        buyer_name:
          typeof n["buyer-name"] === "string"
            ? n["buyer-name"]
            : n["buyer-name"]?.eng ?? null,
        value_min: null,
        value_max: null,
        currency: "EUR",
        source_url: `https://ted.europa.eu/udl?uri=TED:NOTICE:${ext}`,
        published_at: parseTedDate(n["publication-date"]),
        deadline_at: parseTedDate(n["deadline-receipt-tender-date-lot"]),
        raw_json: n,
      });
    }
    count += await upsertRows(rows);
    if (count >= MAX_ROWS_PER_TICK) break;
    if (notices.length < 100) break;
    page++;
    if (page > 200) break;
  }
  return count;
}

async function backfillOcdsFeed(
  source: "sell2wales" | "contracts_scotland",
  baseUrl: string,
  from: string,
  to: string,
): Promise<number> {
  let page = 1;
  let count = 0;
  while (true) {
    const url = new URL(baseUrl);
    url.searchParams.set("publishedFrom", from);
    url.searchParams.set("publishedTo", to);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "100");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) break;
    const json = await res.json();
    const packages: any[] =
      json.releasePackages ?? json.packages ?? json.results ?? [];
    if (!packages.length) break;
    const rows: any[] = [];
    const rels: any[] = [];
    for (const pkg of packages) {
      for (const r of pkg.releases ?? []) {
        const t = r.tender ?? {};
        const items: any[] = t.items ?? [];
        const cpv = items
          .map((it) => it?.classification?.id)
          .filter((x) => typeof x === "string");
        if (!matchesCpv(cpv)) continue;
        const ext = r.ocid ?? t.id;
        if (!ext) continue;
        const v = t.value ?? {};
        rows.push({
          source,
          external_id: String(ext),
          title: t.title ?? null,
          description: t.description ?? null,
          cpv_codes: cpv,
          primary_cpv: cpv[0] ?? null,
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
          ocid: r.ocid ?? null,
        });
        rels.push(r);
      }
    }
    count += await upsertRows(rows, rels, source, "GB");
    if (count >= MAX_ROWS_PER_TICK) break;
    if (packages.length < 100) break;
    page++;
    if (page > 200) break;
  }
  return count;
}

async function backfillEtendersIreland(from: string, to: string): Promise<number> {
  let page = 1;
  let count = 0;
  while (true) {
    const url = new URL("https://irl.eu-supply.com/api/tender");
    url.searchParams.set("publishedFrom", from);
    url.searchParams.set("publishedTo", to);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", "100");
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) break;
    const json = await res.json();
    const tenders: any[] =
      json.tenders ?? json.results ?? json.items ?? json.data ?? [];
    if (!tenders.length) break;
    const rows: any[] = [];
    for (const t of tenders) {
      const cpvRaw = t.cpvCodes ?? t.cpv ?? [];
      const cpv: string[] = (Array.isArray(cpvRaw) ? cpvRaw : [cpvRaw])
        .map((c: any) => (typeof c === "string" ? c : c?.code ?? c?.id))
        .filter(Boolean);
      if (!matchesCpv(cpv)) continue;
      const ext = t.id ?? t.tenderId ?? t.referenceNumber;
      if (!ext) continue;
      const v = t.estimatedValue ?? t.value ?? {};
      const amount =
        typeof v === "number" ? v : typeof v?.amount === "number" ? v.amount : null;
      rows.push({
        source: "etenders_ireland",
        external_id: String(ext),
        title: t.title ?? t.name ?? null,
        description: t.description ?? null,
        cpv_codes: cpv,
        buyer_name: t.buyer?.name ?? t.contractingAuthority ?? null,
        value_min: amount,
        value_max: amount,
        currency: (typeof v === "object" && v?.currency) || "EUR",
        source_url: t.url ?? t.link ?? null,
        published_at: t.publishedDate
          ? new Date(t.publishedDate).toISOString()
          : null,
        deadline_at: t.deadline ? new Date(t.deadline).toISOString() : null,
        raw_json: t,
      });
    }
    count += await upsertRows(rows);
    if (count >= MAX_ROWS_PER_TICK) break;
    if (tenders.length < 100) break;
    page++;
    if (page > 200) break;
  }
  return count;
}

async function backfillEtendersNi(_from: string, _to: string): Promise<number> {
  // The eTenders NI portal does not expose a date-range JSON API; the historical
  // listing is paginated HTML without reliable date filtering. We skip per-month
  // historical backfill for this source and rely on the daily ingest. Counted as 0.
  return 0;
}

async function runOne(source: string, year: number, month0: number) {
  const { from, to } = monthRange(year, month0);
  switch (source) {
    case "fts":
      return await backfillFts(from, to);
    case "cf":
      return await backfillCf(from, to);
    case "ted":
      return await backfillTed(from, to);
    case "sell2wales":
      return await backfillOcdsFeed(
        "sell2wales",
        "https://www.sell2wales.gov.wales/search/api/1.0/ocdsReleasePackages",
        from,
        to,
      );
    case "contracts_scotland":
      // Public Contracts Scotland API doesn't support date-range filtering on
      // ocdsReleasePackages — only limit/offset over the whole feed. Per-month
      // historical backfill is not possible; the daily ingest covers ongoing data.
      return 0;
    case "etenders_ireland":
      return await backfillEtendersIreland(from, to);
    case "etenders_ni":
      return await backfillEtendersNi(from, to);
    default:
      throw new Error(`Unknown source ${source}`);
  }
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (auth !== Deno.env.get("INGEST_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  // _full sources are handled by the dedicated backfill-source-tick function.
  const { data: states, error } = await supabase
    .from("backfill_state")
    .select("*")
    .eq("completed", false)
    .not("source", "like", "%_full");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results = await Promise.all(
    (states ?? []).map(async (s) => {
      const start = Date.now();
      const { from, to } = monthRange(s.year, s.month0);
      let inserted = 0;
      let err: string | null = null;
      try {
        inserted = await runOne(s.source, s.year, s.month0);
      } catch (e: any) {
        err = e.message;
      }

      const next = nextMonth(s.year, s.month0);
      const completed = isCurrentOrFuture(next.year, next.month0);

      await supabase
        .from("backfill_state")
        .update({
          year: next.year,
          month0: next.month0,
          completed,
          last_run_at: new Date().toISOString(),
        })
        .eq("source", s.source);

      return {
        source: s.source,
        from,
        to,
        inserted,
        error: err,
        next,
        completed,
        duration_ms: Date.now() - start,
      };
    }),
  );

  return Response.json({ results });
});
