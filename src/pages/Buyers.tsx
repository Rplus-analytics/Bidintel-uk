import { useMemo, useState } from "react";
import { Building2, ExternalLink, TrendingUp, Loader2, RefreshCw, Info, Linkedin, Globe, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLiveNotices } from "@/hooks/useLiveNotices";
import { formatCurrency } from "@/data/mockData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrgMember { name: string; title: string; linkedin: string; level?: number; }
interface BuyerProfile {
  description: string;
  website?: string;
  headquarters?: string;
  sector?: string;
  orgChart: OrgMember[];
}

const CACHE_KEY = "buyers:profile-cache";
function loadCache(): Record<string, BuyerProfile> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveCache(c: Record<string, BuyerProfile>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export default function Buyers() {
  const { data, isLoading, isError, refetch } = useLiveNotices({ daysBack: 365, limit: 30000 });
  const notices = data?.notices || [];

  const [openBuyer, setOpenBuyer] = useState<string | null>(null);
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const buyers = useMemo(() => {
    const map = new Map<string, { name: string; contracts: number; spend: number; sectors: Set<string>; sources: Set<string>; openCount: number; notices: typeof notices }>();
    // Collapse near-duplicate notices within a buyer (FTS publishes one row per lot,
    // tenderUpdate amendments mirror originals, etc.).
    // Bucket = buyer|published-day|£M-value-bucket. Within a bucket, two notices
    // collapse if their normalised-title token sets have Jaccard similarity ≥ 0.8.
    // This catches "Rehabilitative Services for Men in Prison or in the Community"
    // vs "...for men in prison or the Community" while keeping genuinely different
    // notices apart.
    const MAX_SANE_VALUE = 10_000_000_000;
    const STOP = new Set(["the","a","an","of","for","in","on","to","and","or","at","by","with","from","is","be"]);
    const tokenise = (t: string): Set<string> => {
      const toks = (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
        .filter((w) => w.length > 1 && !STOP.has(w));
      return new Set(toks);
    };
    const jaccard = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0 && b.size === 0) return 1;
      let inter = 0;
      for (const x of a) if (b.has(x)) inter += 1;
      const union = a.size + b.size - inter;
      return union === 0 ? 0 : inter / union;
    };
    const buckets = new Map<string, Array<Set<string>>>();
    for (const n of notices) {
      if (!n.buyer) continue;
      const buyerKey = n.buyer;
      const rawVal = n.value || n.valueHigh || 0;
      const day = (n.publishedDate || "").slice(0, 10);
      const valBucket = Math.round(rawVal / 1_000_000);
      const bucketKey = `${buyerKey}|${day}|${valBucket}`;
      const tokens = tokenise(n.title);
      const existing = buckets.get(bucketKey);
      if (existing) {
        let isDup = false;
        for (const prev of existing) {
          if (jaccard(prev, tokens) >= 0.8) { isDup = true; break; }
        }
        if (isDup) continue;
        existing.push(tokens);
      } else {
        buckets.set(bucketKey, [tokens]);
      }

      // Authoritative OCDS flags from raw_json (FTS rows):
      //  - tag "planning" → PIN / market engagement (budget estimate, not awarded)
      //  - tag "tenderUpdate" → amendment of an existing notice (duplicate value)
      //  - techniques.hasFrameworkAgreement → multi-year framework ceiling
      const tags = (n.noticeTag || []).map((t) => t.toLowerCase());
      const isPlanning = tags.includes("planning");
      const isTenderUpdate = tags.includes("tenderupdate");
      const isFrameworkFlag = n.isFramework === true;

      // Keyword fallback for sources without OCDS structure (e.g. CF rows).
      const titleLower = (n.title || "").toLowerCase();
      const noticeTypeLower = (n.noticeType || "").toLowerCase();
      const keywordFramework =
        titleLower.includes("framework") ||
        titleLower.includes(" dps") ||
        titleLower.includes("dynamic purchasing") ||
        noticeTypeLower.includes("framework");

      const excludeFromSpend = isPlanning || isTenderUpdate || isFrameworkFlag || keywordFramework;
      const cur = (n.currency || "GBP").toUpperCase();
      const includeInSpend =
        (cur === "GBP" || cur === "") && rawVal > 0 && rawVal <= MAX_SANE_VALUE && !excludeFromSpend;

      const entry = map.get(buyerKey) || { name: buyerKey, contracts: 0, spend: 0, sectors: new Set<string>(), sources: new Set<string>(), openCount: 0, notices: [] as typeof notices };
      entry.contracts += 1;
      if (includeInSpend) entry.spend += rawVal;
      if (n.sector) entry.sectors.add(n.sector);
      entry.sources.add(n.source);
      const s = (n.status || "").toLowerCase();
      if (s.includes("open") || s === "published") entry.openCount += 1;
      entry.notices.push(n);
      map.set(buyerKey, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => b.spend - a.spend || b.contracts - a.contracts);
  }, [notices]);

  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(30);
  const filteredBuyers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return buyers;
    return buyers.filter((b) => b.name.toLowerCase().includes(q));
  }, [buyers, query]);
  const pagedBuyers = filteredBuyers.slice(0, visible);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Cache buster: invalidate old cache without `level`
  const CACHE_VERSION_KEY = "buyers:profile-cache:v";
  if (typeof window !== "undefined" && localStorage.getItem(CACHE_VERSION_KEY) !== "2") {
    try { localStorage.removeItem(CACHE_KEY); localStorage.setItem(CACHE_VERSION_KEY, "2"); } catch { /* ignore */ }
  }

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
      const next = { ...cache, [name]: p };
      saveCache(next);
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
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Buyer Profiles</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Public sector buyers across Contracts Finder, PCS, Find a Tender and Contract Award Service.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Aggregating buyer data...</p>
        </div>
      )}

      {isError && (
        <div className="glass-card p-8 text-center border-destructive/30">
          <p className="text-destructive font-medium">Failed to load buyers</p>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {Math.min(pagedBuyers.length, filteredBuyers.length).toLocaleString()} of {filteredBuyers.length.toLocaleString()} buyers
              {query ? ` matching "${query}"` : ""}
            </p>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search buyer name..."
                value={query}
                onChange={(e) => { setQuery(e.target.value); setVisible(30); }}
                className="pl-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pagedBuyers.map((b, i) => (
            <div key={b.name} className="glass-card p-5 hover:border-primary/30 transition-colors opacity-0 animate-fade-in" style={{ animationDelay: `${Math.min(i, 20) * 40}ms` }}>
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
                  <p className="text-xs text-muted-foreground">Total notice value (365 days)</p>
                  <div className="flex gap-4 mt-3 text-sm flex-wrap">
                    <span><strong>{b.contracts}</strong> <span className="text-muted-foreground">notices</span></span>
                    {b.openCount > 0 && (
                      <span className="flex items-center gap-1 text-warning">
                        <TrendingUp className="h-3.5 w-3.5" />
                        <strong>{b.openCount}</strong> <span className="text-muted-foreground">open</span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {Array.from(b.sectors).slice(0, 4).map(s => <span key={s} className="px-2 py-0.5 bg-secondary rounded text-xs text-muted-foreground">{s}</span>)}
                    {Array.from(b.sources).map(s => <span key={s} className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">{s}</span>)}
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <button
                      onClick={() => openAbout(b.name)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <Info className="h-3.5 w-3.5" /> About Buyer
                    </button>
                    <button
                      onClick={() => setExpanded(e => ({ ...e, [b.name]: !e[b.name] }))}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      {expanded[b.name] ? "Hide" : "Show"} {b.contracts} notice{b.contracts === 1 ? "" : "s"}
                    </button>
                  </div>
                  {expanded[b.name] && (
                    <ul className="mt-3 space-y-1.5 border-t border-border pt-3 max-h-64 overflow-y-auto">
                      {b.notices.map((n, idx) => (
                        <li key={`${n.id}-${idx}`} className="text-xs">
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-start gap-1.5 text-foreground hover:text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                            <span className="line-clamp-2">{n.title}</span>
                          </a>
                          <div className="text-[10px] text-muted-foreground ml-4.5 mt-0.5">
                            {n.publishedDate?.slice(0, 10)} · {n.source}
                            {(n.value || n.valueHigh) ? ` · ${formatCurrency(n.value || n.valueHigh)}` : ""}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          ))}
            {filteredBuyers.length === 0 && (
              <div className="glass-card p-12 text-center md:col-span-2">
                <p className="text-muted-foreground">No buyer data available.</p>
              </div>
            )}
          </div>
          {visible < filteredBuyers.length && (
            <div className="text-center pt-2">
              <Button variant="outline" onClick={() => setVisible((v) => v + 30)}>
                Show more buyers ({filteredBuyers.length - visible} remaining)
              </Button>
            </div>
          )}
        </>
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
                ) : (() => {
                  const groups = new Map<number, OrgMember[]>();
                  profile.orgChart.forEach((m) => {
                    const lvl = m.level ?? 3;
                    if (!groups.has(lvl)) groups.set(lvl, []);
                    groups.get(lvl)!.push(m);
                  });
                  const levels = Array.from(groups.keys()).sort((a, b) => a - b);
                  const tierColors = [
                    "bg-primary/15 border-primary/40 text-foreground",
                    "bg-primary/10 border-primary/25",
                    "bg-secondary border-border",
                    "bg-muted/50 border-border",
                  ];
                  return (
                    <div className="space-y-3">
                      {levels.map((lvl, tierIdx) => {
                        const members = groups.get(lvl)!;
                        return (
                          <div key={lvl} className="relative">
                            {tierIdx > 0 && (
                              <div className="absolute left-1/2 -top-3 w-px h-3 bg-border -translate-x-1/2" aria-hidden />
                            )}
                            <div className="flex flex-wrap justify-center gap-2">
                              {members.map((m, idx) => (
                                <div
                                  key={idx}
                                  className={`flex items-center gap-2 p-2.5 rounded-lg border ${tierColors[Math.min(tierIdx, tierColors.length - 1)]} min-w-[180px] max-w-[260px] flex-1`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate">{m.name}</p>
                                    <p className="text-[11px] text-muted-foreground truncate">{m.title}</p>
                                  </div>
                                  {m.linkedin && (
                                    <a
                                      href={m.linkedin}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md bg-primary/10 text-primary hover:bg-primary/20"
                                      aria-label={`${m.name} LinkedIn`}
                                    >
                                      <Linkedin className="h-3.5 w-3.5" />
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
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
