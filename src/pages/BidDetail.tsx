import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2, Building2, Calendar, CalendarClock, PoundSterling, MapPin, Tag, FileText, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useLiveNotices } from "@/hooks/useLiveNotices";
import { formatCurrency } from "@/data/mockData";
import { supabase } from "@/integrations/supabase/client";
import { resolveSourceUrl } from "@/lib/sourceUrl";
import { buildNoticeDebug } from "@/lib/tenderDebug";
import type { ContractsFinderNotice } from "@/lib/contractsFinder";



function formatDate(d?: string) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function sourceLabel(source?: string) {
  const s = (source || "").toLowerCase();
  if (s === "cf" || s.includes("contracts finder")) return "Contracts Finder";
  if (s === "fts" || s.includes("find a tender")) return "Find a Tender Service";
  if (s.includes("scotland")) return "Public Contracts Scotland";
  if (s === "ted") return "TED (EU)";
  return source || "Unknown source";
}

export default function BidDetail() {
  const { id } = useParams<{ id: string }>();
  const decodedId = decodeURIComponent(id || "");
  const { data, isLoading, isError, error } = useLiveNotices({ daysBack: 30, limit: 100 });

  const inMemoryNotice = useMemo(
    () => data?.notices.find((n) => n.id === decodedId),
    [data, decodedId]
  );

  const [fallbackNotice, setFallbackNotice] = useState<ContractsFinderNotice | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (inMemoryNotice) return;
    if (!decodedId) return;

    let cancelled = false;
    setFallbackLoading(true);
    setFallbackError(null);

    (async () => {
      try {
        const { data: tRow } = await supabase
          .from("tenders")
          .select(
            "source,external_id,ocid,title,buyer_name,description,value_min,value_max,currency,status,published_at,deadline_at,region,sector,primary_cpv,notice_type,source_url,raw_json,contract_start,contract_end"
          )
          .eq("external_id", decodedId)
          .maybeSingle();

        if (tRow && !cancelled) {
          const link = resolveSourceUrl({
            link: tRow.source_url,
            source: tRow.source,
            externalId: tRow.external_id,
            ocid: tRow.ocid,
          });
          setFallbackNotice({
            id: tRow.external_id,
            title: tRow.title,
            buyer: tRow.buyer_name || "",
            description: tRow.description || "",
            value: tRow.value_min || 0,
            valueHigh: tRow.value_max || 0,
            currency: tRow.currency || "GBP",
            status: tRow.status || "",
            publishedDate: tRow.published_at || "",
            deadlineDate: tRow.deadline_at || "",
            region: tRow.region || "",
            sector: tRow.sector || "",
            cpvCode: tRow.primary_cpv || "",
            source: tRow.source,
            noticeType: tRow.notice_type || "",
            link,
            contractStart: tRow.contract_start || undefined,
            contractEnd: tRow.contract_end || undefined,
            debug: buildNoticeDebug({
              link: tRow.source_url,
              source: tRow.source,
              externalId: tRow.external_id,
              ocid: tRow.ocid,
              raw: tRow.raw_json as Record<string, unknown> | null,
            }),
          });
          return;
        }



        const { data: nRow } = await supabase
          .from("notices")
          .select(
            "source,external_id,title,buyer,description,value,value_high,currency,status,published_date,deadline_date,region,sector,cpv_code,notice_type,link,source_url,raw"
          )
          .eq("external_id", decodedId)
          .maybeSingle();

        if (nRow && !cancelled) {
          const link = resolveSourceUrl({
            link: nRow.link,
            source: nRow.source,
            externalId: nRow.external_id,
          });
          setFallbackNotice({
            id: nRow.external_id,
            title: nRow.title,
            buyer: nRow.buyer || "",
            description: nRow.description || "",
            value: nRow.value || 0,
            valueHigh: nRow.value_high || 0,
            currency: nRow.currency || "GBP",
            status: nRow.status || "",
            publishedDate: nRow.published_date || "",
            deadlineDate: nRow.deadline_date || "",
            region: nRow.region || "",
            sector: nRow.sector || "",
            cpvCode: nRow.cpv_code || "",
            source: nRow.source,
            noticeType: nRow.notice_type || "",
            link,
            debug: buildNoticeDebug({
              link: nRow.link,
              source: nRow.source,
              externalId: nRow.external_id,
              raw: nRow.raw as Record<string, unknown> | null,
            }),
          });
        }


      } catch (e) {
        if (!cancelled) setFallbackError((e as Error)?.message || "Lookup failed");
      } finally {
        if (!cancelled) setFallbackLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [decodedId, isLoading, inMemoryNotice]);

  const notice = inMemoryNotice || fallbackNotice;

  if (isLoading || (!inMemoryNotice && fallbackLoading)) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tender…
      </div>
    );
  }

  if (isError) {
    return <div className="p-8 text-destructive">Failed to load: {(error as Error)?.message}</div>;
  }

  if (!notice) {
    return (
      <div className="p-8 space-y-3 max-w-4xl mx-auto">
        <Link to="/contracts" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Matching Tenders
        </Link>
        <p className="text-muted-foreground">Tender not found.</p>
        {fallbackError && <p className="text-xs text-destructive">Lookup error: {fallbackError}</p>}
      </div>
    );
  }

  const valueDisplay =
    notice.value > 0 && notice.valueHigh > notice.value
      ? `${formatCurrency(notice.value)} – ${formatCurrency(notice.valueHigh)}`
      : notice.value > 0
      ? formatCurrency(notice.value)
      : "";

  const keyInfo: Array<{ label: string; value: string; icon: React.ElementType }> = [
    { label: "Reference Number", value: notice.id, icon: FileText },
    { label: "Buyer", value: notice.buyer, icon: Building2 },
    { label: "Tender Status", value: notice.status ? notice.status.charAt(0).toUpperCase() + notice.status.slice(1) : "", icon: Tag },
    { label: "Notice Type", value: notice.noticeType, icon: Layers },
    { label: "Published Date", value: formatDate(notice.publishedDate), icon: Calendar },
    { label: "Closing Date", value: formatDate(notice.deadlineDate), icon: CalendarClock },
    { label: "Estimated Value", value: valueDisplay, icon: PoundSterling },
    { label: "Region", value: notice.region, icon: MapPin },
    { label: "CPV Code", value: notice.cpvCode, icon: Tag },
    { label: "Procurement Source", value: sourceLabel(notice.source), icon: FileText },
  ].filter((r) => r.value && r.value.trim() !== "");

  const docs = notice.debug?.documentUrls || [];

  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl mx-auto space-y-8">
      {/* Back nav */}
      <Link to="/contracts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Matching Tenders
      </Link>

      {/* Section 1 — Header */}
      <header className="space-y-4 pb-6 border-b">
        <div className="flex items-center gap-2 flex-wrap">
          {notice.status && <Badge variant="secondary" className="capitalize">{notice.status}</Badge>}
          {notice.isFramework && <Badge variant="outline">Framework</Badge>}
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">{notice.title}</h1>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {notice.buyer && (
            <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4" />{notice.buyer}</span>
          )}
          {valueDisplay && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
              <PoundSterling className="h-4 w-4" />{valueDisplay}
            </span>
          )}
          {notice.deadlineDate && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4" />Closes {formatDate(notice.deadlineDate)}
            </span>
          )}
        </div>
      </header>

      {/* Section 2 — Primary actions */}
      {notice.link && (
        <div>
          <Button asChild size="lg">
            <a href={notice.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
              View Original Notice <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      )}

      {/* Section 3 — Key Information */}
      {keyInfo.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Key Information</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 rounded-lg border bg-card p-6">
            {keyInfo.map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-start gap-3">
                <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium mt-0.5 break-words">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Section 4 — Tender Summary */}
      {notice.description && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Tender Summary</h2>
          <p className="text-base leading-relaxed text-muted-foreground whitespace-pre-line">
            {notice.description}
          </p>
        </section>
      )}

      {/* Section 5 — Documents */}
      {docs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Documents</h2>
          <ul className="rounded-lg border bg-card divide-y">
            {docs.map((u, i) => (
              <li key={i} className="p-4">
                <a
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline break-all"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Section 6 — Source */}
      <Separator />
      <footer className="space-y-2 pb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Source</h2>
        <p className="text-sm">{sourceLabel(notice.source)}</p>
        {notice.link && (
          <a
            href={notice.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            View Original Notice <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </footer>

      {/* Section 7 — Source Link Debug (development only) */}
      {import.meta.env.DEV && notice.debug && (
        <section className="space-y-4 rounded-lg border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Source Link Debug</h2>

          <DebugRow label="Final resolved URL">
            <a href={notice.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
              {notice.link || "—"}
            </a>
          </DebugRow>

          <DebugRow label="Link source strategy">
            <code className="text-xs px-2 py-0.5 rounded bg-muted">{notice.debug.linkSource ?? "n/a"}</code>
          </DebugRow>

          <DebugRow label="Parsed Notice GUID">
            <code className="text-xs break-all">{notice.debug.parsedGuid ?? "—"}</code>
          </DebugRow>

          <DebugRow label="Raw ocid">
            <code className="text-xs break-all">{notice.debug.ocid ?? "—"}</code>
          </DebugRow>

          <DebugRow label="Raw release.id">
            <code className="text-xs break-all">{notice.debug.releaseId ?? "—"}</code>
          </DebugRow>

          {notice.debug.documentUrls && notice.debug.documentUrls.length > 0 && (
            <DebugRow label="All document URLs">
              <ul className="space-y-1">
                {notice.debug.documentUrls.map((u, i) => (
                  <li key={i}>
                    <a href={u} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline break-all">
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            </DebugRow>
          )}
        </section>
      )}
    </div>
  );
}

function DebugRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

