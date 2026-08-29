import { useMemo } from "react";
import { Loader2, ExternalLink, Calendar, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSavedBids, useUpdateBidStatus, useDeleteBid, type BidStatus, type SavedBid } from "@/hooks/useSavedBids";
import { formatCurrency } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const STAGES: { key: BidStatus; label: string; color: string }[] = [
  { key: "selected", label: "Bid Selected", color: "bg-muted-foreground" },
  { key: "created", label: "Bid Created", color: "bg-chart-2" },
  { key: "submitted", label: "Bid Submitted", color: "bg-warning" },
  { key: "won", label: "Won", color: "bg-success" },
  { key: "lost", label: "Lost", color: "bg-destructive" },
  { key: "withdrawn", label: "Withdrawn", color: "bg-chart-5" },
];

export default function BidPipeline() {
  const { membership } = useAuth();
  const { data: bids, isLoading, isError } = useSavedBids();
  const updateStatus = useUpdateBidStatus();
  const deleteBid = useDeleteBid();

  const grouped = useMemo(() => {
    const map: Record<BidStatus, SavedBid[]> = {
      selected: [], created: [], submitted: [], won: [], lost: [], withdrawn: [],
    };
    for (const b of bids || []) map[b.status].push(b);
    return map;
  }, [bids]);

  if (!membership) {
    return <div className="p-8 text-muted-foreground">Join an organisation to view your pipeline.</div>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Bids</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">
          Bids your team has selected from Contracts. Move them through the pipeline as you work.
        </p>
      </div>

      {isLoading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
        </div>
      )}
      {isError && <div className="glass-card p-8 text-destructive">Failed to load saved bids.</div>}

      {!isLoading && !isError && (bids?.length ?? 0) === 0 && (
        <div className="glass-card p-12 text-center text-sm text-muted-foreground">
          No bids selected yet. Go to <span className="text-primary">Contracts</span> and click{" "}
          <span className="text-primary">Select Bid</span> to add one to your pipeline.
        </div>
      )}

      {!isLoading && !isError && (bids?.length ?? 0) > 0 && (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 min-w-max pb-4">
            {STAGES.map((stage) => {
              const items = grouped[stage.key];
              const total = items.reduce((s, b) => s + (b.value || 0), 0);
              return (
                <div key={stage.key} className="w-72 flex flex-col">
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                    <span className="text-sm font-semibold">{stage.label}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{items.length}</span>
                  </div>
                  <p className="text-xs text-muted-foreground px-1 mb-3">{formatCurrency(total)}</p>
                  <div className="space-y-3 flex-1">
                    {items.map((bid) => (
                      <div key={bid.id} className="glass-card p-4 hover:border-primary/30 transition-colors">
                        <h4 className="text-sm font-medium leading-snug line-clamp-2">{bid.title}</h4>
                        {bid.buyer && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{bid.buyer}</p>}
                        {bid.value && (
                          <p className="text-sm font-semibold text-primary mt-2">{formatCurrency(bid.value)}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                          {bid.deadline_date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(bid.deadline_date).toLocaleDateString("en-GB")}
                            </span>
                          )}
                          <span className="text-[10px] uppercase tracking-wide">{bid.source}</span>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <Select
                            value={bid.status}
                            onValueChange={(v) =>
                              updateStatus.mutate(
                                { id: bid.id, status: v as BidStatus },
                                { onSuccess: () => toast.success("Status updated") },
                              )
                            }
                          >
                            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {STAGES.map((s) => (
                                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              if (confirm("Remove this bid from the pipeline?")) {
                                deleteBid.mutate(bid.id, { onSuccess: () => toast.success("Removed") });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                        {bid.source_url && (
                          <a
                            href={bid.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-3"
                          >
                            View on Source <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">Empty</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
    </div>
  );
}
