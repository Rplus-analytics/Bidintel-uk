import { useMemo, useState } from "react";
import { AlarmClock, AlertTriangle, CalendarClock, ExternalLink, Loader2, Star } from "lucide-react";
import { useSavedBids } from "@/hooks/useSavedBids";
import { useExpiringTenders, type ExpiringTender } from "@/hooks/useExpiringTenders";
import { formatCurrency } from "@/data/mockData";
import { resolveSourceUrl } from "@/lib/sourceUrl";

type Bucket = "expired" | "0-30";

const bucketMeta: Record<Bucket, { label: string; badge: string }> = {
  expired: {
    label: "Recently expired (last 30 days)",
    badge: "bg-destructive/15 text-destructive border border-destructive/30",
  },
  "0-30": {
    label: "Expiring in the next 30 days",
    badge: "bg-primary/15 text-primary border border-primary/30",
  },
};

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

function bucketOf(days: number): Bucket | null {
  if (days < -30) return null;
  if (days < 0) return "expired";
  if (days <= 30) return "0-30";
  return null;
}

type Row = ExpiringTender & { _days: number; _saved: boolean };

export default function ContractsExpiring() {
  const { data: tenders = [], isLoading, isError } = useExpiringTenders();
  const { data: savedBids = [] } = useSavedBids();
  const [selectedBucket, setSelectedBucket] = useState<Bucket>("0-30");

  const savedKey = useMemo(() => {
    const s = new Set<string>();
    for (const b of savedBids) s.add(`${b.source}:${b.external_id}`);
    return s;
  }, [savedBids]);

  const { grouped, totals } = useMemo(() => {
    const grouped: Record<Bucket, Row[]> = { expired: [], "0-30": [] };
    for (const t of tenders) {
      const d = daysUntil(t.expiry_date);
      if (d === null) continue;
      const k = bucketOf(d);
      if (!k) continue;
      grouped[k].push({
        ...t,
        _days: d,
        _saved: savedKey.has(`${t.source}:${t.external_id}`),
      });
    }
    (Object.keys(grouped) as Bucket[]).forEach((k) =>
      grouped[k].sort((a, b) => a._days - b._days),
    );
    return {
      grouped,
      totals: { expired: grouped.expired.length, soon: grouped["0-30"].length },
    };
  }, [tenders, savedKey]);

  const empty = totals.expired + totals.soon === 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarClock className="h-6 w-6 text-primary" />
          Contracts nearing expiry
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Public-sector contracts across the market reaching their end date in the next 30 days — surfaces upcoming re-procurement opportunities. Bids you have saved are marked with a{" "}
          <Star className="inline h-3 w-3 -mt-0.5 fill-amber-400 text-amber-400" /> star.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <SummaryCard
          label="≤ 30 days"
          value={totals.soon}
          icon={AlarmClock}
          active={selectedBucket === "0-30"}
          onClick={() => setSelectedBucket("0-30")}
        />
        <SummaryCard
          label="Recently expired"
          value={totals.expired}
          icon={AlertTriangle}
          active={selectedBucket === "expired"}
          onClick={() => setSelectedBucket("expired")}
        />
      </div>

      {isLoading && (
        <div className="glass-card p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Loading contracts…</p>
        </div>
      )}
      {isError && (
        <div className="glass-card p-6 text-center border-destructive/30">
          <p className="text-destructive font-medium text-sm">Failed to load contracts</p>
        </div>
      )}

      {!isLoading && !isError && empty && (
        <div className="glass-card p-10 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No contracts found in this window</p>
        </div>
      )}

      {!isLoading && !isError && !empty && (
        <SelectedBucketTable
          meta={bucketMeta[selectedBucket]}
          rows={grouped[selectedBucket]}
        />
      )}
    </div>
  );
}

function SelectedBucketTable({
  meta,
  rows,
}: {
  meta: { label: string; badge: string };
  rows: Row[];
}) {
  if (rows.length === 0) {
    return (
      <section className="glass-card p-8">
        <h2 className="font-semibold">{meta.label}</h2>
        <p className="text-muted-foreground text-sm mt-3">No contracts in this range.</p>
      </section>
    );
  }
  const visible = rows.slice(0, 100);
  return (
    <section className="glass-card overflow-hidden">
      <div className="p-4 border-b border-border/60 flex items-center justify-between">
        <h2 className="font-semibold">{meta.label}</h2>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.badge}`}>
          {rows.length} contract{rows.length === 1 ? "" : "s"}
          {rows.length > visible.length ? ` · showing first ${visible.length}` : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Contract</th>
              <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Buyer</th>
              <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Value</th>
              <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Expiry</th>
              <th className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Countdown</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isExpired = r._days < 0;
              const label = isExpired
                ? `Expired ${Math.abs(r._days)}d ago`
                : r._days === 0
                  ? "Due today"
                  : `${r._days}d left`;
              const value = r.value_high || r.value_low;
              const url =
                resolveSourceUrl({
                  link: r.source_url,
                  source: r.source,
                  externalId: r.external_id,
                }) || r.source_url || "";
              const dateField = r.contract_end ? "End" : "Deadline";
              return (
                <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                  <td className="px-5 py-3 max-w-sm">
                    <p className="text-sm font-medium line-clamp-1 flex items-center gap-1.5">
                      {r._saved && (
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 flex-shrink-0" />
                      )}
                      {r.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wide">
                      {r.source}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-sm">{r.buyer_name || "—"}</td>
                  <td className="px-5 py-3 text-sm font-medium">{value ? formatCurrency(value) : "—"}</td>
                  <td className="px-5 py-3 text-sm">
                    <div>{new Date(r.expiry_date).toLocaleDateString("en-GB")}</div>
                    <div className="text-[10px] text-muted-foreground uppercase">{dateField}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>
                      {label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-card p-4 text-left cursor-pointer transition-all border ${
        active
          ? "border-primary/60 ring-2 ring-primary/30 bg-primary/5"
          : "border-border hover:border-primary/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
      <p className="text-3xl font-bold mt-2 text-foreground">{value.toLocaleString()}</p>
    </button>
  );
}
