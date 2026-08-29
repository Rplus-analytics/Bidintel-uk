import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_saved_bids",
  title: "List saved bids",
  description:
    "List the bids in the signed-in user's organisation pipeline, optionally filtered by pipeline status.",
  inputSchema: {
    status: z.string().optional().describe("Pipeline status filter, e.g. interested, bidding, submitted, won, lost."),
    limit: z.number().optional().describe("Maximum results to return (default 50, max 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const take = Math.min(Math.max(limit ?? 50, 1), 200);

    let query = supabaseForUser(ctx)
      .from("saved_bids")
      .select(
        "id, title, buyer, source, source_url, status, value, deadline_date, published_date, notes, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(take);

    if (status) query = query.eq("status", status as never);

    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return jsonResult({ count: data?.length ?? 0, bids: data ?? [] });
  },
});
