import { useEffect, useMemo, useState } from "react";

import {
  Search,
  Loader2,
  ExternalLink,
  RefreshCw,
  BookmarkPlus,
  BookmarkCheck,
  SlidersHorizontal,
  X,
  EyeOff,
  Eye,
  Save,
} from "lucide-react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";

import { useStoredNotices } from "@/hooks/useStoredNotices";
import { formatCurrency } from "@/data/mockData";
import { useSavedBids, useSelectBid } from "@/hooks/useSavedBids";
import { useMatchProfile } from "@/hooks/useMatchProfile";
import { scoreNotice } from "@/lib/signalScore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { SearchAutocomplete } from "@/components/SearchAutocomplete";
import { RecentSearches, pushRecentSearch, readRecentSearches } from "@/components/RecentSearches";
import { useSemanticSearch } from "@/hooks/useSemanticSearch";
import { useSemanticNotices } from "@/hooks/useSemanticNotices";
import { Sparkles, Loader2 as Loader2Icon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SearchLoadingState } from "@/components/SearchLoadingState";
import { AutocompleteInput, type AutocompleteSuggestion } from "@/components/filters/AutocompleteInput";
import {
  BuyerAutocomplete,
  SupplierAutocomplete,
  FrameworkAutocomplete,
  CpvAutocomplete,
} from "@/components/filters/SharedAutocompletes";
import {
  SERVICE_CATEGORIES,
  POPULAR_CATEGORIES,
  POPULAR_FRAMEWORKS,
  DATE_PRESETS,
  VALUE_BANDS,
  filterKeywordSuggestions,
  findCategoryByCpv,
  getDefaultPublishedFrom,
} from "@/lib/searchTaxonomy";

type SourceFilter = "all" | "contracts-finder" | "find-a-tender" | "contracts-scotland" | "ccs-digital-outcomes";
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
    match: (s) =>
      s === "contracts_scotland" ||
      s === "pcs" ||
      s.includes("contracts scotland") ||
      s.includes("public contracts scotland"),
  },
  {
    value: "ccs-digital-outcomes",
    label: "CCS Digital Outcomes",
    match: (s) => s === "ccs_digital_outcomes" || s.includes("ccs") || s.includes("digital outcomes"),
  },
];

const STAGE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closing", label: "Closing soon" },
  { value: "awarded", label: "Award Notice" },
  { value: "planning", label: "Planning / PIN" },
  { value: "closed", label: "Closed" },
];

interface Filters {
  keyword: string;
  stages: string[];
  buyer: string;
  supplier: string;
  minValue: string;
  maxValue: string;
  publishedFrom: string;
  publishedTo: string;
  deadlineFrom: string;
  deadlineTo: string;
  minScore: string;
  framework: string;
  cpv: string;
  noticeType: string;
  showHidden: boolean;
}

const EMPTY_FILTERS: Filters = {
  keyword: "",
  stages: [],
  buyer: "",
  supplier: "",
  minValue: "",
  maxValue: "",
  publishedFrom: "",
  publishedTo: "",
  deadlineFrom: "",
  deadlineTo: "",
  minScore: "0",
  framework: "",
  cpv: "",
  noticeType: "",
  showHidden: false,
};

// Default initial state applied when the user opens Contracts Search with no
// keyword and no filters. Reuses the existing Published Date filter — just
// pre-selects the configured preset (Past 30 Days by default).
function getDefaultFilters(): Filters {
  return { ...EMPTY_FILTERS, publishedFrom: getDefaultPublishedFrom() };
}

const HIDDEN_KEY = "contracts:hidden-notices";
function loadHidden(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveHidden(s: Set<string>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(s)));
}

const SAVED_SEARCHES_KEY = "contracts:saved-searches";
interface SavedSearch {
  id: string;
  name: string;
  keyword: string;
  source: SourceFilter;
  filters: Filters;
  createdAt: number;
}
function loadSavedSearches(): SavedSearch[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) || "[]");
  } catch {
    return [];
  }
}
function persistSavedSearches(list: SavedSearch[]) {
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list));
}

// Returns true when a saved-search payload carries no explicit criteria.
// Used to fall back to the default Past 30 Days view.
function isEmptyAppliedSearch(keyword: string, filters: Filters): boolean {
  if (keyword && keyword.trim()) return false;
  const f = filters;
  return !(
    f.buyer ||
    f.supplier ||
    f.minValue ||
    f.maxValue ||
    f.publishedFrom ||
    f.publishedTo ||
    f.deadlineFrom ||
    f.deadlineTo ||
    f.framework ||
    f.cpv ||
    f.noticeType ||
    (f.stages && f.stages.length > 0)
  );
}
function withDefaultsIfEmpty(keyword: string, filters: Filters): Filters {
  return isEmptyAppliedSearch(keyword, filters) ? getDefaultFilters() : filters;
}

type LifecycleStatus = "active" | "closing-soon" | "planned" | "complete" | "cancelled" | "withdrawn";

function resolveLifecycleStatus(notice: {
  status?: string | null;
  deadlineDate?: string | null;
  noticeType?: string | null;
  awardDate?: string | null;
  publishedDate?: string | null;
}): LifecycleStatus {
  const raw = (notice.status || "").toLowerCase().trim();
  const noticeType = (notice.noticeType || "").toLowerCase().trim();
  const deadlineMs = notice.deadlineDate ? new Date(notice.deadlineDate).getTime() : 0;
  const awardMs = notice.awardDate ? new Date(notice.awardDate).getTime() : 0;
  const publishedMs = notice.publishedDate ? new Date(notice.publishedDate).getTime() : 0;
  const now = Date.now();
  const hasFutureDeadline = Number.isFinite(deadlineMs) && deadlineMs > now;
  const closingSoon = hasFutureDeadline && deadlineMs <= now + 14 * 24 * 60 * 60 * 1000;

  // Explicit lifecycle signals (highest priority for terminal states)
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("withdraw")) return "withdrawn";
  if (noticeType.includes("cancel")) return "cancelled";
  if (noticeType.includes("withdraw")) return "withdrawn";

  // Rule 2: award_date present → complete
  if (awardMs && Number.isFinite(awardMs)) return "complete";

  // Rule 1: future deadline → active (or closing soon)
  if (hasFutureDeadline) return closingSoon ? "closing-soon" : "active";

  // Other explicit status signals
  if (raw.includes("plan") || raw.includes("pin") || raw.includes("prior")) return "planned";
  if (raw.includes("clos") || raw.includes("deadline")) return "closing-soon";
  if (raw === "active" || raw === "open" || raw === "published" || raw === "live") return "active";
  if (raw === "complete" || raw === "completed" || raw === "closed" || raw === "expired" || raw.includes("award"))
    return "complete";

  if (noticeType.startsWith("pin") || noticeType.includes("planning") || noticeType.includes("prior")) return "planned";
  if (noticeType.startsWith("can") || noticeType.includes("award") || noticeType.includes("contract"))
    return "complete";
  if (noticeType.startsWith("cn") && hasFutureDeadline) return "active";

  // Past deadline → complete
  if (deadlineMs) return "complete";

  // Rule 3: stale (no deadline, no award, published >180 days ago) → complete
  const staleCutoff = now - 180 * 24 * 60 * 60 * 1000;
  if (publishedMs && Number.isFinite(publishedMs) && publishedMs < staleCutoff) return "complete";

  // Default: never render a blank lifecycle badge.
  return "complete";
}

