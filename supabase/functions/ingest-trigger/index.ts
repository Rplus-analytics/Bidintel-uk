import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const SOURCES: Record<string, string> = {
  fts: "ingest-fts",
  cf: "ingest-cf",
};

Deno.serve(async (req) => {
  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!jwt) return new Response("Unauthorized", { status: 401 });

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return new Response("Unauthorized", { status: 401 });

  if (user.user_metadata?.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const source = body.source ?? "both";

  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const secret = Deno.env.get("INGEST_SECRET")!;
  const headers = {
    "Content-Type": "application/json",
    "x-supabase-cron": "true",
    Authorization: `Bearer ${secret}`,
  };

  let toRun: string[];
  if (source === "all" || source === "both") {
    toRun = Object.keys(SOURCES);
  } else if (Array.isArray(source)) {
    toRun = source.filter((s: string) => s in SOURCES);
  } else if (typeof source === "string" && source in SOURCES) {
    toRun = [source];
  } else {
    return new Response(
      JSON.stringify({ error: `Unknown source: ${source}` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const entries = await Promise.all(
    toRun.map(async (key) => {
      const fn = SOURCES[key];
      try {
        const r = await fetch(`${baseUrl}/functions/v1/${fn}`, {
          method: "POST",
          headers,
          body: "{}",
        });
        const json = await r.json().catch(() => ({ error: "non-json response", status: r.status }));
        return [key, json] as const;
      } catch (e: any) {
        return [key, { error: e.message }] as const;
      }
    }),
  );

  const results: Record<string, any> = Object.fromEntries(entries);
  return Response.json(results);
});
