import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ContractsFinderNotice } from "@/lib/contractsFinder";
import { resolveSourceUrl } from "@/lib/sourceUrl";
import { buildNoticeDebug } from "@/lib/tenderDebug";


export interface UseStoredNoticesOptions {
  daysBack?: number;
  limit?: number;
  enabled?: boolean;
}

interface DbNoticeRow {
  id: string;
  source: string;
  external_id: string;
  title: string;
  buyer: string | null;
  description: string | null;
  value: number | null;
  value_high: number | null;
  currency: string | null;
  status: string | null;
  published_date: string | null;
  deadline_date: string | null;
  region: string | null;
  sector: string | null;
  cpv_code: string | null;
  notice_type: string | null;
  link: string | null;
  source_url: string | null;
  raw: Record<string, unknown> | null;
}

function rowToNotice(r: DbNoticeRow): ContractsFinderNotice {
  const link = resolveSourceUrl({
    link: r.link,
    source: r.source,
    externalId: r.external_id,
  });
  return {
    id: r.external_id,
    title: r.title,
    buyer: r.buyer || "",
    description: r.description || "",
    value: r.value || 0,
    valueHigh: r.value_high || 0,
    currency: r.currency || "GBP",
    status: r.status || "",
    publishedDate: r.published_date || "",
    deadlineDate: r.deadline_date || "",
    region: r.region || "",
    sector: r.sector || "",
    cpvCode: r.cpv_code || "",
    source: r.source,
    noticeType: r.notice_type || "",
    link,
    debug: buildNoticeDebug({
      link: r.link,
      source: r.source,
      externalId: r.external_id,
      raw: r.raw,
    }),
  };
}





interface DbTenderRow {
  source: string;
  external_id: string;
  ocid: string | null;
  title: string;
  buyer_name: string | null;
  description: string | null;
  value_min: number | null;
  value_max: number | null;
  currency: string | null;
  status: string | null;
  published_at: string | null;
  deadline_at: string | null;
  region: string | null;
  sector: string | null;
  primary_cpv: string | null;
  notice_type: string | null;
  source_url: string | null;
  raw_json: Record<string, unknown> | null;
  contract_start: string | null;
  contract_end: string | null;
}

function tenderToNotice(r: DbTenderRow): ContractsFinderNotice {
  // Pull authoritative OCDS-style flags from raw_json when present (FTS rows).
  // - tag: ["planning"] = PIN/market engagement; ["tenderUpdate"] = amendment of an existing notice
  // - tender.techniques.hasFrameworkAgreement = true → framework ceiling, not awarded spend
  let noticeTag: string[] | undefined;
  let isFramework = false;
  const raw = r.raw_json as
    | { tag?: unknown; tender?: { tag?: unknown; techniques?: { hasFrameworkAgreement?: boolean } } }
    | null;
  if (raw && typeof raw === "object") {
    const topTag = Array.isArray(raw.tag) ? (raw.tag as unknown[]) : null;
    const tenderTag = Array.isArray(raw.tender?.tag) ? (raw.tender!.tag as unknown[]) : null;
    const tags = (topTag || tenderTag || []).filter((x): x is string => typeof x === "string");
    if (tags.length) noticeTag = tags;
    isFramework = raw.tender?.techniques?.hasFrameworkAgreement === true;
  }

  const link = resolveSourceUrl({
    link: r.source_url,
    source: r.source,
    externalId: r.external_id,
    ocid: r.ocid,
  });

  return {
    id: r.external_id,
    title: r.title,
    buyer: r.buyer_name || "",
    description: r.description || "",
    value: r.value_min || 0,
    valueHigh: r.value_max || 0,
    currency: r.currency || "GBP",
    status: r.status || "",
    publishedDate: r.published_at || "",
    deadlineDate: r.deadline_at || "",
    region: r.region || "",
    sector: r.sector || "",
    cpvCode: r.primary_cpv || "",
    source: r.source,
    noticeType: r.notice_type || "",
    link,
    noticeTag,
    isFramework,
    contractStart: r.contract_start || undefined,
    contractEnd: r.contract_end || undefined,
    debug: buildNoticeDebug({
      link: r.source_url,
      source: r.source,
      externalId: r.external_id,
      ocid: r.ocid,
      raw: r.raw_json as Record<string, unknown> | null,
    }),
  };

}




