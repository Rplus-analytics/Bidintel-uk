import { CONFERENCES, type Conference, type Speaker } from "@/data/conferences";

export function slugifySpeaker(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface SpeakerAppearance {
  conference: Conference;
  role?: string;
  org?: string;
}

export interface SpeakerProfile {
  slug: string;
  name: string;
  roles: string[];
  orgs: string[];
  appearances: SpeakerAppearance[];
}

export function getAllSpeakerProfiles(): SpeakerProfile[] {
  const map = new Map<string, SpeakerProfile>();
  for (const conf of CONFERENCES) {
    for (const sp of conf.speakers || []) {
      const slug = slugifySpeaker(sp.name);
      if (!slug) continue;
      let entry = map.get(slug);
      if (!entry) {
        entry = { slug, name: sp.name, roles: [], orgs: [], appearances: [] };
        map.set(slug, entry);
      }
      entry.appearances.push({ conference: conf, role: sp.role, org: sp.org });
      if (sp.role && !entry.roles.includes(sp.role)) entry.roles.push(sp.role);
      if (sp.org && !entry.orgs.includes(sp.org)) entry.orgs.push(sp.org);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getSpeakerProfile(slug: string): SpeakerProfile | undefined {
  return getAllSpeakerProfiles().find((s) => s.slug === slug);
}

export function getSpeakerSlugByName(name: string): string {
  return slugifySpeaker(name);
}
