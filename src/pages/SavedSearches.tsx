import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Search as SearchIcon, Loader2, Mail, Zap, Plus } from "lucide-react";
import { SavedSearchCard } from "@/components/SavedSearchCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SearchAutocomplete } from "@/components/SearchAutocomplete";
import { BuyerAutocomplete, CpvAutocomplete } from "@/components/filters/SharedAutocompletes";


type SourceFilter =
  | "all"
  | "contracts-finder"
  | "scotland"
  | "find-a-tender"
  | "ted"
  | "sell2wales"
  | "etenders-ie"
  | "etenders-ni";

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

interface SavedSearchRow {
  id: string;
  name: string;
  source: SourceFilter | null;
  buyer: string | null;
  supplier: string | null;
  min_value: number | null;
  max_value: number | null;
  published_from: string | null;
  published_to: string | null;
  cpv: string | null;
  notice_type: string | null;
  filters: Partial<Filters> & { keyword?: string } | null;
  created_at: string;
  active?: boolean | null;
  last_alerted_at?: string | null;
}

export interface AppliedSavedSearch {
  id: string;
  name: string;
  keyword: string;
  source: SourceFilter;
  filters: Filters;
  createdAt: number;
  active?: boolean;
  lastAlertedAt?: string | null;
}


const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: "All sources",
  "contracts-finder": "Contracts Finder (UK)",
  scotland: "Public Contracts Scotland",
  "find-a-tender": "Find a Tender (FTS)",
  ted: "TED (EU)",
  sell2wales: "Sell2Wales",
  "etenders-ie": "eTenders Ireland",
  "etenders-ni": "eTenders NI",
};

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

export function rowToApplied(r: SavedSearchRow): AppliedSavedSearch {
  const f = { ...EMPTY_FILTERS, ...(r.filters || {}) };
  // Promote structured columns into the Filters shape used by the UI
  if (r.buyer) f.buyer = r.buyer;
  if (r.supplier) f.supplier = r.supplier;
  if (r.min_value != null) f.minValue = String(r.min_value);
  if (r.max_value != null) f.maxValue = String(r.max_value);
  if (r.published_from) f.publishedFrom = r.published_from;
  if (r.published_to) f.publishedTo = r.published_to;
  if (r.cpv) f.cpv = r.cpv;
  if (r.notice_type) f.noticeType = r.notice_type;
  return {
    id: r.id,
    name: r.name,
    keyword: r.filters?.keyword || "",
    source: (r.source as SourceFilter) || "all",
    filters: f,
    createdAt: new Date(r.created_at).getTime(),
    active: r.active ?? false,
    lastAlertedAt: r.last_alerted_at ?? null,
  };
}


function summarizeFilters(f: Filters): string[] {
  const out: string[] = [];
  if (f.keyword) out.push(`keyword: "${f.keyword}"`);
  if (f.stages.length) out.push(`stages: ${f.stages.join(", ")}`);
  if (f.buyer) out.push(`buyer: ${f.buyer}`);
  if (f.supplier) out.push(`supplier: ${f.supplier}`);
  if (f.minValue || f.maxValue) out.push(`value: ${f.minValue || "0"} – ${f.maxValue || "∞"}`);
  if (f.publishedFrom || f.publishedTo) out.push(`published: ${f.publishedFrom || "…"} → ${f.publishedTo || "…"}`);
  if (f.deadlineFrom || f.deadlineTo) out.push(`deadline: ${f.deadlineFrom || "…"} → ${f.deadlineTo || "…"}`);
  if (Number(f.minScore || 0) > 0) out.push(`BidIntel ≥ ${f.minScore}`);
  if (f.framework) out.push(`framework: ${f.framework}`);
  if (f.cpv) out.push(`CPV: ${f.cpv}`);
  if (f.noticeType) out.push(`notice: ${f.noticeType}`);
  if (f.showHidden) out.push("hidden only");
  return out;
}

