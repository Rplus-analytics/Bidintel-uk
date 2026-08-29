import { useMemo, useState } from "react";
import { Building2, ExternalLink, TrendingUp, Loader2, RefreshCw, Info, Linkedin, Globe, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/data/mockData";
import { toast } from "sonner";

interface OrgMember { name: string; title: string; linkedin: string; level?: number; }
interface BuyerProfile {
  description: string;
  website?: string;
  headquarters?: string;
  sector?: string;
  orgChart: OrgMember[];
}

const CACHE_KEY = "cf-buyers:profile-cache";
function loadCache(): Record<string, BuyerProfile> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveCache(c: Record<string, BuyerProfile>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

interface BuyerAgg {
  name: string;
  contracts: number;
  spend: number;
  openCount: number;
  cpvs: Set<string>;
}

export default function ContractsFinderBuyers() {
  const [period, setPeriod] = useState<"30" | "90" | "180" | "365">("90");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"spend" | "contracts" | "active" | "name">("spend");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["cf-buyers", period],
    queryFn: async () => {
      const sinceDate = new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString();
      const PAGE = 1000;
      const rows: { payload: any }[] = [];
      let from = 0;
      // Page through up to ~5000 rows
      for (let i = 0; i < 5; i++) {
        const { data, error } = await supabase
          .from("raw_contracts_finder")
          .select("payload")
          .gte("published_date", sinceDate)
          .order("published_date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data || []) as { payload: any }[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    },
    staleTime: 60_000,
  });

  const buyers = useMemo(() => {
    const map = new Map<string, BuyerAgg>();
    for (const r of data || []) {
      const t = r.payload?.tender || {};
      const name = r.payload?.buyer?.name;
      if (!name) continue;
      const cur = map.get(name) || { name, contracts: 0, spend: 0, openCount: 0, cpvs: new Set<string>() };
      cur.contracts += 1;
      cur.spend += Number(t.value?.amount ?? 0);
      const status = (t.status || "").toLowerCase();
      if (status === "active") cur.openCount += 1;
      const cpv = t.classification?.id;
      if (cpv) cur.cpvs.add(String(cpv).slice(0, 2));
      map.set(name, cur);
    }
    let arr = Array.from(map.values());
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter((b) => b.name.toLowerCase().includes(q));
    }
    const sorted = [...arr].sort((a, b) => {
      if (sortBy === "contracts") return b.contracts - a.contracts || b.spend - a.spend;
      if (sortBy === "active") return b.openCount - a.openCount || b.spend - a.spend;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return b.spend - a.spend || b.contracts - a.contracts;
    });
    return { all: arr, list: sorted.slice(0, 60) };
  }, [data, search, sortBy]);

  const [openBuyer, setOpenBuyer] = useState<string | null>(null);
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const openAbout = async (name: string) => {
    setOpenBuyer(name);
    setProfile(null);
    const cache = loadCache();
    if (cache[name]) { setProfile(cache[name]); return; }
    setProfileLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("buyer-profile", { body: { buyer: name } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const p = data as BuyerProfile;
      setProfile(p);
      saveCache({ ...cache, [name]: p });
    } catch (e) {
      toast.error(`Failed to load buyer profile: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setProfileLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Contracts Finder Buyers</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Buyer activity from the Contracts Finder archive
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)} className="w-full">
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="30">Last 30 Days</TabsTrigger>
          <TabsTrigger value="90">Last 90 Days</TabsTrigger>
          <TabsTrigger value="180">Last 180 Days</TabsTrigger>
          <TabsTrigger value="365">Last 365 Days</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="glass-card p-3 sm:p-4 flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Filter buyers by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-secondary border-border flex-1"
        />
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="bg-secondary border-border sm:w-56">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spend">Sort: Total Notice Value</SelectItem>
            <SelectItem value="contracts">Sort: Notice Count</SelectItem>
            <SelectItem value="active">Sort: Active Notices</SelectItem>
            <SelectItem value="name">Sort: Name (A–Z)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isLoading && !isFetching && !isError && (
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">{buyers.all.length.toLocaleString()}</strong> buyers
          {search.trim() ? " match filter" : ` in last ${period} days`}
          {buyers.all.length > buyers.list.length && ` · showing top ${buyers.list.length}`}
        </div>
      )}

      {(isLoading || isFetching) && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Aggregating Contracts Finder buyers...</p>
        </div>
      )}

      {isError && (
        <div className="glass-card p-8 text-center border-destructive/30">
          <p className="text-destructive font-medium">Failed to load buyers</p>
        </div>
      )}

      {!isLoading && !isFetching && !isError && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {buyers.list.map((b, i) => (
            <div key={b.name} className="glass-card p-5 hover:border-primary/30 transition-colors opacity-0 animate-fade-in" style={{ animationDelay: `${i * 30}ms` }}>
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-primary/10 shrink-0">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm sm:text-base line-clamp-1">{b.name}</h3>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </div>
                  <p className="text-xl font-bold text-primary mt-1">{formatCurrency(b.spend)}</p>
                  <p className="text-xs text-muted-foreground">Total notice value (last {period} days)</p>
                  <div className="flex gap-4 mt-3 text-sm flex-wrap">
                    <span><strong>{b.contracts}</strong> <span className="text-muted-foreground">notices</span></span>
                    {b.openCount > 0 && (
                      <span className="flex items-center gap-1 text-warning">
                        <TrendingUp className="h-3.5 w-3.5" />
                        <strong>{b.openCount}</strong> <span className="text-muted-foreground">active</span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {Array.from(b.cpvs).slice(0, 6).map((c) => (
                      <span key={c} className="px-2 py-0.5 bg-secondary rounded text-xs text-muted-foreground">CPV {c}</span>
                    ))}
                    <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">cf</span>
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={() => openAbout(b.name)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <Info className="h-3.5 w-3.5" /> About Buyer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {buyers.list.length === 0 && (
            <div className="glass-card p-12 text-center md:col-span-2">
              <p className="text-muted-foreground">No buyers found for this period.</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!openBuyer} onOpenChange={(o) => { if (!o) { setOpenBuyer(null); setProfile(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {openBuyer}
            </DialogTitle>
            <DialogDescription>About this buyer & key leadership</DialogDescription>
          </DialogHeader>

          {profileLoading && (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Generating profile...</p>
            </div>
          )}

          {!profileLoading && profile && (
            <div className="space-y-5">
              <section>
                <h4 className="text-sm font-semibold mb-2">Description</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{profile.description}</p>
                <div className="flex flex-wrap gap-3 mt-3 text-xs">
                  {profile.website && (
                    <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Globe className="h-3.5 w-3.5" /> Website
                    </a>
                  )}
                  {profile.headquarters && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" /> {profile.headquarters}
                    </span>
                  )}
                  {profile.sector && (
                    <span className="px-2 py-0.5 bg-primary/10 text-primary rounded">{profile.sector}</span>
                  )}
                </div>
              </section>

              <section>
                <h4 className="text-sm font-semibold mb-3">Org Chart</h4>
                {profile.orgChart.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leadership data available.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {profile.orgChart.map((m, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2.5 rounded-lg border bg-secondary border-border min-w-[180px] max-w-[260px] flex-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{m.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{m.title}</p>
                        </div>
                        {m.linkedin && (
                          <a href={m.linkedin} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md bg-primary/10 text-primary hover:bg-primary/20" aria-label={`${m.name} LinkedIn`}>
                            <Linkedin className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-3">
                  AI-generated. Verify names, titles & LinkedIn URLs before outreach.
                </p>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
