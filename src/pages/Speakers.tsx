import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAllSpeakerProfiles } from "@/lib/speakers";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mic } from "lucide-react";

export default function Speakers() {
  const [query, setQuery] = useState("");
  const profiles = useMemo(() => getAllSpeakerProfiles(), []);

  const filtered = useMemo(() => {
    if (!query.trim()) return profiles;
    const q = query.toLowerCase();
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.roles.some((r) => r.toLowerCase().includes(q)) ||
        p.orgs.some((o) => o.toLowerCase().includes(q))
    );
  }, [profiles, query]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Speakers</h1>
        <p className="text-muted-foreground mt-2">
          {profiles.length} speakers across UK public sector conferences. Click any speaker to see all their sessions and roles.
        </p>
      </header>

      <Input
        placeholder="Search by name, role or organisation..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-md mb-6"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <Link key={p.slug} to={`/speakers/${p.slug}`}>
            <Card className="p-4 hover:border-primary/50 transition-colors h-full">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-primary/10 p-2 shrink-0">
                  <Mic className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-foreground leading-tight truncate">{p.name}</h3>
                  {p.roles[0] && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.roles[0]}</p>
                  )}
                  {p.orgs[0] && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{p.orgs[0]}</p>
                  )}
                  <Badge variant="secondary" className="mt-2 text-[10px]">
                    {p.appearances.length} {p.appearances.length === 1 ? "session" : "sessions"}
                  </Badge>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-muted-foreground text-sm">No speakers match.</p>
      )}
    </div>
  );
}
