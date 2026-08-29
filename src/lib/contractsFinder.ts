import { supabase } from "@/integrations/supabase/client";

export interface ContractsFinderNotice {
  id: string;
  title: string;
  buyer: string;
  description: string;
  value: number;
  valueHigh: number;
  currency: string;
  status: string;
  publishedDate: string;
  deadlineDate: string;
  region: string;
  sector: string;
  cpvCode: string;
  source: string;
  noticeType: string;
  link: string;
  noticeTag?: string[];
  isFramework?: boolean;
  contractStart?: string;
  contractEnd?: string;
  debug?: {
    ocid?: string;
    releaseId?: string;
    parsedGuid?: string | null;
    linkSource?: "documents" | "release.id" | "fallback-doc" | "search-fallback" | string;
    documentUrls?: string[];
  };
}

export interface ContractsFinderResponse {
  notices: ContractsFinderNotice[];
  total: number;
  cursor: string | null;
  uri: string;
}

export interface SearchParams {
  keyword?: string;
  stages?: string[];
  publishedFrom?: string;
  publishedTo?: string;
  limit?: number;
  cursor?: string;
}

async function invokeSource(fn: string, body: Record<string, unknown>): Promise<ContractsFinderResponse> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    console.warn(`[${fn}] failed`, error);
    return { notices: [], total: 0, cursor: null, uri: "" };
  }
  return (data as ContractsFinderResponse) || { notices: [], total: 0, cursor: null, uri: "" };
}

export async function searchContractsFinder(params: SearchParams): Promise<ContractsFinderResponse> {
  return invokeSource("contracts-finder", params as Record<string, unknown>);
}

export interface ScotlandSearchParams {
  keyword?: string;
  dateFrom?: string;
  noticeType?: number;
  limit?: number;
}

export async function searchContractsScotland(params: ScotlandSearchParams): Promise<ContractsFinderResponse> {
  return invokeSource("contracts-scotland", params as Record<string, unknown>);
}

export async function searchAllSources(params: SearchParams): Promise<ContractsFinderResponse> {
  let dateFrom: string | undefined;
  if (params.publishedFrom) {
    const d = new Date(params.publishedFrom);
    dateFrom = `${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  }

  const results = await Promise.allSettled([
    invokeSource("contracts-finder", params as Record<string, unknown>),
    invokeSource("contracts-scotland", { keyword: params.keyword, dateFrom, noticeType: 2, limit: params.limit }),
    invokeSource("find-a-tender", params as Record<string, unknown>),
    invokeSource("ted-eu", params as Record<string, unknown>),
    invokeSource("sell2wales", params as Record<string, unknown>),
    invokeSource("etenders-ireland", params as Record<string, unknown>),
    invokeSource("etenders-ni", params as Record<string, unknown>),
  ]);

  const all: ContractsFinderNotice[] = [];
  let total = 0;
  const uris: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      all.push(...(r.value.notices || []));
      total += r.value.total || 0;
      if (r.value.uri) uris.push(r.value.uri);
    }
  }

  const merged = all.sort((a, b) => {
    const da = new Date(a.publishedDate).getTime() || 0;
    const db = new Date(b.publishedDate).getTime() || 0;
    return db - da;
  });

  return { notices: merged, total, cursor: null, uri: uris.join(" | ") };
}
