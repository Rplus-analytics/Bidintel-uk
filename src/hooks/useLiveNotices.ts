import { useStoredNotices } from "@/hooks/useStoredNotices";
import type { ContractsFinderNotice } from "@/lib/contractsFinder";

export interface UseLiveNoticesOptions {
  keyword?: string;
  daysBack?: number;
  limit?: number;
  enabled?: boolean;
}

/**
 * Reads notices from the local `notices` table (populated by the sync-notices edge function).
 * Keyword filtering is applied client-side over the fetched window.
 */
export function useLiveNotices(opts: UseLiveNoticesOptions = {}) {
  const { keyword, daysBack = 180, limit = 1000, enabled = true } = opts;
  const query = useStoredNotices({ daysBack, limit, enabled });

  if (!keyword) return query;

  const kw = keyword.toLowerCase();
  const filtered = query.data
    ? {
        ...query.data,
        notices: query.data.notices.filter(
          (n) =>
            n.title.toLowerCase().includes(kw) ||
            (n.description || "").toLowerCase().includes(kw) ||
            (n.buyer || "").toLowerCase().includes(kw),
        ),
      }
    : query.data;

  return { ...query, data: filtered } as typeof query;
}

export type { ContractsFinderNotice };
