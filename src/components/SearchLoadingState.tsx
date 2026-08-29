import { useEffect, useState } from "react";
import { Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const STAGES = [
  { icon: "🔍", label: "Understanding your search..." },
  { icon: "🧠", label: "Expanding procurement terms..." },
  { icon: "📋", label: "Matching CPV categories..." },
  { icon: "📑", label: "Searching tenders..." },
  { icon: "✅", label: "Ranking opportunities..." },
];

const SOURCES = [
  "Contracts Finder",
  "Find a Tender",
  "TED (EU)",
  "Contracts Scotland",
];

interface Props {
  query: string;
  expansion?: { terms: string[]; cpvs: string[] } | null;
}

export function SearchLoadingState({ query, expansion }: Props) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setStage(0);
    const id = window.setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
    }, 1100);
    return () => window.clearInterval(id);
  }, [query]);

  const current = STAGES[stage];

  return (
    <div className="space-y-4">
      {/* Prominent active banner */}
      <div className="glass-card p-5 border-primary/30 bg-primary/5">
        <div className="flex items-center gap-3 mb-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Searching procurement opportunities…</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              BidIntel AI is analysing your query for relevant tenders
            </p>
          </div>
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
        </div>

        {/* Cycling stage indicator */}
        <div
          key={stage}
          className="flex items-center gap-2 text-sm text-foreground/90 animate-fade-in"
        >
          <span className="text-base leading-none">{current.icon}</span>
          <span>{current.label}</span>
        </div>

        {/* Stage progress dots */}
        <div className="flex items-center gap-1.5 mt-3">
          {STAGES.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= stage ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Expansion chips (as they arrive) */}
      {expansion && (expansion.terms.length > 0 || expansion.cpvs.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap text-xs animate-fade-in">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" /> AI matched:
          </span>
          {expansion.terms.slice(0, 6).map((t) => (
            <Badge key={`et-${t}`} variant="secondary" className="font-normal">
              ✓ {t}
            </Badge>
          ))}
          {expansion.cpvs.slice(0, 6).map((c) => (
            <Badge key={`ec-${c}`} variant="outline" className="font-normal">
              ✓ CPV {c}
            </Badge>
          ))}
        </div>
      )}

      {/* Source coverage */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground">Searching:</span>
        {SOURCES.map((s) => (
          <Badge key={s} variant="outline" className="font-normal gap-1">
            <CheckCircle2 className="h-3 w-3 text-success" /> {s}
          </Badge>
        ))}
      </div>

      {/* Skeleton cards matching tender card structure */}
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={`sk-${i}`}
            className="glass-card p-4 sm:p-5 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex-1 min-w-0 space-y-2">
                {/* status badge + meta */}
                <div className="flex items-center gap-2">
                  <div className="h-5 w-14 rounded-full bg-primary/20" />
                  <div className="h-3 w-20 rounded bg-muted/50" />
                  <div className="h-3 w-24 rounded bg-muted/40 hidden sm:block" />
                </div>
                {/* title */}
                <div className="h-5 w-3/4 rounded bg-muted/60" />
                {/* buyer */}
                <div className="h-4 w-1/3 rounded bg-muted/50" />
                {/* description */}
                <div className="space-y-1.5 pt-1">
                  <div className="h-3 w-full rounded bg-muted/30" />
                  <div className="h-3 w-5/6 rounded bg-muted/30" />
                </div>
                {/* meta row */}
                <div className="flex gap-3 pt-1">
                  <div className="h-3 w-20 rounded bg-muted/30" />
                  <div className="h-3 w-24 rounded bg-muted/30" />
                </div>
              </div>
              {/* right column: value + deadline + cta */}
              <div className="flex sm:flex-col items-end gap-2 shrink-0">
                <div className="h-6 w-24 rounded bg-primary/20" />
                <div className="h-3 w-28 rounded bg-muted/40" />
                <div className="h-8 w-28 rounded-md bg-muted/40" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
