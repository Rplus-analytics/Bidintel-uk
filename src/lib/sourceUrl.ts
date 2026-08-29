// Helpers to resolve a working "View on Source" URL for a notice/tender row.
// Different ingestion pipelines may store the source URL inconsistently,
// so we derive a canonical URL from whatever identifier is available.

const CF_BASE = "https://www.contractsfinder.service.gov.uk/Notice/";
const CCS_BASE = "https://redirect.contractawardservice.crowncommercial.gov.uk";
const CF_SEARCH_BASE = "https://www.contractsfinder.service.gov.uk/Search/Results?Keywords=";
const FTS_SEARCH_BASE = "https://www.find-tender.service.gov.uk/Search/Results?Keywords=";

function isCfSource(source?: string | null): boolean {
  const s = (source || "").toLowerCase();
  return s === "cf" || s.includes("contracts finder") || s.includes("contracts-finder");
}

function isCcsSource(source?: string | null): boolean {
  const s = (source || "").toLowerCase();
  return s === "ccs_digital_outcomes" || s.includes("ccs") || s.includes("digital outcomes");
}

function isFtsSource(source?: string | null): boolean {
  const s = (source || "").toLowerCase();
  return s === "fts" || s.includes("find a tender") || s.includes("find-tender");
}

/**
 * Build a Contracts Finder notice URL from a release/external id like
 * `02ec0a29-85af-485d-b3e8-697a96751300-896277`. The trailing numeric
 * suffix is stripped because the public Notice page only uses the GUID.
 */
export function cfNoticeUrlFromReleaseId(releaseId?: string | null): string | null {
  if (!releaseId) return null;
  const guid = releaseId.replace(/-\d+$/, "");
  if (!/^[0-9a-f-]{20,}$/i.test(guid)) return null;
  return `${CF_BASE}${guid}`;
}

export interface ResolveSourceUrlInput {
  link?: string | null;
  source?: string | null;
  externalId?: string | null;
  ocid?: string | null;
  releaseId?: string | null;
}

export interface ResolveSourceUrlDebug {
  url: string;
  strategy: string;
  parsedGuid: string | null;
}

function strategyFromInput(input: ResolveSourceUrlInput): string {
  const link = (input.link || "").trim();
  if (link) return "stored-link";

  if (isCfSource(input.source)) {
    const fromRelease = cfNoticeUrlFromReleaseId(input.releaseId || input.externalId);
    if (fromRelease) return "release.id";
    if (input.ocid) return "search-fallback";
  }

  if (isFtsSource(input.source) && input.ocid) return "search-fallback";

  return "none";
}

/** Resolve the best external "View on Source" URL for a notice row plus debug metadata. */
export function resolveSourceUrlWithDebug(input: ResolveSourceUrlInput): ResolveSourceUrlDebug {
  const url = resolveSourceUrl(input);
  const strategy = strategyFromInput(input);
  const parsedGuid =
    isCfSource(input.source) && (input.releaseId || input.externalId)
      ? cfNoticeUrlFromReleaseId(input.releaseId || input.externalId)
      : null;
  return { url, strategy, parsedGuid };
}

/** Resolve the best external "View on Source" URL for a notice row. */
export function resolveSourceUrl(input: ResolveSourceUrlInput): string {
  const link = (input.link || "").trim();
  if (link) {
    if (link.startsWith("/") && isCcsSource(input.source)) {
      return `${CCS_BASE}${link}`;
    }
    return link;
  }


  if (isCfSource(input.source)) {
    const fromRelease = cfNoticeUrlFromReleaseId(input.releaseId || input.externalId);
    if (fromRelease) return fromRelease;
    if (input.ocid) {
      // Last-resort: build a search URL keyed off the OCID, since the OCID's
      // GUID does NOT correspond to the Notice page GUID.
      return `${CF_SEARCH_BASE}${encodeURIComponent(input.ocid)}`;
    }
  }

  if (isFtsSource(input.source) && input.ocid) {
    return `${FTS_SEARCH_BASE}${encodeURIComponent(input.ocid)}`;
  }

  return "";
}