function LiveStatusBadge({ status }: { status: LifecycleStatus }) {
  const label = status === "closing-soon" ? "Closing Soon" : status.charAt(0).toUpperCase() + status.slice(1);
  const cls =
    status === "active"
      ? "badge-live"
      : status === "closing-soon"
        ? "badge-closing"
        : status === "complete"
          ? "badge-awarded"
          : status === "planned"
            ? "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
            : status === "cancelled" || status === "withdrawn"
              ? "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive"
              : "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground";
  return <span className={cls}>{label}</span>;
}

function ScoreBadge({ score, reasons }: { score: number; reasons?: string[] }) {
  if (score <= 0) return null;
  const label = score >= 3 ? "High Match" : score === 2 ? "Medium Match" : "Low Match";
  const cls =
    score >= 3
      ? "bg-success/15 text-success"
      : score === 2
        ? "bg-primary/15 text-primary"
        : "bg-muted text-muted-foreground";
  const tip =
    reasons && reasons.length
      ? `Matched on: ${reasons.join(" · ")}`
      : "Based on your organisation's Match Profile (keywords, sector/CPV, region/value).";
  return (
    <span title={tip} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <Sparkles className="h-3 w-3" />
      {label}
    </span>
  );
}

// ---------- Filter typeahead subcomponents ----------
function KeywordAutocomplete({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const suggestions: AutocompleteSuggestion[] = filterKeywordSuggestions(value).map((s) => ({ value: s }));
  return <AutocompleteInput value={value} onChange={onChange} suggestions={suggestions} placeholder={placeholder} />;
}
// Buyer / Supplier / Framework / CPV autocompletes are imported from
// @/components/filters/SharedAutocompletes so the same components power both
// the Contracts Search filters and the Create Saved Search dialog.

export default function Contracts() {
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [semanticMode, setSemanticMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("contracts:semantic-mode") !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("contracts:semantic-mode", semanticMode ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, [semanticMode]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<SourceFilter>("all");
  const [filters, setFilters] = useState<Filters>(() => getDefaultFilters());
  const [draftFilters, setDraftFilters] = useState<Filters>(() => getDefaultFilters());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden());
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => loadSavedSearches());
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    persistSavedSearches(savedSearches);
  }, [savedSearches]);

  useEffect(() => {
    setRecentSearches(readRecentSearches());
    const handler = () => setRecentSearches(readRecentSearches());
    window.addEventListener("recent-searches:changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("recent-searches:changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const incoming = (location.state as { applySavedSearch?: SavedSearch } | null)?.applySavedSearch;
    if (incoming) {
      const nextFilters = withDefaultsIfEmpty(incoming.keyword, incoming.filters);
      setSearch(incoming.keyword);
      setSubmittedSearch(incoming.keyword);
      setSource(incoming.source);
      setFilters(nextFilters);
      setDraftFilters(nextFilters);
      setCursor(undefined);
      toast.success(`Applied saved search "${incoming.name}"`);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Deep-link from email: /contracts?savedSearch=<id>
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("savedSearch");
    if (!id) return;
    (async () => {
      const { data, error } = await supabase.from("saved_searches").select("*").eq("id", id).maybeSingle();
      if (error || !data) {
        toast.error("Saved search not found");
        return;
      }
      const { rowToApplied } = await import("@/pages/SavedSearches");
      const applied = rowToApplied(data as any);
      const nextFilters = withDefaultsIfEmpty(applied.keyword, applied.filters);
      setSearch(applied.keyword);
      setSubmittedSearch(applied.keyword);
      setSource(applied.source as SourceFilter);
      setFilters(nextFilters);
      setDraftFilters(nextFilters);
      setCursor(undefined);
      toast.success(`Applied saved search "${applied.name}"`);
      navigate(location.pathname, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const { membership, user, isAdmin } = useAuth();
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleSaveSearch = async () => {
    const name = saveName.trim();
    if (!name) {
      toast.error("Please enter a name for this search");
      return;
    }
    if (!membership?.organisation_id) {
      toast.error("You must belong to an organisation to save searches");
      return;
    }
    if (!user?.id) {
      toast.error("You must be logged in to save searches");
      return;
    }
    const entry: SavedSearch = {
      id: crypto.randomUUID(),
      name,
      keyword: submittedSearch,
      source,
      filters,
      createdAt: Date.now(),
    };

    // Persist to DB so the daily-search-alerts function can use it.
    // last_alerted_at is omitted so the first digest sends the full current matching set.
    const dbRow = {
      organisation_id: membership.organisation_id,
      user_id: user?.id,
      name,
      active: true,
      email_recipients: [user?.email].filter(Boolean),
      source,
      buyer: filters.buyer || null,
      supplier: filters.supplier || null,
      min_value: filters.minValue ? Number(filters.minValue) : null,
      max_value: filters.maxValue ? Number(filters.maxValue) : null,
      published_from: filters.publishedFrom || null,
      published_to: filters.publishedTo || null,
      cpv: filters.cpv || null,
      notice_type: filters.noticeType || null,
      filters: {
        keyword: submittedSearch,
        stages: filters.stages,
        deadlineFrom: filters.deadlineFrom,
        deadlineTo: filters.deadlineTo,
        minScore: filters.minScore,
        framework: filters.framework,
        showHidden: filters.showHidden,
      },
    };

    const { data, error } = await supabase.from("saved_searches").insert(dbRow).select("id").single();

    if (error) {
      toast.error(`Failed to save: ${error.message}`);
      return;
    }
    if (data?.id) entry.id = data.id;

    setSavedSearches((prev) => [entry, ...prev]);
    setSaveName("");
    setSaveOpen(false);
    toast.success(`Search "${name}" saved`);
  };

  const { data: saved } = useSavedBids();
  const { data: profile } = useMatchProfile();
  const selectBid = useSelectBid();
  const savedKeys = new Set((saved || []).map((s) => `${s.source}::${s.external_id}`));

  const { data, isLoading, isError, error, refetch } = useStoredNotices({
    daysBack: 180,
    limit: 1000,
  });
  void cursor; // cursor unused with DB-backed reads, retained for saved-search compatibility

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedSearch(search);
    setCursor(undefined);
    if (search.trim()) pushRecentSearch(search.trim());
  };

  const runRecentSearch = (term: string) => {
    setSearch(term);
    setSubmittedSearch(term);
    setCursor(undefined);
    pushRecentSearch(term);
  };

  // Hybrid semantic search (keyword + CPV + vector similarity).
  // Runs only when user submitted a keyword AND semantic mode is on.
  // Default scope: active opportunities only. Disabled when the user explicitly
  // selects a non-active stage (awarded, closed, planning, closing).
  const activeOnly = useMemo(() => {
    const s = filters.stages;
    if (!s.length) return true;
    return s.every((x) => x === "open");
  }, [filters.stages]);

  const { data: semData, isFetching: semFetching } = useSemanticSearch({
    query: submittedSearch,
    cpvPrefix: filters.cpv || null,
    daysBack: 365,
    enabled: semanticMode && submittedSearch.trim().length > 0,
    activeOnly,
  });

  // external_id (lowercase) → hybrid score, for diagnostics overlay
  const semScoreMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of semData?.results || []) {
      if (h.external_id) m.set(h.external_id.toLowerCase(), h.hybrid_score);
    }
    return m;
  }, [semData]);

  // Hydrate RPC-ranked hits with full tender rows (includes ted + contracts_scotland).
  // This is the source of truth for semantic mode — no client re-ranking, no source pre-exclusion.
  const semanticActive = semanticMode && submittedSearch.trim().length > 0;
  const { data: semNotices, isFetching: semNoticesFetching } = useSemanticNotices(semData?.results, semanticActive);
  const semSearching = semanticActive && (semFetching || semNoticesFetching);

  const allNotices = useMemo(() => {
    // Semantic mode: render RPC-ranked notices directly, preserving order.
    if (semanticActive) {
      if (semNotices && semNotices.length) return semNotices;
      // Still loading hydration or no hits — fall through to empty list to avoid
      // showing unrelated pre-fetched notices below an active semantic query.
      if (semFetching || !semData) return [];
      if (semData.results.length === 0) return [];
    }

    const list = data?.notices || [];
    if (!submittedSearch) return list;

    // Keyword-only fallback (semantic off)
    const kw = submittedSearch.toLowerCase();
    return list.filter((n) => `${n.title} ${n.description} ${n.buyer}`.toLowerCase().includes(kw));
  }, [data, submittedSearch, semanticActive, semNotices, semData, semFetching]);
  const sourceOpt = SOURCE_OPTIONS.find((o) => o.value === source) || SOURCE_OPTIONS[0];
  const bySource =
    source === "all" ? allNotices : allNotices.filter((n) => sourceOpt.match((n.source || "").toLowerCase()));

  // Apply client-side filters
  const filtered = useMemo(() => {
    const f = filters;
    const kw = f.keyword.toLowerCase().trim();
    const buyer = f.buyer.toLowerCase().trim();
    const supplier = f.supplier.toLowerCase().trim();
    const cpv = f.cpv.trim();
    const fw = f.framework.toLowerCase().trim();
    const nt = f.noticeType.toLowerCase().trim();
    const minVal = f.minValue ? Number(f.minValue) : null;
    const maxVal = f.maxValue ? Number(f.maxValue) : null;
    const minScore = Number(f.minScore || 0);
    const pubFrom = f.publishedFrom ? new Date(f.publishedFrom).getTime() : null;
    const pubTo = f.publishedTo ? new Date(f.publishedTo).getTime() : null;
    const dlFrom = f.deadlineFrom ? new Date(f.deadlineFrom).getTime() : null;
    const dlTo = f.deadlineTo ? new Date(f.deadlineTo).getTime() : null;

    return bySource.filter((n) => {
      const key = `${n.source}::${n.id}`;
      if (!f.showHidden && hidden.has(key)) return false;
      if (f.showHidden && !hidden.has(key)) return false;

      if (kw) {
        const hay = `${n.title} ${n.description} ${n.buyer} ${n.sector}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      if (buyer && !(n.buyer || "").toLowerCase().includes(buyer)) return false;
      if (supplier) {
        const hay = `${n.description} ${n.title}`.toLowerCase();
        if (!hay.includes(supplier)) return false;
      }
      if (cpv && !(n.cpvCode || "").toString().startsWith(cpv)) return false;
      if (fw) {
        const hay = `${n.title} ${n.description} ${n.noticeType}`.toLowerCase();
        if (!hay.includes(fw)) return false;
      }
      if (nt && !(n.noticeType || "").toLowerCase().includes(nt)) return false;

      const v = n.value || 0;
      if (minVal != null && v < minVal) return false;
      if (maxVal != null && v > 0 && v > maxVal) return false;

      const pub = n.publishedDate ? new Date(n.publishedDate).getTime() : 0;
      if (pubFrom && pub && pub < pubFrom) return false;
      if (pubTo && pub && pub > pubTo) return false;

      const dl = n.deadlineDate ? new Date(n.deadlineDate).getTime() : 0;
      if (dlFrom && dl && dl < dlFrom) return false;
      if (dlTo && dl && dl > dlTo) return false;

      if (f.stages.length > 0) {
        const s = resolveLifecycleStatus(n);
        const matchesStage = f.stages.some((stage) => {
          if (stage === "open") return s === "active";
          if (stage === "closing") return s === "closing-soon";
          if (stage === "awarded") return s === "complete";
          if (stage === "planning") return s === "planned";
          if (stage === "closed") return s === "complete" || s === "cancelled" || s === "withdrawn";
          return false;
        });
        if (!matchesStage) return false;
      }

      if (minScore > 0) {
        const { score } = scoreNotice(n, profile || null);
        if (score < minScore) return false;
      }

      return true;
    });
  }, [bySource, filters, hidden, profile]);

  // --- Pipeline diagnostics (admin only) ---------------------------------
  // Verifies that ranked rows from search_tenders_hybrid (RPC) reach the UI.
  // Surfaces records dropped between RPC → notices fetch → client filters.
  useEffect(() => {
    if (!isAdmin || !semanticMode || !submittedSearch || !semData?.results?.length) return;
    const rpc = semData.results.slice(0, 10).map((r, i) => ({
      rank: i + 1,
      src: r.source,
      ext: r.external_id,
      title: (r.title || "").slice(0, 80),
      kw: +(r.keyword_score ?? 0).toFixed(3),
      cpv: +(r.cpv_score ?? 0).toFixed(3),
      sem: +(r.semantic_score ?? 0).toFixed(3),
      bonus: +(r.bonus_score ?? 0).toFixed(3),
      pen: +(r.penalty_score ?? 0).toFixed(3),
      final: +(r.hybrid_score ?? 0).toFixed(3),
    }));
    const rendered = filtered.slice(0, 10).map((n, i) => ({
      rank: i + 1,
      src: n.source,
      ext: n.id,
      title: (n.title || "").slice(0, 80),
      final: +(semScoreMap.get((n.id || "").toLowerCase()) ?? 0).toFixed(3),
    }));
    const renderedExts = new Set(filtered.map((n) => (n.id || "").toLowerCase()));
    const dropped = semData.results
      .slice(0, 10)
      .filter((r) => !renderedExts.has((r.external_id || "").toLowerCase()))
      .map((r) => ({
        src: r.source,
        ext: r.external_id,
        title: (r.title || "").slice(0, 80),
        final: +(r.hybrid_score ?? 0).toFixed(3),
      }));

    console.groupCollapsed(
      `[search-pipeline] "${submittedSearch}" — RPC=${semData.results.length} rendered=${filtered.length}`,
    );
    console.log("expansion.terms", semData.expansion?.terms);
    console.log("expansion.cpvs", semData.expansion?.cpvs);
    console.log("weights", semData.weights);
    console.log("RPC top 10");
    console.table(rpc);
    console.log("Rendered top 10");
    console.table(rendered);
    if (dropped.length) {
      console.warn(`Dropped from UI (${dropped.length}/10 RPC top 10 not in rendered list)`);
      console.table(dropped);
      console.warn(
        "Remaining drops are client-side filters (source/stage/value/date/hidden) or hits whose tender row could not be hydrated.",
      );
    }
    console.groupEnd();
  }, [isAdmin, semanticMode, submittedSearch, semData, filtered, semScoreMap]);

  const sourceCounts = useMemo(
    () =>
      SOURCE_OPTIONS.reduce<Record<SourceFilter, number>>(
        (acc, opt) => {
          acc[opt.value] =
            opt.value === "all"
              ? allNotices.length
              : allNotices.filter((n) => opt.match((n.source || "").toLowerCase())).length;
          return acc;
        },
        {} as Record<SourceFilter, number>,
      ),
    [allNotices],
  );

  const activeFilterCount = useMemo(() => {
    let c = 0;
    const f = filters;
    // Keyword search is intentionally excluded from the filter count.
    if (f.stages.length) c++;
    if (f.buyer) c++;
    if (f.supplier) c++;
    if (f.minValue || f.maxValue) c++;
    if (f.publishedFrom || f.publishedTo) c++;
    if (f.deadlineFrom || f.deadlineTo) c++;
    if (Number(f.minScore || 0) > 0) c++;
    if (f.framework) c++;
    if (f.cpv) c++;
    if (f.noticeType) c++;
    if (f.showHidden) c++;
    return c;
  }, [filters]);

  const toggleHidden = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveHidden(next);
      return next;
    });
  };

  const openFilters = () => {
    setDraftFilters(filters);
    setFiltersOpen(true);
  };
  const applyFilters = () => {
    setFilters(draftFilters);
    setFiltersOpen(false);
  };
  const resetFilters = () => {
    setDraftFilters(getDefaultFilters());
  };
  const clearAllFilters = () => {
    const preservedKeyword = filters.keyword;
    const base = getDefaultFilters();
    setFilters({ ...base, keyword: preservedKeyword });
    setDraftFilters({ ...base, keyword: preservedKeyword });
  };

  // Human-readable summary of what is currently being searched (below search bar).
  const contextChips = useMemo(() => {
    const chips: string[] = [];
    // Date preset match (else custom range)
    const dp = DATE_PRESETS.find((p) => p.from() === filters.publishedFrom && !filters.publishedTo);
    if (dp) chips.push(dp.label);
    else if (filters.publishedFrom || filters.publishedTo)
      chips.push(`Published ${filters.publishedFrom || "…"}–${filters.publishedTo || "…"}`);
    // Source
    const srcOpt = SOURCE_OPTIONS.find((o) => o.value === source) ?? SOURCE_OPTIONS[0];
    chips.push(srcOpt.label);
    // Value band
    const vb = VALUE_BANDS.find((b) => b.min === filters.minValue && b.max === filters.maxValue && (b.min || b.max));
    if (vb) chips.push(vb.label);
    else if (filters.minValue || filters.maxValue) chips.push(`£${filters.minValue || "0"}–${filters.maxValue || "∞"}`);
    if (filters.buyer) chips.push(`Buyer: ${filters.buyer}`);
    if (filters.supplier) chips.push(`Supplier: ${filters.supplier}`);
    if (filters.cpv) {
      const cat = findCategoryByCpv(filters.cpv);
      chips.push(cat ? cat.label : `CPV ${filters.cpv}`);
    }
    if (filters.framework) chips.push(`Framework: ${filters.framework}`);
    if (filters.noticeType) chips.push(`Notice: ${filters.noticeType}`);
    if (filters.stages.length)
      chips.push(
        `Stage: ${filters.stages.map((s) => STAGE_OPTIONS.find((o) => o.value === s)?.label ?? s).join(", ")}`,
      );
    if (Number(filters.minScore || 0) > 0) chips.push(`Min match ${filters.minScore}`);
    return chips;
  }, [filters, source]);

  // Diagnostics visibility: developer-only feature (dev builds or admin users).
  const showDeveloperTools = isAdmin || import.meta.env.DEV;

  // Results summary text — context-aware; no total dataset counts.
  const resultsSummary = useMemo(() => {
    if (semanticMode && submittedSearch && semSearching) return null;
    if (!data) return "Search live UK, EU & Ireland procurement opportunities";
    const n = filtered.length.toLocaleString();
    const suffix = contextChips.length ? ` (${contextChips.join(" · ")})` : "";
    return `Showing ${n} matching tender${filtered.length === 1 ? "" : "s"}${suffix}`;
  }, [semanticMode, submittedSearch, semSearching, data, filtered.length, contextChips]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Contract Search</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1 flex items-center gap-2">
            {semanticMode && submittedSearch && semSearching ? (
              <>
                <Loader2Icon className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Finding relevant tenders…</span>
              </>
            ) : (
              resultsSummary
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 self-start sm:self-auto">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Search bar */}
      <form
        onSubmit={handleSearch}
        className="glass-card p-3 sm:p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center"
      >
        <SearchAutocomplete
          value={search}
          onChange={setSearch}
          placeholder={semanticMode ? "Describe what you're looking for…" : "Search contracts..."}
          className="flex-1"
        />
        <label
          className="flex items-center gap-2 text-xs text-muted-foreground select-none px-2"
          title="Hybrid AI ranking: keyword 50% · CPV 30% · semantic 20%"
        >
          <Sparkles className={`h-3.5 w-3.5 ${semanticMode ? "text-primary" : "text-muted-foreground"}`} />
          <span>Semantic</span>
          <Switch checked={semanticMode} onCheckedChange={setSemanticMode} />
          {semFetching && semanticMode && submittedSearch && (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
        </label>
        <Button type="submit" size="sm" className="gap-2">
          <Search className="h-4 w-4" /> Search
        </Button>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 relative min-h-11"
              onClick={openFilters}
              aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : "Filters"}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span aria-hidden="true">{activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}</span>
            </Button>
          </SheetTrigger>
          <span role="status" aria-live="polite" className="sr-only">
            {activeFilterCount === 0
              ? "No filters applied"
              : `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied`}
          </span>
          <SheetContent className="w-full sm:max-w-md p-0 flex flex-col h-dvh sm:h-full">
            <SheetHeader className="px-6 pt-6 pb-3 border-b border-border/50 shrink-0">
              <SheetTitle>Search Filters</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-6 py-2">
              <Accordion
                type="multiple"
                defaultValue={["keyword", "stage", "parties", "value", "dates"]}
                className="mt-2"
              >
                <AccordionItem value="keyword">
                  <AccordionTrigger className="text-sm">Keyword</AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    <KeywordAutocomplete
                      value={draftFilters.keyword}
                      onChange={(v) => setDraftFilters({ ...draftFilters, keyword: v })}
                      placeholder="Filter by keyword in title/desc/buyer"
                    />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="stage">
                  <AccordionTrigger className="text-sm">Procurement Stage</AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    {STAGE_OPTIONS.map((s) => (
                      <label key={s.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={draftFilters.stages.includes(s.value)}
                          onCheckedChange={(v) => {
                            const next = v
                              ? [...draftFilters.stages, s.value]
                              : draftFilters.stages.filter((x) => x !== s.value);
                            setDraftFilters({ ...draftFilters, stages: next });
                          }}
                        />
                        {s.label}
                      </label>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="parties">
                  <AccordionTrigger className="text-sm">Buyers & Suppliers</AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Buyer name</Label>
                      <BuyerAutocomplete
                        value={draftFilters.buyer}
                        onChange={(v) => setDraftFilters({ ...draftFilters, buyer: v })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Buyer type</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {["NHS", "Local Authority", "Education", "Police", "Fire", "Housing", "Utilities", "Other"].map(
                          (t) => {
                            const active = draftFilters.buyer === t;
                            return (
                              <Button
                                key={t}
                                type="button"
                                size="sm"
                                variant={active ? "default" : "outline"}
                                className="h-7 px-2 text-xs"
                                onClick={() => setDraftFilters({ ...draftFilters, buyer: active ? "" : t })}
                              >
                                {t}
                              </Button>
                            );
                          },
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Quickly populate the buyer field with a common organisation type.
                      </p>
                    </div>
                    <details className="pt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                        Supplier (mentioned in notice)
                      </summary>
                      <div className="mt-2">
                        <SupplierAutocomplete
                          value={draftFilters.supplier}
                          onChange={(v) => setDraftFilters({ ...draftFilters, supplier: v })}
                        />
                      </div>
                    </details>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="value">
                  <AccordionTrigger className="text-sm">Contract Value</AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Choose contract value</Label>
                      <div className="space-y-1.5">
                        {VALUE_BANDS.map((b) => {
                          const active = draftFilters.minValue === b.min && draftFilters.maxValue === b.max;
                          return (
                            <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="radio"
                                name="value-band"
                                className="accent-primary"
                                checked={active}
                                onChange={() => setDraftFilters({ ...draftFilters, minValue: b.min, maxValue: b.max })}
                              />
                              {b.label}
                            </label>
                          );
                        })}
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="value-band"
                            className="accent-primary"
                            checked={!draftFilters.minValue && !draftFilters.maxValue}
                            onChange={() => setDraftFilters({ ...draftFilters, minValue: "", maxValue: "" })}
                          />
                          Any value
                        </label>
                      </div>
                    </div>
                    <details>
                      <summary className="text-xs text-muted-foreground cursor-pointer select-none">Advanced</summary>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div>
                          <Label className="text-xs">Minimum value (£)</Label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={draftFilters.minValue}
                            onChange={(e) => setDraftFilters({ ...draftFilters, minValue: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Maximum value (£)</Label>
                          <Input
                            type="number"
                            placeholder="No max"
                            value={draftFilters.maxValue}
                            onChange={(e) => setDraftFilters({ ...draftFilters, maxValue: e.target.value })}
                          />
                        </div>
                      </div>
                    </details>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="dates">
                  <AccordionTrigger className="text-sm">Contract Dates</AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    {(() => {
                      const todayIso = new Date().toISOString().slice(0, 10);
                      const daysAgo = (n: number) => {
                        const d = new Date();
                        d.setDate(d.getDate() - n);
                        return d.toISOString().slice(0, 10);
                      };
                      const daysAhead = (n: number) => {
                        const d = new Date();
                        d.setDate(d.getDate() + n);
                        return d.toISOString().slice(0, 10);
                      };
                      const pubPresets = [
                        { id: "today", label: "Today", from: todayIso, to: todayIso },
                        { id: "7d", label: "Last 7 days", from: daysAgo(7), to: "" },
                        { id: "30d", label: "Last 30 days", from: daysAgo(30), to: "" },
                        { id: "90d", label: "Last 90 days", from: daysAgo(90), to: "" },
                        { id: "1y", label: "Last year", from: daysAgo(365), to: "" },
                      ];
                      const closePresets = [
                        { id: "week", label: "This week", from: todayIso, to: daysAhead(7) },
                        { id: "30d", label: "Next 30 days", from: todayIso, to: daysAhead(30) },
                        { id: "90d", label: "Next 90 days", from: todayIso, to: daysAhead(90) },
                      ];
                      return (
                        <>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Published date</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {pubPresets.map((p) => {
                                const active =
                                  draftFilters.publishedFrom === p.from && (draftFilters.publishedTo || "") === p.to;
                                return (
                                  <Button
                                    key={p.id}
                                    type="button"
                                    size="sm"
                                    variant={active ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    onClick={() =>
                                      setDraftFilters({ ...draftFilters, publishedFrom: p.from, publishedTo: p.to })
                                    }
                                  >
                                    {p.label}
                                  </Button>
                                );
                              })}
                            </div>
                            <details className="pt-1">
                              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                                Custom range
                              </summary>
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                  <Label className="text-xs">From</Label>
                                  <Input
                                    type="date"
                                    value={draftFilters.publishedFrom}
                                    onChange={(e) =>
                                      setDraftFilters({ ...draftFilters, publishedFrom: e.target.value })
                                    }
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">To</Label>
                                  <Input
                                    type="date"
                                    value={draftFilters.publishedTo}
                                    onChange={(e) => setDraftFilters({ ...draftFilters, publishedTo: e.target.value })}
                                  />
                                </div>
                              </div>
                            </details>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Closing date</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {closePresets.map((p) => {
                                const active = draftFilters.deadlineFrom === p.from && draftFilters.deadlineTo === p.to;
                                return (
                                  <Button
                                    key={p.id}
                                    type="button"
                                    size="sm"
                                    variant={active ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    onClick={() =>
                                      setDraftFilters({ ...draftFilters, deadlineFrom: p.from, deadlineTo: p.to })
                                    }
                                  >
                                    {p.label}
                                  </Button>
                                );
                              })}
                            </div>
                            <details className="pt-1">
                              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                                Custom range
                              </summary>
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                  <Label className="text-xs">From</Label>
                                  <Input
                                    type="date"
                                    value={draftFilters.deadlineFrom}
                                    onChange={(e) => setDraftFilters({ ...draftFilters, deadlineFrom: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">To</Label>
                                  <Input
                                    type="date"
                                    value={draftFilters.deadlineTo}
                                    onChange={(e) => setDraftFilters({ ...draftFilters, deadlineTo: e.target.value })}
                                  />
                                </div>
                              </div>
                            </details>
                          </div>
                        </>
                      );
                    })()}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="score">
                  <AccordionTrigger className="text-sm">BidIntel Score</AccordionTrigger>
                  <AccordionContent>
                    <Label className="text-xs">Minimum score</Label>
                    <Select
                      value={draftFilters.minScore}
                      onValueChange={(v) => setDraftFilters({ ...draftFilters, minScore: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Any</SelectItem>
                        <SelectItem value="1">1+</SelectItem>
                        <SelectItem value="2">2+</SelectItem>
                        <SelectItem value="3">3 only</SelectItem>
                      </SelectContent>
                    </Select>
                    {!profile && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Set up an org match profile in Settings to enable scoring.
                      </p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="frameworks">
                  <AccordionTrigger className="text-sm">Frameworks</AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Search framework</Label>
                      <FrameworkAutocomplete
                        value={draftFilters.framework}
                        onChange={(v) => setDraftFilters({ ...draftFilters, framework: v })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Popular frameworks</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {POPULAR_FRAMEWORKS.map((f) => (
                          <Button
                            key={f.id}
                            type="button"
                            size="sm"
                            variant={draftFilters.framework === f.keyword ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() =>
                              setDraftFilters({
                                ...draftFilters,
                                framework: draftFilters.framework === f.keyword ? "" : f.keyword,
                              })
                            }
                          >
                            {f.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Searches title, description, and notice type.</p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="cpv">
                  <AccordionTrigger className="text-sm">Service Category (CPV)</AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    <Select
                      value={SERVICE_CATEGORIES.find((c) => c.cpvPrefix === draftFilters.cpv)?.id || "any"}
                      onValueChange={(v) => {
                        if (v === "any") return setDraftFilters({ ...draftFilters, cpv: "" });
                        const cat = SERVICE_CATEGORIES.find((c) => c.id === v);
                        setDraftFilters({ ...draftFilters, cpv: cat?.cpvPrefix || "" });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Any category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any category</SelectItem>
                        {SERVICE_CATEGORIES.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <details>
                      <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                        Advanced: search by CPV code
                      </summary>
                      <div className="mt-2">
                        <CpvAutocomplete
                          value={draftFilters.cpv}
                          onChange={(v) => setDraftFilters({ ...draftFilters, cpv: v })}
                        />
                      </div>
                    </details>
                    {draftFilters.cpv && (
                      <p className="text-[11px] text-muted-foreground">
                        CPV prefix: <code>{draftFilters.cpv}</code>
                        {findCategoryByCpv(draftFilters.cpv) ? ` · ${findCategoryByCpv(draftFilters.cpv)!.label}` : ""}
                      </p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="noticeType">
                  <AccordionTrigger className="text-sm">Notice Lists</AccordionTrigger>
                  <AccordionContent>
                    <Input
                      placeholder="e.g. Tender, Contract Award, PIN"
                      value={draftFilters.noticeType}
                      onChange={(e) => setDraftFilters({ ...draftFilters, noticeType: e.target.value })}
                    />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="hidden">
                  <AccordionTrigger className="text-sm">Hidden Notices</AccordionTrigger>
                  <AccordionContent>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draftFilters.showHidden}
                        onCheckedChange={(v) => setDraftFilters({ ...draftFilters, showHidden: !!v })}
                      />
                      Show only hidden notices
                    </label>
                    <p className="text-xs text-muted-foreground mt-2">
                      {hidden.size} notice(s) hidden. Hide individual notices using the eye icon on each card.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            <SheetFooter className="sticky bottom-0 px-6 py-4 border-t border-border bg-background shrink-0 flex-row gap-2 sm:justify-between">
              <Button variant="outline" size="sm" className="min-h-11 flex-1 sm:flex-none" onClick={resetFilters}>
                Clear
              </Button>
              <Button size="sm" className="min-h-11 flex-1 sm:flex-none" onClick={applyFilters}>
                Apply Filters
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </form>

      {/* Current search context summary — always reflects active keyword + filters */}
      <div className="text-xs sm:text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
        {submittedSearch ? (
          <>
            <span>Searching:</span>
            <span className="font-medium text-foreground">"{submittedSearch}"</span>
            {contextChips.length > 0 && (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span>Within:</span>
                <span className="font-medium text-foreground">{contextChips.join(" · ")}</span>
              </>
            )}
          </>
        ) : (
          <>
            <span>Showing tenders from:</span>
            <span className="font-medium text-foreground">
              {contextChips.length ? contextChips.join(" · ") : "All available"}
            </span>
          </>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 &&
        (() => {
          const f = filters;
          const todayIso = new Date().toISOString().slice(0, 10);
          const daysAgo = (n: number) => {
            const d = new Date();
            d.setDate(d.getDate() - n);
            return d.toISOString().slice(0, 10);
          };
          const daysAhead = (n: number) => {
            const d = new Date();
            d.setDate(d.getDate() + n);
            return d.toISOString().slice(0, 10);
          };
          const pubLabel = (() => {
            if (!f.publishedFrom && !f.publishedTo) return null;
            const map: Record<string, string> = {
              [`${todayIso}|${todayIso}`]: "Today",
              [`${daysAgo(7)}|`]: "Last 7 days",
              [`${daysAgo(30)}|`]: "Last 30 days",
              [`${daysAgo(90)}|`]: "Last 90 days",
              [`${daysAgo(365)}|`]: "Last year",
            };
            const key = `${f.publishedFrom}|${f.publishedTo}`;
            return map[key] || `${f.publishedFrom || "…"} → ${f.publishedTo || "…"}`;
          })();
          const closeLabel = (() => {
            if (!f.deadlineFrom && !f.deadlineTo) return null;
            const map: Record<string, string> = {
              [`${todayIso}|${daysAhead(7)}`]: "This week",
              [`${todayIso}|${daysAhead(30)}`]: "Next 30 days",
              [`${todayIso}|${daysAhead(90)}`]: "Next 90 days",
            };
            const key = `${f.deadlineFrom}|${f.deadlineTo}`;
            return map[key] || `${f.deadlineFrom || "…"} → ${f.deadlineTo || "…"}`;
          })();
          const valLabel = (() => {
            if (!f.minValue && !f.maxValue) return null;
            const band = VALUE_BANDS.find((b) => b.min === f.minValue && b.max === f.maxValue);
            if (band) return band.label;
            return `£${f.minValue || "0"} – £${f.maxValue || "∞"}`;
          })();
          const cpvLabel = f.cpv ? findCategoryByCpv(f.cpv)?.label || `CPV ${f.cpv}` : null;
          const stagesLabel = f.stages.length
            ? f.stages.map((s) => STAGE_OPTIONS.find((x) => x.value === s)?.label || s).join(", ")
            : null;
          const chips: { label: string; value: string; clear: () => void }[] = [];
          // Keyword is excluded from filter chips (it's the search query, not a filter).
          if (stagesLabel)
            chips.push({ label: "Status", value: stagesLabel, clear: () => setFilters({ ...filters, stages: [] }) });
          if (f.buyer)
            chips.push({ label: "Buyer", value: f.buyer, clear: () => setFilters({ ...filters, buyer: "" }) });
          if (f.supplier)
            chips.push({ label: "Supplier", value: f.supplier, clear: () => setFilters({ ...filters, supplier: "" }) });
          if (valLabel)
            chips.push({
              label: "Value",
              value: valLabel,
              clear: () => setFilters({ ...filters, minValue: "", maxValue: "" }),
            });
          if (pubLabel)
            chips.push({
              label: "Published",
              value: pubLabel,
              clear: () => setFilters({ ...filters, publishedFrom: "", publishedTo: "" }),
            });
          if (closeLabel)
            chips.push({
              label: "Closing",
              value: closeLabel,
              clear: () => setFilters({ ...filters, deadlineFrom: "", deadlineTo: "" }),
            });
          if (f.framework)
            chips.push({
              label: "Framework",
              value: f.framework,
              clear: () => setFilters({ ...filters, framework: "" }),
            });
          if (cpvLabel) chips.push({ label: "CPV", value: cpvLabel, clear: () => setFilters({ ...filters, cpv: "" }) });
          if (f.noticeType)
            chips.push({
              label: "Notice",
              value: f.noticeType,
              clear: () => setFilters({ ...filters, noticeType: "" }),
            });
          if (f.minScore && f.minScore !== "0")
            chips.push({
              label: "Min score",
              value: f.minScore,
              clear: () => setFilters({ ...filters, minScore: "0" }),
            });
          if (f.showHidden)
            chips.push({
              label: "Hidden",
              value: "Only hidden",
              clear: () => setFilters({ ...filters, showHidden: false }),
            });
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary border border-border px-2.5 py-1 text-xs"
                >
                  <span className="text-muted-foreground">{c.label}:</span>
                  <span className="font-medium truncate max-w-[180px]">{c.value}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      c.clear();
                      setDraftFilters((d) => ({ ...d }));
                    }}
                    aria-label={`Remove ${c.label} filter`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={clearAllFilters}
              >
                <X className="h-3 w-3" /> Clear all filters
              </Button>
            </div>
          );
        })()}

      {/* Discovery shortcuts: popular categories, frameworks, date presets */}
      <div className="glass-card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-start sm:gap-6">
          {recentSearches.length > 0 ? (
            <div className="flex-1 min-w-0">
              <RecentSearches visible onSelect={runRecentSearch} />
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Popular categories</div>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_CATEGORIES.map((id) => {
                  const cat = SERVICE_CATEGORIES.find((c) => c.id === id);
                  if (!cat) return null;
                  const active = filters.cpv === cat.cpvPrefix;
                  return (
                    <Button
                      key={cat.id}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-7 px-2.5 text-xs"
                      onClick={() => {
                        const next = active ? "" : cat.cpvPrefix;
                        setFilters({ ...filters, cpv: next });
                        setDraftFilters({ ...draftFilters, cpv: next });
                      }}
                    >
                      {cat.label.replace(" Services", "").replace(" Works", "")}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Popular frameworks</div>
            <div className="flex flex-wrap gap-1.5">
              {POPULAR_FRAMEWORKS.map((f) => {
                const active = filters.framework === f.keyword;
                return (
                  <Button
                    key={f.id}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => {
                      const next = active ? "" : f.keyword;
                      setFilters({ ...filters, framework: next });
                      setDraftFilters({ ...draftFilters, framework: next });
                    }}
                  >
                    {f.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Published</span>
          {DATE_PRESETS.map((p) => {
            const fromIso = p.from();
            const active = filters.publishedFrom === fromIso && !filters.publishedTo;
            return (
              <Button
                key={p.id}
                size="sm"
                variant={active ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const next = { ...filters, publishedFrom: active ? "" : fromIso, publishedTo: "" };
                  setFilters(next);
                  setDraftFilters({ ...draftFilters, publishedFrom: next.publishedFrom, publishedTo: "" });
                }}
              >
                {p.label}
              </Button>
            );
          })}
          <span className="mx-1 text-muted-foreground/40">·</span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Value</span>
          {VALUE_BANDS.map((b) => {
            const active = filters.minValue === b.min && filters.maxValue === b.max && (b.min !== "" || b.max !== "");
            return (
              <Button
                key={b.id}
                size="sm"
                variant={active ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const next = active
                    ? { ...filters, minValue: "", maxValue: "" }
                    : { ...filters, minValue: b.min, maxValue: b.max };
                  setFilters(next);
                  setDraftFilters({ ...draftFilters, minValue: next.minValue, maxValue: next.maxValue });
                }}
              >
                {b.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* AI suggested filters — derived from semantic expansion */}
      {!semSearching &&
      semanticMode &&
      submittedSearch &&
      semData &&
      (semData.expansion?.terms?.length || semData.expansion?.cpvs?.length) ? (
        <div className="glass-card p-3 sm:p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold">AI suggested filters</span>
            <span className="text-muted-foreground">One-click apply</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(semData.expansion.cpvs || []).slice(0, 8).map((cpv) => {
              const cat = findCategoryByCpv(cpv);
              const active = filters.cpv === cpv;
              return (
                <Button
                  key={`sg-cpv-${cpv}`}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => {
                    const next = active ? "" : cpv;
                    setFilters({ ...filters, cpv: next });
                    setDraftFilters({ ...draftFilters, cpv: next });
                  }}
                >
                  <span className="text-[10px] uppercase opacity-70">CPV</span>
                  {cat ? cat.label : cpv}
                </Button>
              );
            })}
            {(semData.expansion.terms || []).slice(0, 6).map((term) => {
              const active = filters.keyword.toLowerCase() === term.toLowerCase();
              return (
                <Button
                  key={`sg-term-${term}`}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => {
                    const next = active ? "" : term;
                    setFilters({ ...filters, keyword: next });
                    setDraftFilters({ ...draftFilters, keyword: next });
                  }}
                >
                  <span className="text-[10px] uppercase opacity-70">Term</span>
                  {term}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {showDeveloperTools && semanticMode && submittedSearch && semData?.results?.length ? (
        <div className="glass-card p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="font-semibold">Search Diagnostics</span>
              <Badge variant="outline" className="font-normal">
                admin only
              </Badge>
              <span className="text-muted-foreground">
                weights kw {semData.weights?.keyword ?? 0.5} · cpv {semData.weights?.cpv ?? 0.3} · sem{" "}
                {semData.weights?.semantic ?? 0.2}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setShowDiagnostics((v) => !v)}>
              {showDiagnostics ? "Hide" : "Show"} top 10 breakdown
            </Button>
          </div>
          {/* Domain-aware expansion diagnostics */}
          {semData.expansion && (
            <div className="grid sm:grid-cols-2 gap-2 text-[11px] border-t border-border/50 pt-2">
              <div>
                <span className="text-muted-foreground">Detected domain: </span>
                <Badge variant="outline" className="font-normal">
                  {semData.expansion.domainLabel ?? semData.expansion.domain ?? "general"}
                </Badge>
                {semData.expansion.matchedHints?.length ? (
                  <span className="ml-2 text-muted-foreground">via {semData.expansion.matchedHints.join(", ")}</span>
                ) : null}
              </div>
              <div>
                <span className="text-muted-foreground">Allowed domains: </span>
                {(semData.expansion.allowedDomains ?? []).map((d) => (
                  <Badge key={`ad-${d}`} variant="secondary" className="font-normal mr-1">
                    {d}
                  </Badge>
                ))}
              </div>
              <div>
                <span className="text-muted-foreground">Allowed CPVs: </span>
                {(semData.expansion.cpvs ?? []).map((c) => (
                  <Badge
                    key={`ac-${c}`}
                    variant="outline"
                    className="font-normal mr-1 text-emerald-700 border-emerald-500/40"
                  >
                    {c}
                  </Badge>
                ))}
                {!(semData.expansion.cpvs ?? []).length && <span className="text-muted-foreground">none</span>}
              </div>
              <div>
                <span className="text-muted-foreground">Allowed terms: </span>
                {(semData.expansion.terms ?? []).map((t) => (
                  <Badge
                    key={`at-${t}`}
                    variant="outline"
                    className="font-normal mr-1 text-emerald-700 border-emerald-500/40"
                  >
                    {t}
                  </Badge>
                ))}
                {!(semData.expansion.terms ?? []).length && <span className="text-muted-foreground">none</span>}
              </div>
              <div>
                <span className="text-muted-foreground">Rejected CPVs: </span>
                {(semData.expansion.rejectedCpvs ?? []).map((c) => (
                  <Badge
                    key={`rc-${c}`}
                    variant="outline"
                    className="font-normal mr-1 text-destructive border-destructive/40 line-through"
                  >
                    {c}
                  </Badge>
                ))}
                {!(semData.expansion.rejectedCpvs ?? []).length && <span className="text-muted-foreground">none</span>}
              </div>
              <div>
                <span className="text-muted-foreground">Rejected terms: </span>
                {(semData.expansion.rejectedTerms ?? []).map((t) => (
                  <Badge
                    key={`rt-${t}`}
                    variant="outline"
                    className="font-normal mr-1 text-destructive border-destructive/40 line-through"
                  >
                    {t}
                  </Badge>
                ))}
                {!(semData.expansion.rejectedTerms ?? []).length && <span className="text-muted-foreground">none</span>}
              </div>
            </div>
          )}
          {showDiagnostics && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-2">#</th>
                    <th className="text-left py-1.5 pr-2">Title</th>
                    <th className="text-right py-1.5 px-2">Final</th>
                    <th className="text-right py-1.5 px-2">KW</th>
                    <th className="text-right py-1.5 px-2">CPV</th>
                    <th className="text-right py-1.5 px-2">Sem</th>
                    <th className="text-right py-1.5 px-2">Src</th>
                    <th className="text-right py-1.5 px-2">Status+</th>
                    <th className="text-right py-1.5 px-2">Bonus</th>
                    <th className="text-right py-1.5 px-2">Penalty</th>
                    <th className="text-left py-1.5 px-2">Derived</th>
                    <th className="text-left py-1.5 px-2">Display</th>
                    <th className="text-left py-1.5 px-2">Quality</th>
                    <th className="text-left py-1.5 pl-2">Matched</th>
                  </tr>
                </thead>
                <tbody>
                  {semData.results.slice(0, 10).map((r, i) => {
                    const qColor =
                      r.match_quality === "strong"
                        ? "bg-emerald-500/15 text-emerald-700"
                        : r.match_quality === "good"
                          ? "bg-emerald-500/10 text-emerald-700"
                          : r.match_quality === "medium"
                            ? "bg-amber-500/15 text-amber-700"
                            : "bg-destructive/10 text-destructive";
                    return (
                      <tr key={r.id} className="border-b border-border/40 align-top">
                        <td className="py-1.5 pr-2 text-muted-foreground">{i + 1}</td>
                        <td className="py-1.5 pr-2 max-w-md">
                          <p className="truncate" title={r.title}>
                            {r.title}
                          </p>
                          {r.buyer_name && <p className="text-muted-foreground truncate">{r.buyer_name}</p>}
                          <p className="text-muted-foreground text-[10px] uppercase">{r.source}</p>
                          {r.intent_mismatch && (
                            <Badge
                              variant="outline"
                              className="mt-1 font-normal text-[10px] py-0 border-destructive/40 text-destructive bg-destructive/5"
                            >
                              Intent penalty −{(r.intent_penalty ?? 0).toFixed(2)} (software/IT row, domain mismatch)
                            </Badge>
                          )}
                        </td>

                        <td className="py-1.5 px-2 text-right font-semibold">{r.hybrid_score.toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-right">{r.keyword_score.toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-right">{r.cpv_score.toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-right">{r.semantic_score.toFixed(3)}</td>
                        <td
                          className={`py-1.5 px-2 text-right ${(r.source_bonus ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}
                        >
                          {(r.source_bonus ?? 0) >= 0 ? "+" : ""}
                          {(r.source_bonus ?? 0).toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-emerald-600">+{(r.status_bonus ?? 0).toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right text-emerald-600">+{(r.bonus_score ?? 0).toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-right text-destructive">
                          -{(r.penalty_score ?? 0).toFixed(3)}
                        </td>
                        <td className="py-1.5 px-2 text-muted-foreground">{r.derived_status ?? "—"}</td>
                        <td className="py-1.5 px-2">
                          <Badge variant="outline" className="font-normal text-[10px] py-0">
                            {r.final_display_status ?? "—"}
                          </Badge>
                        </td>
                        <td className="py-1.5 px-2">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${qColor}`}>
                            {r.match_quality ?? "—"}
                          </span>
                        </td>
                        <td className="py-1.5 pl-2">
                          <div className="flex flex-wrap gap-1">
                            {(r.matched_cpvs || []).map((c) => (
                              <Badge key={`mc-${r.id}-${c}`} variant="outline" className="font-normal text-[10px] py-0">
                                CPV {c}
                              </Badge>
                            ))}
                            {(r.matched_terms || []).slice(0, 5).map((t) => (
                              <Badge
                                key={`mt-${r.id}-${t}`}
                                variant="secondary"
                                className="font-normal text-[10px] py-0"
                              >
                                {t}
                              </Badge>
                            ))}
                            {!(r.matched_terms?.length || r.matched_cpvs?.length) && (
                              <span className="text-muted-foreground">none</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Source:</span>
        <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
          <SelectTrigger className="h-8 text-xs w-[260px]">
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
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => {
              const base = getDefaultFilters();
              setFilters(base);
              setDraftFilters(base);
            }}
          >
            <X className="h-3 w-3" /> Clear filters
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <Save className="h-3 w-3" /> Save Search
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save current search</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    placeholder="e.g. NHS IT contracts > £100k"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveSearch();
                    }}
                    autoFocus
                  />
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>
                    Keyword: <span className="text-foreground">{submittedSearch || "—"}</span>
                  </div>
                  <div>
                    Source:{" "}
                    <span className="text-foreground">{SOURCE_OPTIONS.find((o) => o.value === source)?.label}</span>
                  </div>
                  <div>
                    Active filters: <span className="text-foreground">{activeFilterCount}</span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveSearch}>
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Searching Contracts Finder &amp; Find a Tender...</p>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="glass-card p-8 text-center border-destructive/30">
          <p className="text-destructive font-medium">Failed to fetch contracts</p>
          <p className="text-sm text-muted-foreground mt-1">{(error as Error)?.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Results */}
      {!isLoading && !isError && (
        <div className="space-y-3">
          {semanticMode && submittedSearch && semSearching && (
            <SearchLoadingState query={submittedSearch} expansion={semData?.expansion ?? null} />
          )}
          {filtered.map((c, i) => {
            const key = `${c.source}::${c.id}`;
            const isHidden = hidden.has(key);
            const { score, reasons } = profile ? scoreNotice(c, profile) : { score: 0, reasons: [] as string[] };
            const lifecycleStatus = resolveLifecycleStatus(c);
            return (
              <div
                key={c.id}
                className="glass-card p-4 sm:p-5 hover:border-primary/30 transition-colors opacity-0 animate-fade-in"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                      <LiveStatusBadge status={lifecycleStatus} />
                      <span className="text-xs text-muted-foreground">{c.noticeType}</span>
                      <span className="text-xs text-muted-foreground hidden sm:inline">via {c.source}</span>
                      <ScoreBadge score={score} reasons={reasons} />
                    </div>
                    <h3 className="font-semibold text-sm sm:text-base leading-snug">
                      <Link
                        to={`/open-bids/${encodeURIComponent(c.id)}`}
                        className="hover:underline hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                      >
                        {c.title}
                      </Link>
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">{c.buyer}</p>
                    {c.description && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 hidden sm:block">{c.description}</p>
                    )}
                    <div className="flex gap-3 sm:gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                      {c.sector && <span>Sector: {c.sector}</span>}
                      {c.cpvCode && <span className="hidden sm:inline">CPV: {c.cpvCode}</span>}
                      {c.publishedDate && (
                        <span>Published: {new Date(c.publishedDate).toLocaleDateString("en-GB")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:text-right shrink-0">
                    {(c.value > 0 || c.valueHigh > 0) && (
                      <p className="text-base sm:text-lg font-bold text-primary">
                        {c.value > 0 ? formatCurrency(c.value) : ""}
                        {c.valueHigh > 0 && c.valueHigh !== c.value ? ` - ${formatCurrency(c.valueHigh)}` : ""}
                      </p>
                    )}
                    {c.deadlineDate && (
                      <p className="text-xs text-muted-foreground">
                        Deadline: {new Date(c.deadlineDate).toLocaleDateString("en-GB")}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <a
                        href={c.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline bg-primary/10 px-3 py-1.5 rounded-md"
                      >
                        View on Source <ExternalLink className="h-3 w-3" />
                      </a>
                      {savedKeys.has(`${c.source}::${c.id}`) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success bg-success/10 px-3 py-1.5 rounded-md">
                          <BookmarkCheck className="h-3 w-3" /> Selected
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 px-3 gap-1.5 text-xs"
                          disabled={selectBid.isPending}
                          onClick={() =>
                            selectBid.mutate(c, {
                              onSuccess: () => toast.success("Bid added to your pipeline"),
                              onError: (e) => toast.error((e as Error).message),
                            })
                          }
                        >
                          <BookmarkPlus className="h-3 w-3" /> Select Bid
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 gap-1.5 text-xs"
                        onClick={() => {
                          toggleHidden(key);
                          toast.success(isHidden ? "Notice unhidden" : "Notice hidden");
                        }}
                        title={isHidden ? "Unhide" : "Hide notice"}
                      >
                        {isHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && !isLoading && !(semanticMode && submittedSearch && semSearching) && (
            <div className="glass-card p-12 text-center">
              <p className="text-muted-foreground">
                {submittedSearch
                  ? "No matching tenders found."
                  : "No contracts match your filters. Try adjusting them."}
              </p>
            </div>
          )}

          {/* Load more */}
          {data?.cursor && (
            <div className="flex items-center justify-center pt-4">
              <Button variant="outline" size="sm" onClick={() => setCursor(data.cursor!)}>
                Load More Results
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
