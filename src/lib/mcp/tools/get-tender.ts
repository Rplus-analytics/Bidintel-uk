import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_tender",
  title: "Get tender",
  description: "Fetch the full detail of a single tender notice by its id or external id.",
  inputSchema: {
    id: z.string().optional().describe("Internal tender UUID."),
    external_id: z.string().optional().describe("Source external id / OCID of the tender."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, external_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    if (!id && !external_id) return errorResult("Provide either id or external_id.");

    let query = supabaseForUser(ctx)
      .from("tenders")
      .select(
        "id, external_id, ocid, title, description, buyer_name, buyer_type, source, source_url, status, derived_status, notice_type, procedure_type, published_at, deadline_at, contract_start, contract_end, award_date, value_min, value_max, currency, region, country, sector, primary_cpv, cpv_codes",
      )
      .limit(1);

    query = id ? query.eq("id", id) : query.eq("external_id", external_id!);

    const { data, error } = await query.maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return errorResult("Tender not found.");
    return jsonResult(data);
  },
});
