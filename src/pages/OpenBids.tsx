import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ExternalLink, RefreshCw, Calendar, Clock, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLiveNotices, type ContractsFinderNotice } from "@/hooks/useLiveNotices";
import { useMatchProfile } from "@/hooks/useMatchProfile";
import { scoreNotice, type SignalResult } from "@/lib/signalScore";
import { SignalBadge } from "@/components/SignalBadge";
import { formatCurrency } from "@/data/mockData";

function LiveStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls = s.includes("open") || s === "published"
    ? "badge-live"
    : s.includes("clos") || s.includes("deadline")
    ? "badge-closing"
    : s.includes("award")
    ? "badge-awarded"
    : "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground";
  return <span className={cls}>{status}</span>;
}

function NoticeCard({ c, i, signal }: { c: ContractsFinderNotice; i: number; signal: SignalResult }) {
  return (
    <div
      className="glass-card p-4 sm:p-5 hover:border-primary/30 transition-colors opacity-0 animate-fade-in"
      style={{ animationDelay: `${i * 30}ms` }}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
            <SignalBadge score={signal.score} reasons={signal.reasons} />
            <LiveStatusBadge status={c.status} />
            <span className="text-xs text-muted-foreground">{c.noticeType}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">via {c.source}</span>
          </div>
          <h3 className="font-semibold text-sm sm:text-base leading-snug">
            <Link to={`/open-bids/${encodeURIComponent(c.id)}`} className="hover:text-primary hover:underline">
              {c.title}
            </Link>
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{c.buyer}</p>
          {c.description && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2 hidden sm:block">{c.description}</p>
          )}
          <div className="flex gap-3 sm:gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
            {c.sector && <span>Sector: {c.sector}</span>}
            {c.publishedDate && <span>Published: {new Date(c.publishedDate).toLocaleDateString("en-GB")}</span>}
            {c.deadlineDate && <span>Deadline: {new Date(c.deadlineDate).toLocaleDateString("en-GB")}</span>}
          </div>
        </div>
        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:text-right shrink-0">
          {(c.value > 0 || c.valueHigh > 0) && (
            <p className="text-base sm:text-lg font-bold text-primary">
              {c.value > 0 ? formatCurrency(c.value) : ""}
              {c.valueHigh > 0 && c.valueHigh !== c.value ? ` - ${formatCurrency(c.valueHigh)}` : ""}
            </p>
          )}
          <a
            href={c.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline bg-primary/10 px-3 py-1.5 rounded-md"
          >
            View on Source <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

type SourceFilter =
  | "all"
  | "contracts-finder"
  | "find-a-tender"
  | "contracts-scotland"
  | "ccs-digital-outcomes";

const SOURCE_OPTIONS: { value: SourceFilter; label: string; match: (src: string) => boolean }[] = [
  { value: "all", label: "All sources", match: () => true },
  {
    value: "contracts-finder",
    label: "Contracts Finder (UK)",
    match: (s) => s === "cf" || s.includes("contracts finder") || s.includes("contractsfinder"),
  },
  {
    value: "find-a-tender",
    label: "Find a Tender (FTS)",
    match: (s) => s === "fts" || s.includes("find a tender") || s.includes("fts"),
  },
  {
    value: "contracts-scotland",
    label: "Public Contracts Scotland",
    match: (s) => s === "contracts_scotland" || s === "pcs" || s.includes("contracts scotland") || s.includes("public contracts scotland"),
  },
  {
    value: "ccs-digital-outcomes",
    label: "CCS Digital Outcomes",
    match: (s) => s === "ccs_digital_outcomes" || s.includes("ccs") || s.includes("digital outcomes"),
  },
];

// Allow notices from all supported UK MVP sources.
function isAllowedSource(src: string): boolean {
  const s = (src || "").toLowerCase();
  return SOURCE_OPTIONS.slice(1).some((o) => o.match(s));
}

type StatusFilter = "all" | "open" | "awarded" | "completed";
type SignalFilter = "all" | "3" | "2" | "1";
type SortBy = "signal" | "date";

type StatusCategory = "open" | "awarded" | "completed" | "other";

function categorizeStatus(c: ContractsFinderNotice): StatusCategory {
  const s = (c.status || "").toLowerCase().trim();
  const nt = (c.noticeType || "").toLowerCase();

  if (s.includes("award") || nt === "award") return "awarded";

  if (s.includes("complet") || s.includes("expired") || s.includes("cancel") || s.includes("closed")) {
    return "completed";
  }
  if (c.deadlineDate) {
    const dl = new Date(c.deadlineDate).getTime();
    if (!isNaN(dl) && dl < Date.now()) return "completed";
  }

  if (s === "open" || s.includes("publish") || s.includes("active") || nt === "tender") return "open";

  return "other";
}

function matchesStatus(c: ContractsFinderNotice, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return categorizeStatus(c) === filter;
}

function BidsList({ period }: { period: "week" | "month" | "year" }) {
  const daysBack = period === "week" ? 7 : period === "month" ? 30 : 365;
  const limit = period === "year" ? 5000 : 1000;
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [signalFilter, setSignalFilter] = useState<SignalFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("signal");
  const { data, isLoading, isError, error, refetch } = useLiveNotices({ daysBack, limit });
  const { data: profile } = useMatchProfile();

  // Restrict to CF + FTS only.
  const allNotices = useMemo(
    () => (data?.notices || []).filter((n) => isAllowedSource(n.source)),
    [data],
  );

  const scored = useMemo(
    () => allNotices.map((n) => ({ n, signal: scoreNotice(n, profile ?? null) })),
    [allNotices, profile],
  );

  const sourceOpt = SOURCE_OPTIONS.find((o) => o.value === source) || SOURCE_OPTIONS[0];
  const filtered = scored.filter(({ n, signal }) => {
    const src = (n.source || "").toLowerCase();
    const sourceMatch = source === "all" || sourceOpt.match(src);
    const statusMatch = matchesStatus(n, status);
    const signalMatch = signalFilter === "all" || signal.score >= Number(signalFilter);
    return sourceMatch && statusMatch && signalMatch;
  });

  const notices = [...filtered].sort((a, b) => {
    if (sortBy === "signal" && a.signal.score !== b.signal.score) {
      return b.signal.score - a.signal.score;
    }
    const da = new Date(a.n.publishedDate).getTime() || 0;
    const db = new Date(b.n.publishedDate).getTime() || 0;
    return db - da;
  });

  const openCount = allNotices.filter((n) => matchesStatus(n, "open")).length;
  const awardedCount = allNotices.filter((n) => matchesStatus(n, "awarded")).length;
  const completedCount = allNotices.filter((n) => matchesStatus(n, "completed")).length;

  const signalCounts = {
    s3: scored.filter((s) => s.signal.score === 3).length,
    s2: scored.filter((s) => s.signal.score >= 2).length,
    s1: scored.filter((s) => s.signal.score >= 1).length,
  };

  const sourceCounts = SOURCE_OPTIONS.reduce<Record<SourceFilter, number>>((acc, opt) => {
    acc[opt.value] =
      opt.value === "all"
        ? allNotices.length
        : allNotices.filter((n) => opt.match((n.source || "").toLowerCase())).length;
    return acc;
  }, {} as Record<SourceFilter, number>);

  if (isLoading) {
    return (
      <div className="glass-card p-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
        <p className="text-muted-foreground">Loading open bids from Contracts Finder &amp; Find a Tender...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="glass-card p-8 text-center border-destructive/30">
        <p className="text-destructive font-medium">Failed to fetch bids</p>
        <p className="text-sm text-muted-foreground mt-1">{(error as Error)?.message}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          Showing {notices.length} of {allNotices.length} tender{allNotices.length !== 1 ? "s" : ""} from Contracts Finder &amp; Find a Tender
        </p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Source:</span>
        <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
          <SelectTrigger className="h-7 text-xs w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label} ({sourceCounts[o.value] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Status:</span>
        <Button variant={status === "all" ? "default" : "outline"} size="sm" onClick={() => setStatus("all")} className="h-7 text-xs">
          All ({allNotices.length})
        </Button>
        <Button variant={status === "open" ? "default" : "outline"} size="sm" onClick={() => setStatus("open")} className="h-7 text-xs">
          Open ({openCount})
        </Button>
        <Button variant={status === "awarded" ? "default" : "outline"} size="sm" onClick={() => setStatus("awarded")} className="h-7 text-xs">
          Awarded ({awardedCount})
        </Button>
        <Button variant={status === "completed" ? "default" : "outline"} size="sm" onClick={() => setStatus("completed")} className="h-7 text-xs">
          Completed ({completedCount})
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">BidIntel:</span>
        <Button variant={signalFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setSignalFilter("all")} className="h-7 text-xs">
          All ({scored.length})
        </Button>
        <Button variant={signalFilter === "3" ? "default" : "outline"} size="sm" onClick={() => setSignalFilter("3")} className="h-7 text-xs">
          3/3 ({signalCounts.s3})
        </Button>
        <Button variant={signalFilter === "2" ? "default" : "outline"} size="sm" onClick={() => setSignalFilter("2")} className="h-7 text-xs">
          2+ ({signalCounts.s2})
        </Button>
        <Button variant={signalFilter === "1" ? "default" : "outline"} size="sm" onClick={() => setSignalFilter("1")} className="h-7 text-xs">
          1+ ({signalCounts.s1})
        </Button>
        <span className="text-xs text-muted-foreground ml-2">Sort:</span>
        <Button variant={sortBy === "signal" ? "default" : "outline"} size="sm" onClick={() => setSortBy("signal")} className="h-7 text-xs">
          BidIntel
        </Button>
        <Button variant={sortBy === "date" ? "default" : "outline"} size="sm" onClick={() => setSortBy("date")} className="h-7 text-xs">
          Date
        </Button>
        {!profile && (
          <Link to="/settings" className="text-xs text-primary hover:underline ml-2">
            Set up matching profile →
          </Link>
        )}
      </div>

      {notices.map(({ n, signal }, i) => (
        <NoticeCard key={`${n.source}-${n.id}-${i}`} c={n} i={i} signal={signal} />
      ))}

      {notices.length === 0 && (
        <div className="glass-card p-12 text-center space-y-2">
          <p className="text-muted-foreground">
            {signalFilter !== "all" && !profile
              ? "BidIntel filter is active but no matching profile is set up — every notice scores 0."
              : signalFilter !== "all"
              ? `No notices match BidIntel ${signalFilter}+ for this period.`
              : "No open bids found for this period."}
          </p>
          {signalFilter !== "all" && !profile && (
            <Link to="/settings" className="inline-block text-xs text-primary hover:underline">
              Set up matching profile →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export default function OpenBids() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Open Bids</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Live public sector tender opportunities across Contracts Finder, PCS and Find a Tender.
          </p>
      </div>

      <Tabs defaultValue="month" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="week" className="gap-2">
            <Clock className="h-4 w-4" /> Last 7 Days
          </TabsTrigger>
          <TabsTrigger value="month" className="gap-2">
            <Calendar className="h-4 w-4" /> Last 30 Days
          </TabsTrigger>
          <TabsTrigger value="year" className="gap-2">
            <CalendarRange className="h-4 w-4" /> Last 1 Year
          </TabsTrigger>
        </TabsList>
        <TabsContent value="week" className="mt-4">
          <BidsList period="week" />
        </TabsContent>
        <TabsContent value="month" className="mt-4">
          <BidsList period="month" />
        </TabsContent>
        <TabsContent value="year" className="mt-4">
          <BidsList period="year" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
