import { Fragment, useEffect, useMemo, useState } from "react";
import { Users, Award, Loader2, RefreshCw, Building2, ArrowUpDown, ExternalLink, ChevronDown, Calendar, Banknote, Database } from "lucide-react";
import { Button } from "@/components/ui/button";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/data/mockData";
import { resolveSourceUrl } from "@/lib/sourceUrl";

type AwardItem = {
  id: string;
  title: string | null;
  buyer_name: string | null;
  award_date: string | null;
  award_value: number | null;
  source: string | null;
  source_url: string | null;
};


type SupplierRow = {
  supplier_name: string;
  total_awards: number;
  total_value: number;
  awards_with_value: number;
  buyers: number;
  sources: string[];
  awards: AwardItem[];
};


type SectorRow = {
  sector: string;
  awards: number;
  value: number;
  buyers: Set<string>;
  sources: Set<string>;
};

const SOURCE_LABELS: Record<string, string> = {
  cf: "Contracts Finder",
  fts: "Find a Tender",
  contracts_scotland: "Public Contracts Scotland",
  pcs: "Public Contracts Scotland",
  ccs_digital_outcomes: "CCS Digital Outcomes",
  ted: "TED EU",
  sell2wales: "Sell2Wales",
  etenders_ie: "eTenders IE",
  etenders_ni: "eTenders NI",
};

