import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_saved_searches",
  title: "List saved searches",
  description:
    "List the saved searches (daily digest alerts) belonging to the signed-in user's organisation, including their filters and last alert time.",
  inputSchema: {
    active_only: z.boolean().optional().describe("Only return saved searches that are currently active."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ active_only }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();

    let query = supabaseForUser(ctx)
      .from("saved_searches")
      .select(
        "id, name, active, source, buyer, supplier, cpv, notice_type, min_value, max_value, published_from, published_to, filters, email_recipients, last_alerted_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (active_only) query = query.eq("active", true);

    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return jsonResult({ count: data?.length ?? 0, saved_searches: data ?? [] });
  },
});
