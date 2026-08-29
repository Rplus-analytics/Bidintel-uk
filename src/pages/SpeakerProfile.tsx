import { Link, useParams } from "react-router-dom";
import { getSpeakerProfile, type SpeakerAppearance } from "@/lib/speakers";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, ExternalLink, ArrowLeft, Building2, Briefcase } from "lucide-react";

export default function SpeakerProfile() {
  const { slug = "" } = useParams();
  const profile = getSpeakerProfile(slug);

  if (!profile) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Link to="/speakers" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> All speakers
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Speaker not found</h1>
        <p className="text-muted-foreground mt-2">We couldn't find a speaker matching this profile.</p>
      </div>
    );
  }

  const sorted = [...profile.appearances].sort((a, b) =>
    a.conference.isoDate.localeCompare(b.conference.isoDate)
  );
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sorted.filter((a) => a.conference.isoDate >= today);
  const past = sorted.filter((a) => a.conference.isoDate < today);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/conferences" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to conferences
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{profile.name}</h1>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {profile.roles.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-4 w-4" />
              {profile.roles.join(" · ")}
            </span>
          )}
          {profile.orgs.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {profile.orgs.join(" · ")}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-3">
          Speaking at <strong className="text-foreground">{profile.appearances.length}</strong>{" "}
          {profile.appearances.length === 1 ? "conference" : "conferences"} in our directory.
        </p>
      </header>

      {upcoming.length > 0 && (
        <Section title={`Upcoming sessions (${upcoming.length})`} items={upcoming} />
      )}
      {past.length > 0 && (
        <div className={upcoming.length > 0 ? "mt-8 opacity-70" : ""}>
          <Section title={`Past sessions (${past.length})`} items={past} />
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: SpeakerAppearance[] }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-3">{title}</h2>
      <div className="space-y-3">
        {items.map((a) => (
          <Card key={a.conference.name} className="p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground">{a.conference.name}</h3>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" /> {a.conference.date}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" /> {a.conference.location}
                  </span>
                </div>
                {(a.role || a.org) && (
                  <p className="text-sm text-foreground mt-2">
                    {a.role}
                    {a.role && a.org && <span className="text-muted-foreground">, </span>}
                    {a.org && <span className="text-muted-foreground">{a.org}</span>}
                  </p>
                )}
                {a.conference.topics && a.conference.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {a.conference.topics.map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <a
                href={a.conference.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline shrink-0"
              >
                Event site <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
