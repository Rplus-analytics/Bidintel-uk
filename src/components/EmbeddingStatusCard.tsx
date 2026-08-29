import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Sparkles, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Stats {
  total: number;
  completed: number;
  pending: number;
  processing: number;
  failed: number;
  skipped: number;
  completed_last_365d: number;
  total_last_365d: number;
}

export default function EmbeddingStatusCard() {
  const [running, setRunning] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<Stats | null>({
    queryKey: ["tender-embedding-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tender_embedding_stats" as never)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data as Stats | null) ?? null;
    },
    refetchInterval: 15_000,
  });

  const runOnce = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("embed-tenders-batch", { body: {} });
      if (error) throw error;
      const r = data as { embedded?: number; failed?: number; claimed?: number };
      toast.success(`Batch done: ${r?.embedded ?? 0} embedded, ${r?.failed ?? 0} failed`);
      refetch();
    } catch (e) {
      toast.error(`Batch failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const pct = data && data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
  const pct365 = data && data.total_last_365d > 0
    ? Math.round((data.completed_last_365d / data.total_last_365d) * 100)
    : 0;

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Semantic Search — Embedding Coverage</h3>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={runOnce} disabled={running} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run batch now
          </Button>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-sm text-muted-foreground py-4">Loading stats…</div>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Overall coverage</span>
              <span>{data.completed.toLocaleString()} / {data.total.toLocaleString()} ({pct}%)</span>
            </div>
            <div className="h-2 rounded bg-secondary overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 mb-1">
              <span>Last 365 days (priority window)</span>
              <span>{data.completed_last_365d.toLocaleString()} / {data.total_last_365d.toLocaleString()} ({pct365}%)</span>
            </div>
            <div className="h-2 rounded bg-secondary overflow-hidden">
              <div className="h-full bg-success transition-all" style={{ width: `${pct365}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <Stat label="Completed" value={data.completed} tone="success" />
            <Stat label="Pending" value={data.pending} tone="muted" />
            <Stat label="Processing" value={data.processing} tone="primary" />
            <Stat label="Failed" value={data.failed} tone="destructive" />
            <Stat label="Skipped" value={data.skipped} tone="muted" />
          </div>

          <p className="text-xs text-muted-foreground">
            A background worker embeds up to 50 tenders/min, newest first. Search falls back to keyword + CPV ranking when embeddings aren't ready yet.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "primary" | "muted" | "destructive" }) {
  const cls = tone === "success" ? "text-success" : tone === "primary" ? "text-primary" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="p-3 rounded-lg bg-secondary">
      <p className={`text-lg font-bold ${cls}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
