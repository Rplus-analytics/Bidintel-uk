import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CONFERENCES, type Conference } from "@/data/conferences";
import { slugifySpeaker } from "@/lib/speakers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar, MapPin, ExternalLink, Users, Mic } from "lucide-react";

export default function Conferences() {
  const [query, setQuery] = useState("");
  const [buyerType, setBuyerType] = useState<string>("all");
  const [selected, setSelected] = useState<Conference | null>(null);

  const buyerTypes = useMemo(() => {
    const set = new Set(CONFERENCES.map((c) => c.buyerType).filter(Boolean) as string[]);
    return ["all", ...Array.from(set).sort()];
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    return CONFERENCES
      .filter((c) => buyerType === "all" || c.buyerType === buyerType)
      .filter((c) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.location.toLowerCase().includes(q) ||
          (c.topics || []).some((t) => t.toLowerCase().includes(q)) ||
          (c.speakers || []).some((s) =>
            s.name.toLowerCase().includes(q) ||
            (s.role || "").toLowerCase().includes(q) ||
            (s.org || "").toLowerCase().includes(q)
          )
        );
      })
      .sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  }, [query, buyerType]);

  const upcoming = filtered.filter((c) => c.isoDate >= today);
  const past = filtered.filter((c) => c.isoDate < today);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">UK Public Sector Conferences</h1>
        <p className="text-muted-foreground mt-2">
          Curated directory of UK public sector events and conferences where suppliers can meet buyers in person.
        </p>
      </header>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Input
          placeholder="Search by name, location, topic or speaker..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
        <Select value={buyerType} onValueChange={setBuyerType}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Buyer type" />
          </SelectTrigger>
          <SelectContent>
            {buyerTypes.map((bt) => (
              <SelectItem key={bt} value={bt}>
                {bt === "all" ? "All buyer types" : bt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Section title={`Upcoming (${upcoming.length})`} items={upcoming} onSelect={setSelected} />
      {past.length > 0 && (
        <div className="mt-10 opacity-70">
          <Section title={`Past (${past.length})`} items={past} onSelect={setSelected} />
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{selected.name}</DialogTitle>
                <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" /> {selected.date}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" /> {selected.location}
                  </span>
                  {selected.buyerType && (
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-4 w-4" /> {selected.buyerType}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              {selected.description && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-1.5">About the event</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{selected.description}</p>
                </div>
              )}

              {selected.topics && selected.topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selected.topics.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              {selected.speakers && selected.speakers.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <Mic className="h-4 w-4" /> Featured speakers
                  </h4>
                  <ul className="space-y-2">
                    {selected.speakers.map((s) => (
                      <li key={s.name} className="text-sm">
                        <Link
                          to={`/speakers/${slugifySpeaker(s.name)}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                          onClick={() => setSelected(null)}
                        >
                          {s.name}
                        </Link>
                        {s.role && <span className="text-muted-foreground"> — {s.role}</span>}
                        {s.org && <span className="text-muted-foreground">, {s.org}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Speaker line-ups are indicative, based on past programmes and announced billings. Confirm on the official event site.
                  </p>
                </div>
              )}

              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Visit official event site <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: Conference[];
  onSelect: (c: Conference) => void;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No events match.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card
              key={c.name}
              onClick={() => onSelect(c)}
              className="p-5 flex flex-col gap-3 hover:border-primary/50 transition-colors cursor-pointer"
            >
              <div>
                <h3 className="font-semibold text-foreground leading-tight hover:text-primary transition-colors">
                  {c.name}
                </h3>
                {c.buyerType && (
                  <Badge variant="secondary" className="mt-2 text-xs">
                    <Users className="h-3 w-3 mr-1" />
                    {c.buyerType}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 shrink-0" />
                  <span>{c.date}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{c.location}</span>
                </div>
              </div>
              {c.topics && c.topics.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {c.topics.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-auto flex items-center justify-between">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(c);
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  View details
                </button>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
                >
                  Site <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
