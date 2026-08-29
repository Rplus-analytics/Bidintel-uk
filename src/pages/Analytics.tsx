import { useMemo } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, LineChart, Line } from "recharts";
import { useLiveNotices } from "@/hooks/useLiveNotices";
import { formatCurrency } from "@/data/mockData";

const COLORS = ["hsl(174,62%,47%)", "hsl(199,89%,48%)", "hsl(142,71%,45%)", "hsl(38,92%,50%)", "hsl(262,83%,58%)", "hsl(0,72%,51%)", "hsl(330,80%,55%)", "hsl(20,90%,55%)"];

const tooltipStyle = { background: "hsl(222,47%,9%)", border: "1px solid hsl(222,30%,18%)", borderRadius: 8, color: "hsl(210,40%,96%)" };

export default function Analytics() {
  const { data, isLoading, isError, refetch } = useLiveNotices({ daysBack: 180, limit: 100 });
  const notices = data?.notices || [];

  const { sectorData, sourceData, monthlyData, statusData, totalValue } = useMemo(() => {
    const sectorMap = new Map<string, number>();
    const sourceMap = new Map<string, number>();
    const monthMap = new Map<string, { value: number; count: number }>();
    const statusMap = new Map<string, number>();
    let total = 0;

    for (const n of notices) {
      const v = n.value || n.valueHigh || 0;
      total += v;
      const sector = n.sector || "Unspecified";
      sectorMap.set(sector, (sectorMap.get(sector) || 0) + v);
      sourceMap.set(n.source, (sourceMap.get(n.source) || 0) + 1);
      const status = (n.status || "Unknown").toLowerCase();
      const statusKey = status.includes("award") ? "Awarded" : status.includes("open") || status === "published" ? "Open" : status.includes("clos") ? "Closed" : "Other";
      statusMap.set(statusKey, (statusMap.get(statusKey) || 0) + 1);
      if (n.publishedDate) {
        const d = new Date(n.publishedDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const cur = monthMap.get(key) || { value: 0, count: 0 };
        cur.value += v;
        cur.count += 1;
        monthMap.set(key, cur);
      }
    }

    const sectorData = Array.from(sectorMap.entries())
      .map(([sector, value]) => ({ sector, value: Math.round(value / 1_000_000) }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const sourceData = Array.from(sourceMap.entries()).map(([source, count]) => ({ source, count }));

    const monthlyData = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, v]) => ({
        month: new Date(key + "-01").toLocaleDateString("en-GB", { month: "short" }),
        value: Math.round(v.value / 1_000_000),
        count: v.count,
      }));

    const statusData = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

    return { sectorData, sourceData, monthlyData, statusData, totalValue: total };
  }, [notices]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Live insights across Contracts Finder, PCS, FTS, TED EU, Sell2Wales, eTenders IE & NI (last 180 days)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Aggregating live procurement data...</p>
        </div>
      )}

      {isError && (
        <div className="glass-card p-8 text-center border-destructive/30">
          <p className="text-destructive font-medium">Failed to load analytics</p>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Total Notices</p>
              <p className="text-2xl font-bold mt-1">{notices.length.toLocaleString()}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-2xl font-bold mt-1 text-primary">{formatCurrency(totalValue)}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Sectors</p>
              <p className="text-2xl font-bold mt-1">{sectorData.length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Sources</p>
              <p className="text-2xl font-bold mt-1">{sourceData.length}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <div className="glass-card p-5">
              <h3 className="font-semibold mb-4">Sector Spend Share (£M)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={sectorData} dataKey="value" nameKey="sector" cx="50%" cy="50%" outerRadius={100} label={({ sector, percent }) => `${sector} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {sectorData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card p-5">
              <h3 className="font-semibold mb-4">Notices by Source</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={sourceData}>
                  <XAxis dataKey="source" stroke="hsl(215,20%,55%)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(215,20%,55%)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="hsl(199,89%,48%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card p-5">
              <h3 className="font-semibold mb-4">Monthly Procurement Value (£M)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142,71%,45%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(142,71%,45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="hsl(215,20%,55%)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(215,20%,55%)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="value" stroke="hsl(142,71%,45%)" fill="url(#valueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="glass-card p-5">
              <h3 className="font-semibold mb-4">Monthly Notice Volume</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={monthlyData}>
                  <XAxis dataKey="month" stroke="hsl(215,20%,55%)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(215,20%,55%)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="count" stroke="hsl(38,92%,50%)" strokeWidth={2} dot={{ fill: "hsl(38,92%,50%)", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
