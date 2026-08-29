import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertLinkedFromRelease, enrichTedTender } from "../_shared/ocds-linked.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // TEMP: auth disabled for one-off backfill run
  // const auth = req.headers.get("Authorization")?.replace("Bearer ", "");

  const body = await req.json().catch(() => ({}));
  const offset: number = Number(body.offset ?? 0);
  const limit: number = Math.min(Number(body.limit ?? 50), 200);

  const { data: tenders, error } = await supabase
    .from("tenders")
    .select("id, source, external_id, raw_json")
    .not("raw_json", "is", null)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let processed = 0;
  const linkErrors: any[] = [];

  for (const t of tenders ?? []) {
    const release = (t as any).raw_json;
    const src = (t as any).source;
    if (!release || typeof release !== "object") continue;
    try {
      const { errors: errs } = src === "ted"
        ? await enrichTedTender(supabase, (t as any).id, release)
        : await upsertLinkedFromRelease(supabase, src, release, (t as any).id, "GB");
      if (errs?.length) linkErrors.push({ ext: (t as any).external_id, errs });
      processed++;
    } catch (e: any) {
      linkErrors.push({ ext: (t as any).external_id, fatal: e.message });
    }
  }

  console.log(`[backfill-linked-tables] offset=${offset} processed=${processed} errors=${linkErrors.length}`);

  // Tally linked counts (current totals, useful for monitoring progress)
  const counts: Record<string, number> = {};
  for (const tbl of ["buyers", "tender_lots", "tender_cpv", "tender_documents", "awards", "suppliers", "award_suppliers"]) {
    const { count } = await supabase.from(tbl).select("*", { count: "exact", head: true });
    counts[tbl] = count ?? 0;
  }

  const nextOffset = (tenders?.length ?? 0) === limit ? offset + limit : null;

  return new Response(
    JSON.stringify({
      offset,
      limit,
      processed,
      next_offset: nextOffset,
      counts,
      link_error_sample: linkErrors.slice(0, 5),
      link_error_count: linkErrors.length,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
