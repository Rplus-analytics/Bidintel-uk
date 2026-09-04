// Find a Tender Service (FTS) - UK OCDS feed
// API: https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages
//
// Ported from supabase/functions/find-a-tender (Deno). Query building, keyword
// filtering and release mapping are unchanged; only the runtime shell differs
// (Deno.serve -> API Gateway v2 Lambda handler, Response -> result object).

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const FTS_BASE = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";

// Mirrors Deno's `await req.json()`: an absent or malformed body throws.
function readJsonBody(event: APIGatewayProxyEventV2): any {
  const raw = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body ?? "";
  return JSON.parse(raw);
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "ok" };
  }

  try {
    const { keyword, publishedFrom, publishedTo, limit } = readJsonBody(event);

    const params = new URLSearchParams();
    const from = publishedFrom ? new Date(publishedFrom) : new Date(Date.now() - 30 * 86400_000);
    const to = publishedTo ? new Date(publishedTo) : new Date();
    // FTS requires YYYY-MM-DDTHH:MM:SS (no milliseconds, no Z)
    const fmt = (d: Date) => d.toISOString().slice(0, 19);
    params.set("updatedFrom", fmt(from));
    params.set("updatedTo", fmt(to));
    params.set("limit", String(Math.min(limit || 50, 100)));

    const url = `${FTS_BASE}?${params.toString()}`;
    console.log("FTS URL:", url);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text();
      console.error("FTS error:", res.status, text);
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({ notices: [], total: 0, cursor: null, uri: url, error: text }),
      };
    }
    const data: any = await res.json();

    // FTS returns releases at the top level (not nested under packages)
    const releases: any[] = data.releases || (data.packages || []).flatMap((p: any) => p.releases || []);
    const kw = (keyword || "").toLowerCase();
    const filtered = kw
      ? releases.filter((r) => {
          const t = (r.tender?.title || "").toLowerCase();
          const d = (r.tender?.description || "").toLowerCase();
          const b = (r.buyer?.name || "").toLowerCase();
          return t.includes(kw) || d.includes(kw) || b.includes(kw);
        })
      : releases;

    const notices = filtered.map((r: any) => {
      const tender = r.tender || {};
      const buyer = r.buyer || {};
      const value = tender.value || {};
      const tag = r.tag?.[0] || "";
      const ocid = r.ocid || "";
      const noticeId = r.id || "";
      const docs = tender.documents || [];
      const noticeDoc = docs.find((d: any) => typeof d?.url === "string" && d.url.includes("find-tender.service.gov.uk/Notice/"));
      const link = noticeDoc?.url
        || (noticeId ? `https://www.find-tender.service.gov.uk/Notice/${encodeURIComponent(noticeId)}` : `https://www.find-tender.service.gov.uk/Search/Results?Keywords=${encodeURIComponent(ocid)}`);

      return {
        id: noticeId || ocid,
        title: tender.title || "Untitled",
        buyer: buyer.name || "Unknown",
        description: tender.description || "",
        value: value.amount || 0,
        valueHigh: value.amount || 0,
        currency: value.currency || "GBP",
        status: tag === "award" ? "Awarded" : tag === "tender" ? "Open" : tender.status || "Unknown",
        publishedDate: r.date || r.publishedDate || "",
        deadlineDate: tender.tenderPeriod?.endDate || "",
        region: tender.deliveryAddresses?.[0]?.region || "",
        sector: tender.items?.[0]?.classification?.description || "",
        cpvCode: tender.items?.[0]?.classification?.id || "",
        source: "Find a Tender (FTS)",
        noticeType: tag,
        link,
      };
    });

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ notices, total: notices.length, cursor: null, uri: url }),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("FTS exception:", msg);
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ notices: [], total: 0, cursor: null, uri: "", error: msg }),
    };
  }
};
