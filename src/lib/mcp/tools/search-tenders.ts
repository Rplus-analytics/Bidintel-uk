import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "search_tenders",
  title: "Search tenders",
  description:
    "Search UK public sector tender notices by keyword, buyer, source and publication window. Returns the most recently published matches.",
  inputSchema: {
    keyword: z.string().optional().describe("Free text matched against tender title and description."),
    buyer: z.string().optional().describe("Buyer / contracting authority name (partial match)."),
    source: z
      .string()
      .optional()
      .describe("Source code, e.g. cf, fts, contracts_scotland, ccs_digital_outcomes."),
    published_from: z.string().optional().describe("ISO date. Only tenders published on or after this date."),
    open_only: z.boolean().optional().describe("Only tenders whose submission deadline is still in the future."),
    limit: z.number().optional().describe("Maximum results to return (default 20, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ keyword, buyer, source, published_from, open_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const take = Math.min(Math.max(limit ?? 20, 1), 100);

    let query = supabaseForUser(ctx)
      .from("tenders")
      .select(
        "id, external_id, title, description, buyer_name, source, source_url, published_at, deadline_at, value_min, value_max, currency, region, primary_cpv",
      )
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(take);

    if (keyword) query = query.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
    if (buyer) query = query.ilike("buyer_name", `%${buyer}%`);
    if (source) query = query.eq("source", source);
    if (published_from) query = query.gte("published_at", published_from);
    if (open_only) query = query.gte("deadline_at", new Date().toISOString());

    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return jsonResult({ count: data?.length ?? 0, tenders: data ?? [] });
  },
});
