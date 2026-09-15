// ============================================================================
// PostgREST transport for supabase-js
// ============================================================================
//
// supabase-js is kept as the query builder — it IS postgrest-js underneath, so
// every `.from(...).select(...).eq(...)` in the app already speaks PostgREST's
// wire protocol. Only two things differ from Supabase-hosted PostgREST:
//
//   1. supabase-js hard-codes a `/rest/v1` prefix onto the base URL. Standalone
//      PostgREST serves tables at the root. An ALB cannot rewrite paths, so the
//      prefix is stripped here in a custom fetch instead.
//
//   2. Auth is a Cognito ID token, not a Supabase anon key + JWT. The token is
//      attached per request (rather than once at client construction) because
//      it expires every 60 minutes and must be refreshed transparently.
//
// Doing both in `global.fetch` is what lets every existing `.from()` call stay
// byte-identical.

import { getIdToken } from "./cognito";

export function makePostgrestFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const original =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // /rest/v1/tenders?select=* -> /tenders?select=*
    const url = original.replace(/\/rest\/v1(\/|$)/, "/");

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    const token = await getIdToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      // No token: let the request go out unauthenticated. PostgREST falls back
      // to its db-anon-role, which is `anon` — revoked from every user table, so
      // this returns empty sets rather than data. Deliberately not an exception:
      // the app renders empty state while the session is being restored.
      headers.delete("Authorization");
    }

    // Supabase's own apikey header means nothing to standalone PostgREST and
    // would be an unrecognised header on the ALB.
    headers.delete("apikey");

    return fetch(url, { ...init, headers });
  };
}
