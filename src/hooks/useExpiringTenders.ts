import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ExpiringTender {
  id: string;
  source: string;
  external_id: string;
  title: string;
  buyer_name: string | null;
  value_high: number | null;
  value_low: number | null;
  contract_end: string | null;
  deadline_date: string | null;
  source_url: string | null;
  derived_status: string | null;
  /** COALESCE(contract_end, deadline_date) */
  expiry_date: string;
}

export function useExpiringTenders() {
  return useQuery({
    queryKey: ["expiring-tenders-90d"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const now = new Date();
      const lower = new Date(now.getTime() - 30 * 86400000).toISOString();
      const upper = new Date(now.getTime() + 90 * 86400000).toISOString();

      // Pull rows where contract_end falls in the window
      const ceQuery = supabase
        .from("tenders")
        .select(
          "id, source, external_id, title, buyer_name, value_high, value_low, contract_end, deadline_date, source_url, derived_status",
        )
        .not("contract_end", "is", null)
        .gte("contract_end", lower)
        .lte("contract_end", upper)
        .order("contract_end", { ascending: true })
        .limit(2000);

      // Fallback: rows with no contract_end but deadline_date in window
      const dlQuery = supabase
        .from("tenders")
        .select(
          "id, source, external_id, title, buyer_name, value_high, value_low, contract_end, deadline_date, source_url, derived_status",
        )
        .is("contract_end", null)
        .not("deadline_date", "is", null)
        .gte("deadline_date", lower)
        .lte("deadline_date", upper)
        .order("deadline_date", { ascending: true })
        .limit(2000);

      const [ce, dl] = await Promise.all([ceQuery, dlQuery]);
      if (ce.error) throw ce.error;
      if (dl.error) throw dl.error;

      const rows = [...(ce.data || []), ...(dl.data || [])].map((r) => ({
        ...r,
        expiry_date: (r.contract_end || r.deadline_date) as string,
      })) as ExpiringTender[];

      // Dedupe by id, then sort by expiry_date asc
      const seen = new Set<string>();
      const out: ExpiringTender[] = [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
      out.sort((a, b) => +new Date(a.expiry_date) - +new Date(b.expiry_date));
      return out;
    },
  });
}
