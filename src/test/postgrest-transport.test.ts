// The riskiest piece of glue in the AWS migration, and the only one the
// backend smoke tests could not reach.
//
// supabase-js hard-codes a `/rest/v1` prefix onto its base URL. Standalone
// PostgREST serves tables at the root, and an ALB cannot rewrite paths, so
// makePostgrestFetch() strips the prefix. If that rewrite is wrong, EVERY
// `.from()` call in the app 404s — and it would do so only at runtime, against
// a deployed load balancer, with no type error and no build failure.
//
// So this asserts the URL that the real query builder actually emits, rather
// than the URL we assume it emits.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { makePostgrestFetch } from "@/integrations/aws/postgrest";

vi.mock("@/integrations/aws/cognito", () => ({
  getIdToken: async () => "test-id-token",
}));

const BASE = "http://postgrest.example.com";

function clientCapturing(calls: { url: string; headers: Headers }[]) {
  const inner = makePostgrestFetch();
  const spyFetch: typeof fetch = async (input, init) => {
    // Capture what makePostgrestFetch produced, then short-circuit.
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  vi.stubGlobal("fetch", spyFetch);
  return createClient(BASE, "no-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: inner },
  });
}

describe("PostgREST transport", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("strips the /rest/v1 prefix supabase-js adds", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const db = clientCapturing(calls);

    await db.from("tenders").select("id, title").limit(3);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain("/rest/v1");
    expect(calls[0].url).toBe(`${BASE}/tenders?select=id%2Ctitle&limit=3`);
  });

  it("preserves filters, ordering and embedded selects", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const db = clientCapturing(calls);

    await db
      .from("saved_searches")
      .select("id, name")
      .eq("user_id", "abc")
      .order("created_at", { ascending: false });

    expect(calls[0].url).toBe(
      `${BASE}/saved_searches?select=id%2Cname&user_id=eq.abc&order=created_at.desc`,
    );
  });

  it("attaches the Cognito ID token and removes the Supabase apikey header", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const db = clientCapturing(calls);

    await db.from("tenders").select("id");

    expect(calls[0].headers.get("Authorization")).toBe("Bearer test-id-token");
    // PostgREST does not know what an apikey is, and supabase-js sets one.
    expect(calls[0].headers.get("apikey")).toBeNull();
  });
});