function dedupeKey(n: ContractsFinderNotice): string {
  // Prefer source+external_id (stable across notices/tenders tables).
  // Fall back to title|buyer when external_id is missing.
  if (n.id) return `${(n.source || "").toLowerCase()}|${n.id.toLowerCase()}`;
  return `${(n.title || "").toLowerCase()}|${(n.buyer || "").toLowerCase()}`.trim();
}

const NOTICE_COLS =
  "id,source,external_id,title,buyer,description,value,value_high,currency,status,published_date,deadline_date,region,sector,cpv_code,notice_type,link,source_url,raw";
const TENDER_COLS =
  "source,external_id,ocid,title,buyer_name,description,value_min,value_max,currency,status,published_at,deadline_at,region,sector,primary_cpv,notice_type,source_url,raw_json,contract_start,contract_end";


const PAGE_SIZE = 1000; // PostgREST server-side max-rows cap

async function fetchAllPages<T>(
  table: "notices" | "tenders",
  cols: string,
  dateCol: "published_date" | "published_at",
  fromIso: string | null,
  maxRows: number,
  sourceFilter?: string[],
): Promise<T[]> {
  const all: T[] = [];
  for (let start = 0; start < maxRows; start += PAGE_SIZE) {
    const end = Math.min(start + PAGE_SIZE - 1, maxRows - 1);
    let q = supabase.from(table).select(cols);
    if (fromIso) q = q.gte(dateCol, fromIso);
    if (sourceFilter) q = q.in("source", sourceFilter);
    q = q.order(dateCol, { ascending: false, nullsFirst: false }).range(start, end);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data as unknown as T[]) || [];
    all.push(...rows);
    if (rows.length < end - start + 1) break; // last page
  }
  return all;
}

export function useStoredNotices(opts: UseStoredNoticesOptions = {}) {
  const { daysBack = 180, limit = 1000, enabled = true } = opts;
  const bucketDays = daysBack <= 7 ? 7 : daysBack <= 30 ? 30 : daysBack <= 90 ? 90 : daysBack <= 180 ? 180 : 365;
  const bucketLimit = limit <= 200 ? 200 : limit <= 1000 ? 1000 : limit <= 2000 ? 2000 : limit <= 10000 ? 10000 : 30000;

  return useQuery({
    queryKey: ["stored-notices-combined", bucketDays, bucketLimit, "paged-v5-ccs-nodatefilter"],
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - bucketDays);
      const fromIso = from.toISOString();

      // CCS Digital Outcomes has no publication date from source, so it is
      // fetched separately without the date window (never filtered out by date).
      const [noticeRows, tenderRows, ccsTenderRows] = await Promise.all([
        fetchAllPages<DbNoticeRow>("notices", NOTICE_COLS, "published_date", fromIso, bucketLimit),
        fetchAllPages<DbTenderRow>("tenders", TENDER_COLS, "published_at", fromIso, bucketLimit),
        fetchAllPages<DbTenderRow>("tenders", TENDER_COLS, "published_at", null, bucketLimit, ["ccs_digital_outcomes"]),
      ]);

      const noticeItems = noticeRows.map(rowToNotice);
      const tenderItems = [...tenderRows, ...ccsTenderRows].map(tenderToNotice);

      const seen = new Map<string, ContractsFinderNotice>();
      for (const n of tenderItems) seen.set(dedupeKey(n), n);
      for (const n of noticeItems) {
        const k = dedupeKey(n);
        if (!seen.has(k)) seen.set(k, n);
      }
      const merged = Array.from(seen.values()).sort(
        (a, b) => (b.publishedDate || "").localeCompare(a.publishedDate || ""),
      );

      return {
        notices: merged,
        total: merged.length,
        noticesCount: noticeItems.length,
        tendersCount: tenderItems.length,
        cursor: null,
        uri: "db://notices+tenders",
      };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled,
  });
}
