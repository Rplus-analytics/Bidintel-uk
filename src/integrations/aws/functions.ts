// ============================================================================
// supabase.functions.invoke() -> API Gateway
// ============================================================================
//
// Same signature and same `{ data, error }` return shape, so the nine call
// sites keep their existing error handling. Route path == function name:
//
//   invoke("semantic-search", { body }) -> POST ${VITE_API_BASE_URL}/semantic-search
//
// Every route on the API requires a Cognito ID token, so the token is attached
// here rather than at each call site.

import { getIdToken } from "./cognito";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/**
 * Functions the frontend calls that have NO deployment on AWS.
 *
 * Four of them (ted-eu, sell2wales, etenders-ireland, etenders-ni) never
 * existed on Supabase either — searchAllSources has always fired them into a
 * Promise.allSettled that swallows the failure. The rest are ported-but-not-yet-
 * deployed or, in admin-create-user's case, replaced by Cognito.
 *
 * Listed explicitly so a missing function returns a clear error immediately
 * instead of a 404 the caller reports as "search failed".
 */
const NOT_DEPLOYED: Record<string, string> = {
  "ted-eu": "never implemented (no edge function existed on Supabase either)",
  sell2wales: "never implemented (no edge function existed on Supabase either)",
  "etenders-ireland": "never implemented (no edge function existed on Supabase either)",
  "etenders-ni": "never implemented (no edge function existed on Supabase either)",
  "draft-bid-response": "not yet ported to AWS",
  "daily-search-alerts": "not yet ported to AWS",
  "admin-create-user": "replaced by Cognito; create users in the Cognito console for now",
  "embed-tenders-batch": "deployed as a worker, not exposed through the API",
  "sync-notices": "deployed as a worker, not exposed through the API",
};

export interface InvokeResult<T> {
  data: T | null;
  error: Error | null;
}

export async function invoke<T = any>(
  fn: string,
  opts?: { body?: unknown },
): Promise<InvokeResult<T>> {
  if (fn in NOT_DEPLOYED) {
    return { data: null, error: new Error(`${fn}: ${NOT_DEPLOYED[fn]}`) };
  }
  if (!API_BASE_URL) {
    return { data: null, error: new Error("VITE_API_BASE_URL is not set") };
  }

  const token = await getIdToken();
  if (!token) {
    return { data: null, error: new Error("Not signed in") };
  }

  try {
    const res = await fetch(`${API_BASE_URL}/${fn}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(opts?.body ?? {}),
    });

    // supabase-js surfaces a non-2xx as `error`, not as data. Same here, and the
    // body is included because several of these functions return 200 with an
    // `error` field and 4xx with a message the UI shows verbatim.
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const detail = parsed?.error || parsed?.message || text.slice(0, 200) || res.statusText;
      return { data: null, error: new Error(`${fn} (${res.status}): ${detail}`) };
    }

    return { data: parsed as T, error: null };
  } catch (e: any) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
