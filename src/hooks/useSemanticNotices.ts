import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SemanticHit } from "./useSemanticSearch";
import type { ContractsFinderNotice } from "@/lib/contractsFinder";
import { resolveSourceUrl } from "@/lib/sourceUrl";
import { buildNoticeDebug } from "@/lib/tenderDebug";


const TENDER_COLS =
  "id,source,external_id,ocid,title,buyer_name,description,value_min,value_max,currency,status,derived_status,published_at,deadline_at,region,sector,primary_cpv,notice_type,source_url,raw_json,contract_start,contract_end";


interface TenderRow {
  id: string;
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
  derived_status: string | null;
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


/**
 * Hydrates ranked semantic hits with full tender rows, preserving RPC order.
 * Renders TED and contracts_scotland records that aren't in the pre-fetched
 * `useStoredNotices` pool (which is scoped to cf+fts).
 */
export function useSemanticNotices(hits: SemanticHit[] | undefined, enabled = true) {
  const ids = (hits || []).map((h) => h.id).filter(Boolean);
  const key = ids.slice(0, 100).join(",");

  return useQuery({
    queryKey: ["semantic-notices", key],
    enabled: enabled && ids.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    queryFn: async (): Promise<ContractsFinderNotice[]> => {
      const { data, error } = await supabase
        .from("tenders")
        .select(TENDER_COLS)
        .in("id", ids);
      if (error) throw error;
      const byId = new Map<string, TenderRow>();
      for (const r of (data as unknown as TenderRow[]) || []) byId.set(r.id, r);

      const ordered: ContractsFinderNotice[] = [];
      for (const h of hits || []) {
        const r = byId.get(h.id);
        if (!r) continue;
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
        ordered.push({
          id: r.external_id,
          title: r.title,
          buyer: r.buyer_name || "",
          description: r.description || "",
          value: r.value_min || 0,
          valueHigh: r.value_max || 0,
          currency: r.currency || "GBP",
          status: r.derived_status || r.status || "",
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
            raw: r.raw_json,
          }),
        });


      }
      return ordered;
    },
  });
}
