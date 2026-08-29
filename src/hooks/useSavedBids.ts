import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ContractsFinderNotice } from "@/lib/contractsFinder";

export type BidStatus = "selected" | "created" | "submitted" | "won" | "lost" | "withdrawn";

export interface SavedBid {
  id: string;
  organisation_id: string;
  saved_by: string;
  external_id: string;
  source: string;
  title: string;
  buyer: string | null;
  value: number | null;
  deadline_date: string | null;
  published_date: string | null;
  source_url: string | null;
  description: string | null;
  status: BidStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useSavedBids() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["saved-bids", membership?.organisation_id],
    enabled: !!membership,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_bids")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SavedBid[];
    },
  });
}

export function useSelectBid() {
  const { membership, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: ContractsFinderNotice) => {
      if (!membership || !user) throw new Error("Not signed in");
      const payload = {
        organisation_id: membership.organisation_id,
        saved_by: user.id,
        external_id: n.id,
        source: n.source,
        title: n.title,
        buyer: n.buyer || null,
        value: n.value || n.valueHigh || null,
        deadline_date: n.deadlineDate || null,
        published_date: n.publishedDate || null,
        source_url: n.link || null,
        description: n.description || null,
        status: "selected" as BidStatus,
      };
      const { data, error } = await supabase
        .from("saved_bids")
        .upsert(payload, { onConflict: "organisation_id,external_id,source" })
        .select()
        .single();
      if (error) throw error;
      return data as SavedBid;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-bids"] }),
  });
}

export function useUpdateBidStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status?: BidStatus; notes?: string }) => {
      const patch: { status?: BidStatus; notes?: string } = {};
      if (status) patch.status = status;
      if (notes !== undefined) patch.notes = notes;
      const { error } = await supabase.from("saved_bids").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-bids"] }),
  });
}

export function useDeleteBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_bids").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-bids"] }),
  });
}
