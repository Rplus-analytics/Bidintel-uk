import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SemanticHit {
  id: string;
  source: string;
  external_id: string;
  title: string;
  buyer_name: string | null;
  semantic_score: number;
  keyword_score: number;
  cpv_score: number;
  bonus_score?: number;
  penalty_score?: number;
  hybrid_score: number;
  matched_terms?: string[] | null;
  matched_cpvs?: string[] | null;
  source_bonus?: number;
  status_bonus?: number;
  derived_status?: string | null;
  final_display_status?: string | null;
  match_quality?: string | null;
  intent_penalty?: number;
  intent_mismatch?: boolean;
}

export interface SemanticExpansion {
  terms: string[];
  cpvs: string[];
  matched: string[];
  domain?: string;
  domainLabel?: string;
  matchedHints?: string[];
  rejectedTerms?: string[];
  rejectedCpvs?: string[];
  allowedDomains?: string[];
  core?: string[];
  context?: string[];
}

export interface SemanticSearchResponse {
  results: SemanticHit[];
  embeddingAvailable: boolean;
  embedError: string | null;
  expansion: SemanticExpansion;
  weights?: { keyword: number; cpv: number; semantic: number };
  count: number;
}

/**
 * Hybrid semantic + keyword + CPV search with query/CPV expansion.
 * Default weights: 50% keyword, 30% CPV, 20% semantic.
 */
export function useSemanticSearch(opts: {
  query: string;
  cpvPrefix?: string | null;
  daysBack?: number;
  enabled?: boolean;
  weights?: { keyword: number; cpv: number; semantic: number };
  activeOnly?: boolean;
}) {
  const { query, cpvPrefix = null, daysBack = 365, enabled = true, weights, activeOnly = true } = opts;
  const trimmed = query.trim();

  return useQuery<SemanticSearchResponse>({
    queryKey: ["semantic-search", trimmed, cpvPrefix, daysBack, weights, activeOnly],
    enabled: enabled && trimmed.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<SemanticSearchResponse>(
        "semantic-search",
        { body: { query: trimmed, cpvPrefix, daysBack, matchCount: 300, weights, activeOnly } },
      );
      if (error) throw error;
      return (
        data ?? {
          results: [],
          embeddingAvailable: false,
          embedError: null,
          expansion: { terms: [], cpvs: [], matched: [] },
          count: 0,
        }
      );
    },
  });
}
