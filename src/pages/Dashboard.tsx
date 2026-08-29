import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  FileText,
  TrendingUp,
  PoundSterling,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ExternalLink,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard";
import { useLiveNotices } from "@/hooks/useLiveNotices";
import { useSavedBids } from "@/hooks/useSavedBids";
import { formatCurrency } from "@/data/mockData";

type PillTone = "amber" | "blue" | "violet" | "red" | "emerald";
const pillClass: Record<PillTone, string> = {
  amber: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  blue: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  violet: "bg-violet-500/15 text-violet-400 border border-violet-500/30",
  red: "bg-red-500/15 text-red-400 border border-red-500/30",
  emerald: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
};

type BidUiStatus = "Drafting" | "Submitted" | "Evaluation" | "Urgent";
function deriveBidStatus(s: string, deadline: string | null): { label: BidUiStatus; tone: PillTone } {
  const daysToDeadline = deadline
    ? Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000)
    : 999;
  if (daysToDeadline >= 0 && daysToDeadline <= 5) return { label: "Urgent", tone: "red" };
  if (s === "submitted") return { label: "Evaluation", tone: "violet" };
  if (s === "won" || s === "lost") return { label: "Evaluation", tone: "violet" };
  if (s === "created") return { label: "Drafting", tone: "amber" };
  return { label: "Drafting", tone: "blue" };
}

export default function Dashboard() {
  const { data, isLoading, isError, refetch } = useLiveNotices({ daysBack: 90, limit: 200 });
  const { data: savedBids = [] } = useSavedBids();
  const notices = data?.notices || [];

  const { pipelineValue, activeBids, winRate, urgentDeadlines, activeRows, deadlineMap } = useMemo(() => {
    const active = savedBids.filter((b) => b.status === "selected" || b.status === "created" || b.status === "submitted");
    const pipelineValue = active.reduce((s, b) => s + (b.value || 0), 0);
    const last12mo = savedBids.filter((b) => {
      const t = new Date(b.updated_at).getTime();
      return t > Date.now() - 365 * 86400000 && (b.status === "won" || b.status === "lost");
    });
    const wins = last12mo.filter((b) => b.status === "won").length;
    const winRate = last12mo.length ? Math.round((wins / last12mo.length) * 100) : 0;

    const now = Date.now();
    const fiveDays = now + 5 * 86400000;
    const urgent = active.filter((b) => {
      if (!b.deadline_date) return false;
      const t = new Date(b.deadline_date).getTime();
      return t >= now && t <= fiveDays;
    });

    const activeRows = active.slice(0, 8).map((b) => ({
      id: b.id,
      title: b.title,
      buyer: b.buyer || "—",
      value: b.value || 0,
      source: b.source,
      ref: b.external_id,
      url: b.source_url,
      status: deriveBidStatus(b.status, b.deadline_date),
    }));

    // deadline map for current month
    const deadlineMap = new Map<string, { count: number; urgent: boolean }>();
    const all = [
      ...active.map((b) => ({ date: b.deadline_date, urgent: true })),
      ...notices.map((n) => ({ date: n.deadlineDate, urgent: false })),
    ];
    for (const d of all) {
      if (!d.date) continue;
      const dt = new Date(d.date);
      const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      const ex = deadlineMap.get(key) || { count: 0, urgent: false };
      ex.count += 1;
      if (d.urgent) ex.urgent = true;
      deadlineMap.set(key, ex);
    }

    return {
      pipelineValue,
      activeBids: active.length,
      winRate,
      urgentDeadlines: urgent.length,
      activeRows,
      deadlineMap,
    };
  }, [savedBids, notices]);

  // Calendar grid
  const calendar = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null; tone: "today" | "urgent" | "standard" | "none"; count: number }> = [];
    for (let i = 0; i < firstDay; i++) cells.push({ day: null, tone: "none", count: 0 });
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${month}-${d}`;
      const info = deadlineMap.get(key);
      const isToday = d === today.getDate();
      let tone: "today" | "urgent" | "standard" | "none" = "none";
      if (isToday) tone = "today";
      else if (info?.urgent) tone = "urgent";
      else if (info) tone = "standard";
      cells.push({ day: d, tone, count: info?.count || 0 });
    }
    return { cells, monthLabel: today.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
  }, [deadlineMap]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bid Command Centre</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Pipeline, Active Bids, Win Rate, Deadlines.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Top metric strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={PoundSterling} label="Pipeline value" value={pipelineValue ? formatCurrency(pipelineValue) : "—"} change={`${activeBids} active bids`} changeType="positive" delay={0} />
        <StatCard icon={FileText} label="Active bids" value={activeBids.toString()} change="Drafting · Submitted · Evaluation" changeType="neutral" delay={80} />
        <StatCard icon={TrendingUp} label="12-mo win rate" value={`${winRate}%`} change="Won vs decided" changeType={winRate >= 50 ? "positive" : "neutral"} delay={160} />
        <StatCard icon={AlertTriangle} label="Urgent deadlines" value={urgentDeadlines.toString()} change="Closing within 5 days" changeType={urgentDeadlines > 0 ? "negative" : "neutral"} delay={240} />
      </div>

      {isLoading && (
        <div className="glass-card p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Loading procurement data…</p>
        </div>
      )}
      {isError && (
        <div className="glass-card p-6 text-center border-destructive/30">
          <p className="text-destructive font-medium text-sm">Failed to load dashboard data</p>
        </div>
      )}

      {/* Active opportunities + Deadline calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="glass-card overflow-hidden xl:col-span-2">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Active opportunities</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Live bids in flight across your team</p>
            </div>
            <Link to="/bid-pipeline" className="text-xs text-primary hover:underline">Open pipeline →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Framework / Ref</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Contracting authority</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Est. value</th>
                  <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                    <td className="px-5 py-3 max-w-sm">
                      <p className="text-sm font-medium line-clamp-1">{r.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wide">{r.source} · {r.ref}</p>
                    </td>
                    <td className="px-5 py-3 text-sm">{r.buyer}</td>
                    <td className="px-5 py-3 text-sm font-medium">{r.value ? formatCurrency(r.value) : "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${pillClass[r.status.tone]}`}>
                        {r.status.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
                {activeRows.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground text-sm">No active bids yet. Save opportunities from Open Bids to get started.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Deadline calendar */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Deadline calendar</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{calendar.monthLabel}</p>
            </div>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <div key={i} className="text-[10px] text-muted-foreground font-medium py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendar.cells.map((c, i) => {
              const base = "aspect-square rounded-md text-xs flex flex-col items-center justify-center relative";
              const cls =
                c.tone === "today" ? "bg-primary text-primary-foreground font-semibold ring-2 ring-primary/40" :
                c.tone === "urgent" ? "bg-red-500/20 text-red-300 border border-red-500/40 font-medium" :
                c.tone === "standard" ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" :
                c.day ? "bg-secondary/40 text-muted-foreground" : "";
              return (
                <div key={i} className={`${base} ${cls}`}>
                  {c.day && <span>{c.day}</span>}
                  {c.count > 0 && c.tone !== "today" && (
                    <span className="text-[9px] opacity-80">{c.count}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500/60" /> Urgent</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500/50" /> Standard</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary" /> Today</span>
          </div>
        </div>
      </div>
    </div>
  );
}
