import { resolveSourceUrlWithDebug } from "./sourceUrl";

export interface DebugData {
  ocid?: string;
  releaseId?: string;
  parsedGuid?: string | null;
  linkSource?: string;
  documentUrls?: string[];
}

export function extractDocumentUrls(raw: Record<string, unknown> | null): string[] | undefined {
  if (!raw) return undefined;
  const docs = raw.documents as unknown[] | undefined;
  if (Array.isArray(docs)) {
    const urls = docs
      .map((d) => (d as { url?: string })?.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    if (urls.length) return urls;
  }
  return undefined;
}

export function extractReleaseId(raw: Record<string, unknown> | null): string | undefined {
  if (!raw) return undefined;
  const releases = raw.releases as unknown[] | undefined;
  if (Array.isArray(releases) && releases.length > 0) {
    const first = releases[0] as { id?: string };
    if (first?.id) return first.id;
  }
  const release = raw.release as { id?: string } | undefined;
  if (release?.id) return release.id;
  return undefined;
}

export function buildNoticeDebug(input: {
  link?: string | null;
  source?: string | null;
  externalId?: string | null;
  ocid?: string | null;
  raw?: Record<string, unknown> | null;
}): DebugData {
  const { url, strategy, parsedGuid } = resolveSourceUrlWithDebug({
    link: input.link,
    source: input.source,
    externalId: input.externalId,
    ocid: input.ocid,
    releaseId: extractReleaseId(input.raw),
  });
  void url; // callers use the returned debug data alongside the resolved URL
  return {
    linkSource: strategy,
    parsedGuid,
    ocid: input.ocid || undefined,
    releaseId: extractReleaseId(input.raw),
    documentUrls: extractDocumentUrls(input.raw),
  };
}
