import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    const callerId = userData.user.id;

    // Confirm caller is admin of an org
    const { data: callerMem } = await admin
      .from("memberships")
      .select("organisation_id, role")
      .eq("user_id", callerId)
      .maybeSingle();

    if (!callerMem || callerMem.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const display_name = String(body.display_name || "").trim() || null;
    const role = body.role === "admin" ? "admin" : "member";

    if (!email || password.length < 8) {
      return new Response(JSON.stringify({ error: "email and password (min 8) required" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Create or find user
    let userId: string | undefined;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name, role },
    });

    if (createErr) {
      // Fall back: find existing and update password
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
      if (!existing) {
        return new Response(JSON.stringify({ error: createErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
      userId = existing.id;
      await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { ...existing.user_metadata, display_name, role },
      });
    } else {
      userId = created.user?.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Failed to resolve user id" }), {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Upsert profile
    await admin.from("profiles").upsert(
      { id: userId, email, display_name },
      { onConflict: "id" }
    );

    // Upsert membership into caller's org
    await admin.from("memberships").upsert(
      { user_id: userId, organisation_id: callerMem.organisation_id, role },
      { onConflict: "user_id,organisation_id" }
    );

    return new Response(JSON.stringify({ ok: true, userId, email, role }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
