import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "search_awards",
  title: "Search contract awards",
  description:
    "Search awarded contracts by supplier and/or buyer name. Names are matched against the normalised canonical name so variants resolve to one entity.",
  inputSchema: {
    supplier: z.string().optional().describe("Supplier / winning organisation name (partial match)."),
    buyer: z.string().optional().describe("Buyer / contracting authority name (partial match)."),
    awarded_from: z.string().optional().describe("ISO date. Only awards made on or after this date."),
    limit: z.number().optional().describe("Maximum results to return (default 25, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ supplier, buyer, awarded_from, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const take = Math.min(Math.max(limit ?? 25, 1), 100);
    const canonical = (v: string) => v.trim().toLowerCase().replace(/&/g, "and");

    let query = supabaseForUser(ctx)
      .from("awards")
      .select(
        "id, supplier_name, buyer_name, award_value, currency, awarded_at, contract_start, contract_end, source, external_id, cpv_code",
      )
      .order("awarded_at", { ascending: false, nullsFirst: false })
      .limit(take);

    if (supplier) query = query.ilike("supplier_name_canonical", `%${canonical(supplier)}%`);
    if (buyer) query = query.ilike("buyer_name_canonical", `%${canonical(buyer)}%`);
    if (awarded_from) query = query.gte("awarded_at", awarded_from);

    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return jsonResult({ count: data?.length ?? 0, awards: data ?? [] });
  },
});