const getDocumentNoticeUrl = (raw: any, source: string | null): string | null => {
  const docs = Array.isArray(raw?.documents) ? raw.documents : [];
  const direct = docs.find((doc: any) => typeof doc?.url === "string" && doc.url.includes("/Notice/"))?.url;
  if (direct) return direct;

  if (source === "fts") {
    const noticeId = docs
      .map((doc: any) => (typeof doc?.id === "string" ? doc.id : ""))
      .find((id: string) => /^\d{6}-\d{4}$/.test(id));
    return noticeId ? `https://www.find-tender.service.gov.uk/Notice/${noticeId}` : null;
  }

  return null;
};

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"value" | "awardsDesc" | "awardsAsc">("value");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;


  const load = async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      // PostgREST caps each request at 1000 rows regardless of range().
      // Paginate through the full tables in 1000-row chunks.
      const PAGE = 1000;
      const fetchAll = async <T,>(build: (from: number, to: number) => any): Promise<T[]> => {
        const out: T[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await build(from, from + PAGE - 1);
          if (error) throw error;
          const rows = (data as T[]) || [];
          out.push(...rows);
          if (rows.length < PAGE) break;
          if (from > 200_000) break; // safety guard
        }
        return out;
      };

      const [awsData, supData, awardsData, cpvRes] = await Promise.all([
        fetchAll<any>((f, t) => supabase.from("award_suppliers").select("supplier_id, award_id").range(f, t)),
        fetchAll<any>((f, t) => supabase.from("suppliers").select("id, name, name_canonical").range(f, t)),
        fetchAll<any>((f, t) => supabase
          .from("awards")
          .select("id, source, external_id, buyer_name, buyer_name_canonical, supplier_name, supplier_name_canonical, award_value, cpv_code, awarded_at, notice_id, raw")
          .range(f, t)),
        supabase.from("cpv_codes").select("code, label").eq("level", 1),
      ]);
      if (cpvRes.error) throw cpvRes.error;
      const awsRes = { data: awsData };
      const supRes = { data: supData };
      const awardsRes = { data: awardsData };

      // Resolve notice titles/links for awards that reference a notice
      const noticeIds = Array.from(
        new Set((awardsRes.data || []).map((a: any) => a.notice_id).filter(Boolean)),
      );
      const noticeMap = new Map<string, { title: string; link: string | null }>();
      for (let i = 0; i < noticeIds.length; i += 1000) {
        const chunk = noticeIds.slice(i, i + 1000);
        const { data: nRows } = await supabase
          .from("notices")
          .select("id, title, link, source_url")
          .in("id", chunk);
        (nRows || []).forEach((n: any) =>
          noticeMap.set(n.id, { title: n.title, link: n.link || n.source_url || null }),
        );
      }

      const supById = new Map<string, { name: string; canonical: string | null }>(
        (supRes.data || []).map((s: any) => [s.id, { name: s.name, canonical: s.name_canonical || null }]),
      );
      const awardById = new Map<string, any>(
        (awardsRes.data || []).map((a: any) => [a.id, a]),
      );

      const toAwardItem = (a: any): AwardItem => {
        const n = a.notice_id ? noticeMap.get(a.notice_id) : null;
        const raw = a.raw || {};
        const rawTitle =
          raw.contractTitle ||
          raw.procurementTitle ||
          raw.title ||
          raw.Title ||
          raw.name ||
          raw.lotTitle ||
          null;
        // external_id is `${ocid}:${awardId}` for OCDS-linked sources.
        const ocid = typeof a.external_id === "string" ? a.external_id.split(":")[0] : null;
        const rawLink =
          (typeof raw.url === "string" && raw.url) ||
          (typeof raw.link === "string" && raw.link) ||
          (typeof raw.noticeUrl === "string" && raw.noticeUrl) ||
          getDocumentNoticeUrl(raw, a.source) ||
          null;
        // Derive a direct FTS Notice URL from external_id first, since
        // resolveSourceUrl may otherwise return a weak search-fallback URL
        // (the FTS keyword search does not filter by OCID and lands on the
        // full result set / home page).
        let directNotice: string | null = null;
        if (ocid && a.source === "fts") {
          const rest = typeof a.external_id === "string" ? a.external_id.split(":")[1] || "" : "";
          const noticeId = rest.match(/^\d{6}-\d{4}/)?.[0];
          if (noticeId) directNotice = `https://www.find-tender.service.gov.uk/Notice/${noticeId}`;
        }
        let resolved = resolveSourceUrl({
          link: n?.link || rawLink || directNotice || null,
          source: a.source,
          ocid,
          releaseId: raw.releaseId || raw.release_id || null,
          externalId: a.external_id || null,
        });
        // If the resolver returned a weak search-fallback but we have a direct
        // Notice URL, prefer the direct notice.
        if (directNotice && (!resolved || resolved.includes("/Search/Results?Keywords="))) {
          resolved = directNotice;
        }
        // Fallbacks for OCDS sources where notice_id isn't populated on awards.
        if (!resolved && ocid) {
          if (a.source === "cf") {
            // OCID's inner GUID does NOT equal the Notice page GUID, so fall
            // back to a Contracts Finder search keyed off the OCID.
            resolved = `https://www.contractsfinder.service.gov.uk/Search/Results?Keywords=${encodeURIComponent(ocid)}`;
          } else if (a.source === "pcs" || a.source === "contracts_scotland") {
            resolved = `https://www.publiccontractsscotland.gov.uk/search/Search_Switch.aspx?ID=${encodeURIComponent(ocid)}`;
          }
        }
        return {
          id: a.id,
          title: rawTitle || n?.title || null,
          buyer_name: a.buyer_name,
          award_date: a.awarded_at,
          award_value: a.award_value ? Number(a.award_value) : null,
          source: a.source ? SOURCE_LABELS[a.source] || a.source : null,
          source_url: resolved || null,
        };
      };


      const sMap = new Map<
        string,
        {
          name: string;
          awards: Map<string, AwardItem>;
          value: number;
          awardsWithValue: number;
          buyers: Set<string>;
          sources: Set<string>;
        }
      >();
      const emptySupplier = (name: string) => ({
        name,
        awards: new Map<string, AwardItem>(),
        value: 0,
        awardsWithValue: 0,
        buyers: new Set<string>(),
        sources: new Set<string>(),
      });

      for (const link of awsRes.data || []) {
        const sup = supById.get((link as any).supplier_id);
        const award = awardById.get((link as any).award_id);
        if (!sup || !sup.name || !award) continue;
        // Group by canonical name so variants collapse into one supplier row
        const key = sup.canonical || sup.name.toLowerCase();
        const cur = sMap.get(key) || emptySupplier(sup.name);
        if (!cur.awards.has(award.id)) {
          cur.awards.set(award.id, toAwardItem(award));
          const raw = Number(award.award_value || 0);
          if (raw > 0) {
            cur.value += raw;
            cur.awardsWithValue += 1;
          }
        }
        // Count unique buyers by canonical
        const buyerKey = award.buyer_name_canonical || (award.buyer_name || "").toLowerCase();
        if (buyerKey) cur.buyers.add(buyerKey);
        if (award.source) cur.sources.add(SOURCE_LABELS[award.source] || award.source);
        sMap.set(key, cur);
      }




      // Filter out placeholder / non-supplier text that some buyers put in the supplier field
      const PLACEHOLDER_PATTERNS = [
        /list of successful suppliers/i,
        /available on contracts finder/i,
        /see attachment/i,
        /please see (attachments?|notice|award)/i,
        /see award notice/i,
        /see notice/i,
        /^n\/?a\.?$/i,
        /^not applicable$/i,
        /^tbc$/i,
        /^tbd$/i,
        /^various suppliers?$/i,
        /^multiple suppliers?$/i,
        /^unknown$/i,
        /^withheld$/i,
        /^redacted$/i,
      ];
      const isPlaceholder = (name: string) =>
        !name || name.trim().length < 2 || PLACEHOLDER_PATTERNS.some((r) => r.test(name.trim()));

      const supplierRows: SupplierRow[] = Array.from(sMap.values())
        .filter((s) => !isPlaceholder(s.name))
        .map((s) => ({
          supplier_name: s.name,
          total_awards: s.awards.size,
          total_value: s.value,
          awards_with_value: s.awardsWithValue,
          buyers: s.buyers.size,
          sources: Array.from(s.sources),
          awards: Array.from(s.awards.values()).sort((a, b) =>
            (b.award_date || "").localeCompare(a.award_date || ""),
          ),
        }))
        .sort((a, b) => b.total_value - a.total_value || b.total_awards - a.total_awards);
      setSuppliers(supplierRows);


      // 2. Sector aggregation (existing behaviour, moved to its own tab)
      const cpvLabels: Record<string, string> = {};
      (cpvRes.data || []).forEach((r: any) => {
        cpvLabels[r.code.substring(0, 2)] = r.label;
      });
      const secMap = new Map<string, SectorRow>();
      for (const a of awardsRes.data || []) {
        const div = (a as any).cpv_code ? (a as any).cpv_code.substring(0, 2) : null;
        const sector = (div && cpvLabels[div]) || "Unspecified";
        const cur =
          secMap.get(sector) ||
          { sector, awards: 0, value: 0, buyers: new Set<string>(), sources: new Set<string>() };
        cur.awards += 1;
        cur.value += Number((a as any).award_value || 0);
        const bKey = (a as any).buyer_name_canonical || ((a as any).buyer_name || "").toLowerCase();
        if (bKey) cur.buyers.add(bKey);
        if ((a as any).source) cur.sources.add(SOURCE_LABELS[(a as any).source] || (a as any).source);
        secMap.set(sector, cur);
      }
      setSectors(
        Array.from(secMap.values()).sort(
          (a, b) => b.value - a.value || b.awards - a.awards,
        ),
      );
    } catch (e) {
      console.error("Suppliers load failed", e);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q ? suppliers.filter((s) => s.supplier_name.toLowerCase().includes(q)) : [...suppliers];
    if (sortMode === "awardsDesc") {
      rows.sort((a, b) => b.total_awards - a.total_awards || b.total_value - a.total_value);
    } else if (sortMode === "awardsAsc") {
      rows.sort((a, b) => a.total_awards - b.total_awards || b.total_value - a.total_value);
    } else {
      rows.sort((a, b) => b.total_value - a.total_value || b.total_awards - a.total_awards);
    }
    return rows;
  }, [suppliers, query, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filteredSuppliers.length);
  const pagedSuppliers = filteredSuppliers.slice(pageStart, pageEnd);

  useEffect(() => {
    setPage(1);
  }, [query, sortMode]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Companies winning public sector contracts across Contracts Finder, PCS, Find a Tender and Contract Award Service.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="glass-card p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">Aggregating supplier data...</p>
        </div>
      )}

      {isError && (
        <div className="glass-card p-8 text-center border-destructive/30">
          <p className="text-destructive font-medium">Failed to load suppliers</p>
        </div>
      )}

      {!isLoading && !isError && (
        <Tabs defaultValue="companies" className="space-y-4">
          <TabsList>
            <TabsTrigger value="companies">Supplier Companies</TabsTrigger>
            <TabsTrigger value="sectors">Market Sectors</TabsTrigger>
          </TabsList>

          <TabsContent value="companies" className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-muted-foreground">
                {filteredSuppliers.length === 0
                  ? `${suppliers.length.toLocaleString()} suppliers`
                  : `Showing ${(pageStart + 1).toLocaleString()}–${pageEnd.toLocaleString()} of ${filteredSuppliers.length.toLocaleString()} suppliers`}
              </p>
              <Input
                placeholder="Search supplier name..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <div className="glass-card overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Supplier</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <button
                        onClick={() =>
                          setSortMode((prev) => (prev === "awardsDesc" ? "awardsAsc" : prev === "awardsAsc" ? "value" : "awardsDesc"))
                        }
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        aria-label="Sort awards won"
                      >
                        Awards Won
                        <ArrowUpDown
                          className={`h-3.5 w-3.5 ${sortMode !== "value" ? "text-primary" : ""}`}
                        />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Value</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Buyers</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSuppliers.map((s) => {
                    const isOpen = !!expanded[s.supplier_name];
                    return (
                      <Fragment key={s.supplier_name}>
                        <tr key={s.supplier_name} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-lg bg-primary/10"><Building2 className="h-4 w-4 text-primary" /></div>
                              <span className="font-medium text-sm">{s.supplier_name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <button
                              onClick={() => setExpanded((e) => ({ ...e, [s.supplier_name]: !e[s.supplier_name] }))}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                              aria-expanded={isOpen}
                            >
                              <Award className="h-3.5 w-3.5" />
                              {s.total_awards.toLocaleString()}
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            </button>
                          </td>
                          <td className="px-5 py-4 text-sm font-semibold text-primary">
                            {s.awards_with_value > 0 ? formatCurrency(s.total_value) : <span className="text-muted-foreground font-normal">—</span>}
                            {s.awards_with_value > 0 && s.awards_with_value < s.total_awards && (
                              <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                                from {s.awards_with_value} of {s.total_awards} awards
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4 text-sm">{s.buyers.toLocaleString()}</td>
                          <td className="px-5 py-4">
                            <div className="flex gap-1.5 flex-wrap">
                              {s.sources.map((src) => (
                                <span key={src} className="px-2 py-0.5 bg-secondary rounded text-xs text-muted-foreground">{src}</span>
                              ))}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${s.supplier_name}-expanded`} className="border-b border-border/50 bg-secondary/30">
                            <td colSpan={5} className="px-5 py-4">
                              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-sm font-semibold flex items-center gap-2">
                                    <Award className="h-4 w-4 text-primary" />
                                    {s.total_awards} Award{s.total_awards === 1 ? "" : "s"} Won
                                  </h4>
                                  <button
                                    onClick={() => setExpanded((e) => ({ ...e, [s.supplier_name]: false }))}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                  >
                                    Hide awards
                                  </button>
                                </div>
                                <div className="grid gap-2 max-h-96 overflow-y-auto pr-1">
                                  {s.awards.map((a) => (
                                    <div
                                      key={a.id}
                                      className="rounded-md border border-border/70 bg-background p-3 hover:border-primary/40 transition-colors"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                          {a.title ? (
                                            a.source_url ? (
                                              <a
                                                href={a.source_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="font-semibold text-sm text-foreground hover:text-primary hover:underline inline-flex items-start gap-1.5"
                                              >
                                                <span className="line-clamp-2">{a.title}</span>
                                                <ExternalLink className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />
                                              </a>
                                            ) : (
                                              <p className="font-semibold text-sm text-foreground line-clamp-2">{a.title}</p>
                                            )
                                          ) : null}
                                          <p className={`text-xs text-muted-foreground flex items-center gap-1.5 ${a.title ? "mt-1" : ""}`}>
                                            <Building2 className="h-3 w-3" />
                                            {a.buyer_name || "Unknown buyer"}
                                          </p>
                                        </div>
                                        {a.award_value && a.title ? (
                                          <span className="text-sm font-semibold text-primary whitespace-nowrap">
                                            {formatCurrency(a.award_value)}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                        {a.award_date && (
                                          <span className="inline-flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            {a.award_date.slice(0, 10)}
                                          </span>
                                        )}
                                        {a.award_value && (
                                          <span className={`inline-flex items-center gap-1 ${a.title ? "sm:hidden" : ""}`}>
                                            <Banknote className="h-3 w-3" />
                                            {formatCurrency(a.award_value)}
                                          </span>
                                        )}
                                        {a.source && (
                                          a.source_url ? (
                                            <a
                                              href={a.source_url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                                            >
                                              <Database className="h-3 w-3" />
                                              {a.source}
                                            </a>
                                          ) : (
                                            <span className="inline-flex items-center gap-1">
                                              <Database className="h-3 w-3" />
                                              {a.source}
                                            </span>
                                          )
                                        )}
                                      </div>

                                    </div>
                                  ))}
                                  {s.awards.length === 0 && (
                                    <p className="text-xs text-muted-foreground text-center py-4">
                                      No award details available.
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {filteredSuppliers.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground text-sm">
                      No suppliers match your search.
                    </td></tr>
                  )}

                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
                <p className="text-xs text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(1)}>First</Button>
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, idx, arr) => (
                      <Fragment key={p}>
                        {idx > 0 && p - arr[idx - 1] > 1 && (
                          <span className="px-1 text-xs text-muted-foreground">…</span>
                        )}
                        <Button
                          variant={p === currentPage ? "default" : "outline"}
                          size="sm"
                          className="min-w-[2.25rem]"
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </Button>
                      </Fragment>
                    ))}
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>Last</Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="sectors" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {sectors.length.toLocaleString()} sectors aggregated from award CPV codes
            </p>
            <div className="glass-card overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Sector / Market</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Awards</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Value</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Buyers</th>
                    <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((s) => (
                    <tr key={s.sector} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10"><Users className="h-4 w-4 text-primary" /></div>
                          <span className="font-medium text-sm">{s.sector}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-sm">
                          <Award className="h-3.5 w-3.5 text-primary" />{s.awards.toLocaleString()}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-primary">{formatCurrency(s.value)}</td>
                      <td className="px-5 py-4 text-sm">{s.buyers.size.toLocaleString()}</td>
                      <td className="px-5 py-4">
                        <div className="flex gap-1.5 flex-wrap">
                          {Array.from(s.sources).map((src) => (
                            <span key={src} className="px-2 py-0.5 bg-secondary rounded text-xs text-muted-foreground">{src}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
