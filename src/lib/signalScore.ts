import type { ContractsFinderNotice } from "./contractsFinder";

export interface MatchProfile {
  keywords: string[];
  sectors: string[];
  regions: string[];
  cpv_prefixes: string[];
  min_value: number | null;
  max_value: number | null;
}

export interface SignalResult {
  score: 0 | 1 | 2 | 3;
  reasons: string[];
}

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Compute a 0–3 signal score based on how well the notice matches
 * the org's profile. Simple keyword overlap + bonus dimensions.
 *
 *  +1  any keyword match in title/description/buyer/sector
 *  +1  sector OR CPV prefix match
 *  +1  region match OR value falls inside [min,max]
 * Capped at 3. If profile is empty → score 0.
 */
export function scoreNotice(
  notice: ContractsFinderNotice,
  profile: MatchProfile | null
): SignalResult {
  if (!profile) return { score: 0, reasons: [] };

  const reasons: string[] = [];
  let score = 0;

  const haystack = [
    notice.title,
    notice.description,
    notice.buyer,
    notice.sector,
  ]
    .filter(Boolean)
    .map(norm)
    .join(" \n ");

  const kws = (profile.keywords || []).map(norm).filter(Boolean);
  const matchedKw = kws.filter((k) => haystack.includes(k));
  if (matchedKw.length > 0) {
    score += 1;
    reasons.push(`Keyword: ${matchedKw.slice(0, 3).join(", ")}`);
  }

  const sectorN = norm(notice.sector || "");
  const cpv = (notice.cpvCode || "").toString();
  const sectorHit = (profile.sectors || []).some(
    (s) => s && sectorN.includes(norm(s))
  );
  const cpvHit = (profile.cpv_prefixes || []).some(
    (p) => p && cpv.startsWith(p.trim())
  );
  if (sectorHit || cpvHit) {
    score += 1;
    reasons.push(sectorHit ? "Sector match" : `CPV ${cpv}`);
  }

  const regionN = norm(notice.region || "");
  const regionHit =
    regionN &&
    (profile.regions || []).some((r) => r && regionN.includes(norm(r)));
  const v = notice.value || 0;
  const min = profile.min_value;
  const max = profile.max_value;
  const valueHit =
    v > 0 &&
    (min == null || v >= min) &&
    (max == null || v <= max) &&
    (min != null || max != null);
  if (regionHit || valueHit) {
    score += 1;
    reasons.push(regionHit ? "Region match" : "Value in range");
  }

  return { score: Math.min(score, 3) as 0 | 1 | 2 | 3, reasons };
}
