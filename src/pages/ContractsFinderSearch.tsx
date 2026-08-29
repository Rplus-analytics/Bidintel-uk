import { useEffect, useMemo, useState } from "react";
import { Search, Loader2, ExternalLink, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/data/mockData";
import { resolveSourceUrl } from "@/lib/sourceUrl";

type Row = {
  id: string;
  ocid: string;
  release_id: string;
  published_date: string | null;
  payload: any;
};

interface Filters {
  status: string;
  buyer: string;
  cpv: string;
  minValue: string;
  maxValue: string;
  publishedFrom: string;
  publishedTo: string;
}

const EMPTY_FILTERS: Filters = {
  status: "active",
  buyer: "",
  cpv: "",
  minValue: "",
  maxValue: "",
  publishedFrom: "",
  publishedTo: "",
};

const PAGE_SIZE = 50;

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const cls = s === "active"
    ? "badge-live"
    : s === "complete" || s === "completed"
    ? "badge-awarded"
    : s === "cancelled" || s === "withdrawn"
    ? "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/15 text-destructive"
    : "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground";
  return <span className={cls}>{status || "unknown"}</span>;
}

export default function ContractsFinderSearch() {
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<"published_desc" | "published_asc" | "closing_asc" | "closing_desc">("published_desc");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [period, setPeriod] = useState<"7" | "30" | "90" | "365">("30");

  useEffect(() => { setPage(0); }, [submittedSearch, filters, sortBy, period]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["raw-cf-search", submittedSearch, filters, sortBy, period, page],
    queryFn: async () => {
      const sortCol = sortBy.startsWith("closing")
        ? "payload->tender->tenderPeriod->>endDate"
        : "published_date";
      const ascending = sortBy.endsWith("asc");
      const sinceDate = new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("raw_contracts_finder")
        .select("id, ocid, release_id, published_date, payload", { count: "estimated" })
        .gte("published_date", sinceDate)
        .order(sortCol, { ascending, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (submittedSearch.trim()) {
        // Trigram-indexed fields only (title + buyer) for fast search
        const kw = submittedSearch.trim().replace(/[%*,()]/g, " ").trim();
        if (kw) {
          q = q.or(
            `payload->tender->>title.ilike.*${kw}*,payload->buyer->>name.ilike.*${kw}*`
          );
        }
      }
      if (filters.status && filters.status !== "all") {
        q = q.eq("payload->tender->>status", filters.status);
      }
      if (filters.buyer.trim()) {
        q = q.ilike("payload->buyer->>name", `%${filters.buyer.trim()}%`);
      }
      if (filters.cpv.trim()) {
        q = q.like("payload->tender->classification->>id", `${filters.cpv.trim()}%`);
      }
      if (filters.publishedFrom) q = q.gte("published_date", filters.publishedFrom);
      if (filters.publishedTo) q = q.lte("published_date", filters.publishedTo + "T23:59:59");

      const { data, error, count } = await q;
      if (error) throw error;
      let rows = (data || []) as Row[];
      // value filtering client-side (jsonb numeric compare is awkward)
      const minV = filters.minValue ? Number(filters.minValue) : null;
      const maxV = filters.maxValue ? Number(filters.maxValue) : null;
      if (minV != null || maxV != null) {
        rows = rows.filter((r) => {
          const a = Number(r.payload?.tender?.value?.amount ?? 0);
          if (minV != null && a < minV) return false;
          if (maxV != null && a > 0 && a > maxV) return false;
          return true;
        });
      }
      return { rows, count: count ?? 0 };
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(search);
  };

  const activeFilterCount = useMemo(() => {
    let c = 0;
    const f = filters;
    if (f.status && f.status !== "all") c++;
    if (f.buyer) c++;
    if (f.cpv) c++;
    if (f.minValue || f.maxValue) c++;
    if (f.publishedFrom || f.publishedTo) c++;
    return c;
  }, [filters]);

  const openFilters = () => { setDraftFilters(filters); setFiltersOpen(true); };
  const applyFilters = () => { setFilters(draftFilters); setFiltersOpen(false); };
  const resetFilters = () => { setDraftFilters(EMPTY_FILTERS); };

  const rows = data?.rows || [];
  const total = data?.count || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Contracts Finder Search</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            {data ? `${rows.length.toLocaleString()} shown of ${total.toLocaleString()} matching releases` : "Search the full historical Contracts Finder archive"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 self-start sm:self-auto">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as "7" | "30" | "90" | "365")} className="w-full">
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="7">Last 7 Days</TabsTrigger>
          <TabsTrigger value="30">Last 30 Days</TabsTrigger>
          <TabsTrigger value="90">Last 90 Days</TabsTrigger>
          <TabsTrigger value="365">Last 365 Days</TabsTrigger>
        </TabsList>
      </Tabs>

      <form onSubmit={handleSearch} className="glass-card p-3 sm:p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title or buyer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary border-border"
          />
        </div>
        <Button type="submit" size="sm" className="gap-2">
          <Search className="h-4 w-4" /> Search
        </Button>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="published_desc">Published: Newest first</SelectItem>
            <SelectItem value="published_asc">Published: Oldest first</SelectItem>
            <SelectItem value="closing_asc">Closing: Soonest first</SelectItem>
            <SelectItem value="closing_desc">Closing: Latest first</SelectItem>
          </SelectContent>
        </Select>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-2 relative" onClick={openFilters}>
              <SlidersHorizontal className="h-4 w-4" /> Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Search Filters</SheetTitle>
            </SheetHeader>
            <Accordion type="multiple" defaultValue={["status", "buyer", "value", "dates"]} className="mt-4">
              <AccordionItem value="status">
                <AccordionTrigger className="text-sm">Status</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  <Select value={draftFilters.status} onValueChange={(v) => setDraftFilters({ ...draftFilters, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="complete">Complete</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="withdrawn">Withdrawn</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                    </SelectContent>
                  </Select>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="buyer">
                <AccordionTrigger className="text-sm">Buyer & CPV</AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Buyer</Label>
                    <Input placeholder="e.g. NHS, Council" value={draftFilters.buyer}
                      onChange={(e) => setDraftFilters({ ...draftFilters, buyer: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">CPV prefix</Label>
                    <Input placeholder="e.g. 72" value={draftFilters.cpv}
                      onChange={(e) => setDraftFilters({ ...draftFilters, cpv: e.target.value })} />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="value">
                <AccordionTrigger className="text-sm">Contract Value</AccordionTrigger>
                <AccordionContent className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Min (£)</Label>
                    <Input type="number" placeholder="0" value={draftFilters.minValue}
                      onChange={(e) => setDraftFilters({ ...draftFilters, minValue: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Max (£)</Label>
                    <Input type="number" placeholder="No max" value={draftFilters.maxValue}
                      onChange={(e) => setDraftFilters({ ...draftFilters, maxValue: e.target.value })} />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="dates">
                <AccordionTrigger className="text-sm">Published Date</AccordionTrigger>
                <AccordionContent className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={draftFilters.publishedFrom}
                      onChange={(e) => setDraftFilters({ ...draftFilters, publishedFrom: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={draftFilters.publishedTo}
                      onChange={(e) => setDraftFilters({ ...draftFilters, publishedTo: e.target.value })} />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <div className="flex items-center gap-2 mt-4">
              <Button size="sm" onClick={applyFilters}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={resetFilters}>Reset</Button>
            </div>
          </SheetContent>
        </Sheet>
      </form>

      {activeFilterCount > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => { setFilters(EMPTY_FILTERS); setDraftFilters(EMPTY_FILTERS); }}>
            <X className="h-3 w-3" /> Clear filters
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Searching Contracts Finder archive...</p>
        </div>
      )}

      {isError && (
        <div className="glass-card p-8 text-center border-destructive/30">
          <p className="text-destructive font-medium">Search failed</p>
          <p className="text-sm text-muted-foreground mt-1">{(error as Error)?.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="space-y-3">
          {rows.map((r, i) => {
            const t = r.payload?.tender || {};
            const buyer = r.payload?.buyer?.name || "Unknown buyer";
            const amount = Number(t.value?.amount ?? 0);
            const currency = t.value?.currency || "GBP";
            const cpv = t.classification?.id || t.mainProcurementCategory;
            const deadline = t.tenderPeriod?.endDate;
            const link = resolveSourceUrl({
              link: r.payload?.links?.html || r.payload?.tender?.documents?.find((d: any) => /contractsfinder\.service\.gov\.uk\/Notice\//i.test(d?.url))?.url,
              source: "cf",
              releaseId: r.release_id,
              ocid: r.ocid,
            });
            return (
              <div
                key={r.id}
                className="glass-card p-4 sm:p-5 hover:border-primary/30 transition-colors opacity-0 animate-fade-in"
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                      <StatusBadge status={t.status || ""} />
                      {r.payload?.tag?.[0] && <span className="text-xs text-muted-foreground">{r.payload.tag.join(", ")}</span>}
                      <span className="text-xs text-muted-foreground hidden sm:inline">via Contracts Finder</span>
                    </div>
                    <h3 className="font-semibold text-sm sm:text-base leading-snug">{t.title || "Untitled"}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{buyer}</p>
                    {t.description && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 hidden sm:block">{t.description}</p>
                    )}
                    <div className="flex gap-3 sm:gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                      {cpv && <span>CPV: {cpv}</span>}
                      {r.published_date && <span>Published: {new Date(r.published_date).toLocaleDateString("en-GB")}</span>}
                      <span className="hidden sm:inline">OCID: {r.ocid}</span>
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:text-right shrink-0">
                    {amount > 0 && (
                      <p className="text-base sm:text-lg font-bold text-primary">
                        {currency === "GBP" ? formatCurrency(amount) : `${currency} ${amount.toLocaleString()}`}
                      </p>
                    )}
                    {deadline && (
                      <p className="text-xs text-muted-foreground">
                        Deadline: {new Date(deadline).toLocaleDateString("en-GB")}
                      </p>
                    )}
                    <a
                      href={link}
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
          })}

          {rows.length === 0 && (
            <div className="glass-card p-12 text-center">
              <p className="text-muted-foreground">No releases match your filters. Try adjusting them.</p>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {totalPages.toLocaleString()}
              </span>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages || isFetching} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
