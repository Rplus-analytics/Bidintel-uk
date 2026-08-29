// One-time bootstrap: lets a signed-in user with no organisation create one
// and become its first admin. After bootstrap, further users are added by admins.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userRes } = await userClient.auth.getUser();
    const caller = userRes.user;
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const { data: existing } = await admin
      .from("memberships")
      .select("organisation_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (existing) return json({ error: "User already belongs to an organisation" }, 400);

    const body = await req.json().catch(() => ({}));
    const name = (body?.name || "").toString().trim();
    if (!name) return json({ error: "name required" }, 400);

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) +
      "-" + Math.random().toString(36).slice(2, 7);

    const { data: org, error: orgErr } = await admin
      .from("organisations")
      .insert({ name, slug })
      .select()
      .single();
    if (orgErr || !org) return json({ error: orgErr?.message || "Failed to create org" }, 400);

    const { error: memErr } = await admin.from("memberships").insert({
      user_id: caller.id,
      organisation_id: org.id,
      role: "admin",
    });
    if (memErr) return json({ error: memErr.message }, 400);

    return json({ organisation: org });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
