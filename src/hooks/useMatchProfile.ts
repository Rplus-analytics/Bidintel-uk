import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { MatchProfile } from "@/lib/signalScore";

export function useMatchProfile() {
  const { membership } = useAuth();
  const orgId = membership?.organisation_id;

  return useQuery({
    queryKey: ["org-match-profile", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<MatchProfile | null> => {
      const { data, error } = await supabase
        .from("org_match_profiles")
        .select("keywords, sectors, regions, cpv_prefixes, min_value, max_value")
        .eq("organisation_id", orgId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        keywords: data.keywords || [],
        sectors: data.sectors || [],
        regions: data.regions || [],
        cpv_prefixes: data.cpv_prefixes || [],
        min_value: data.min_value,
        max_value: data.max_value,
      };
    },
    staleTime: 60_000,
  });
}