export default function SavedSearches() {
  const navigate = useNavigate();
  const { membership, user } = useAuth();
  const orgId = membership?.organisation_id;
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["saved-searches", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_searches")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SavedSearchRow[];
    },
    enabled: !!orgId,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_searches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", orgId] }),
  });

  const toggleDigestMut = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("saved_searches").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", orgId] }),
  });


  const searches = rows.map(rowToApplied);

  const handleRun = (s: AppliedSavedSearch) => {
    navigate("/contracts", { state: { applySavedSearch: s } });
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteMut.mutateAsync(id);
      toast.success(`Deleted "${name}"`);
    } catch (e: any) {
      toast.error(e.message || "Failed to delete");
    }
  };

  const handleToggleDigest = async (s: AppliedSavedSearch) => {
    const next = !s.active;
    try {
      await toggleDigestMut.mutateAsync({ id: s.id, active: next });
      toast.success(
        next
          ? `Daily digest enabled — you'll get an email every 24h when new contracts match "${s.name}"`
          : `Daily digest disabled for "${s.name}"`
      );
    } catch (e: any) {
      toast.error(e.message || "Failed to update");
    }
  };

  // [QA UTILITY — TEMPORARY] Manual trigger for the daily-search-alerts edge function,
  // scoped to the currently authenticated user only. Safe to remove after testing.
  const [qaRunning, setQaRunning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    keyword: "",
    source: "all" as SourceFilter,
    buyer: "",
    minValue: "",
    maxValue: "",
    cpv: "",
    active: true,
  });
  const [creating, setCreating] = useState(false);

  const resetForm = () =>
    setForm({ name: "", keyword: "", source: "all", buyer: "", minValue: "", maxValue: "", cpv: "", active: true });

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Please enter a name");
      return;
    }
    if (!orgId) {
      toast.error("No organisation context");
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from("saved_searches").insert({
        organisation_id: orgId,
        user_id: user?.id,
        name: form.name.trim(),
        active: form.active,
        email_recipients: [user?.email].filter(Boolean),
        // Leave last_alerted_at NULL so the next scheduled run sends the
        // "first digest" email immediately instead of being throttled by the
        // 24-hour window and filtered by an incremental floor.
        last_alerted_at: null,
        source: form.source,
        buyer: form.buyer || null,
        supplier: null,
        min_value: form.minValue ? Number(form.minValue) : null,
        max_value: form.maxValue ? Number(form.maxValue) : null,
        published_from: null,
        published_to: null,
        cpv: form.cpv || null,
        notice_type: null,
        filters: {
          keyword: form.keyword,
          stages: [],
          deadlineFrom: "",
          deadlineTo: "",
          minScore: "0",
          framework: "",
          showHidden: false,
        },
      });
      if (error) throw error;
      toast.success(`Saved search "${form.name}" created`);
      qc.invalidateQueries({ queryKey: ["saved-searches", orgId] });
      setCreateOpen(false);
      resetForm();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create saved search");
    } finally {
      setCreating(false);
    }
  };

  const handleQaRunMyDigest = async () => {
    setQaRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-search-alerts", {
        body: { force: true, currentUserOnly: true },
      });
      if (error) throw error;
      const results: any[] = (data?.results as any[]) ?? [];
      const emailsSent = results.filter((r) => r.email).length;
      const errs = results.filter((r) => r.error);
      toast.success(
        `Processed ${results.length} of your saved searches · ${emailsSent} email${emailsSent === 1 ? "" : "s"} sent`
      );
      if (errs.length) {
        toast.error(`${errs.length} error${errs.length === 1 ? "" : "s"}: ${errs[0].error}`);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to run digest");
    } finally {
      setQaRunning(false);
    }
  };


  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Star className="h-5 w-5 text-primary" /> Saved Searches
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-xl">
            Monitor your procurement interests and receive notifications when relevant public sector tenders are published.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" /> Create Saved Search
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" /> Create a Saved Search
            </DialogTitle>
            <DialogDescription>
              Set up a monitor for new public sector tenders. We'll match it against incoming notices so you can review matching tenders and (optionally) receive a daily digest by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ss-name">Name <span className="text-destructive">*</span></Label>
              <Input
                id="ss-name"
                placeholder="e.g. School catering – Scotland"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ss-keyword">Keyword</Label>
              <SearchAutocomplete
                value={form.keyword}
                onChange={(v) => setForm((f) => ({ ...f, keyword: v }))}
                placeholder="e.g. school catering"
              />
              <p className="text-[11px] text-muted-foreground">
                Uses the same semantic search as the Contracts page — start typing a service or category.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v as SourceFilter }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOURCE_LABELS) as SourceFilter[]).map((k) => (
                    <SelectItem key={k} value={k}>{SOURCE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ss-buyer">Buyer (optional)</Label>
              <BuyerAutocomplete
                value={form.buyer}
                onChange={(v) => setForm((f) => ({ ...f, buyer: v }))}
                placeholder="e.g. Glasgow City Council"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ss-min">Min value (£)</Label>
                <Input id="ss-min" type="number" inputMode="numeric" placeholder="0"
                  value={form.minValue}
                  onChange={(e) => setForm((f) => ({ ...f, minValue: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ss-max">Max value (£)</Label>
                <Input id="ss-max" type="number" inputMode="numeric" placeholder="No limit"
                  value={form.maxValue}
                  onChange={(e) => setForm((f) => ({ ...f, maxValue: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ss-cpv">Service category / CPV (optional)</Label>
              <CpvAutocomplete
                value={form.cpv}
                onChange={(v) => setForm((f) => ({ ...f, cpv: v }))}
                placeholder="e.g. 55524 or 'School meals'"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4 rounded border-input"
              />
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              Email me a daily digest when new tenders match
            </label>
            <p className="text-xs text-muted-foreground">
              Need more filters (dates, frameworks, stages…)? Build the search on the Contracts page and click Save Search there.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        {isLoading ? (
          <div className="glass-card p-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          </div>
        ) : searches.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <SearchIcon className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No saved searches yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Set filters on the Contracts page and click <span className="font-medium">Save Search</span>.
            </p>
            <Button size="sm" className="mt-4" onClick={() => navigate("/contracts")}>
              Go to Contracts
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {searches.map((s) => {
              const chips: string[] = [];
              if (s.source && s.source !== "all") chips.push(SOURCE_LABELS[s.source]);
              else chips.push("All Sources");
              if (s.keyword) chips.push(s.keyword);
              chips.push(...summarizeFilters({ ...s.filters, keyword: "" }));
              return (
                <SavedSearchCard
                  key={s.id}
                  name={s.name}
                  chips={chips}
                  digestActive={!!s.active}
                  digestPending={toggleDigestMut.isPending}
                  onViewMatching={() => handleRun(s)}
                  onFindNew={() => handleRun(s)}
                  onToggleDigest={() => handleToggleDigest(s)}
                  onEdit={() => handleRun(s)}
                  onDelete={() => handleDelete(s.id, s.name)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* [QA UTILITY — TEMPORARY] Manual trigger for the daily-search-alerts edge function. */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-dashed"
          onClick={handleQaRunMyDigest}
          disabled={qaRunning || searches.length === 0}
          title="QA only: triggers daily-search-alerts for YOUR active saved searches with force=true"
        >
          {qaRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {qaRunning ? "Running…" : "Run My Daily Digest Now (QA)"}
        </Button>
      </div>
    </div>
  );
}
