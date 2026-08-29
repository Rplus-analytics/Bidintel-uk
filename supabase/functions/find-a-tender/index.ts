// Find a Tender Service (FTS) - UK OCDS feed
// API: https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FTS_BASE = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { keyword, publishedFrom, publishedTo, limit } = await req.json();

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
      return new Response(JSON.stringify({ notices: [], total: 0, cursor: null, uri: url, error: text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();

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

    return new Response(
      JSON.stringify({ notices, total: notices.length, cursor: null, uri: url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("FTS exception:", msg);
    return new Response(JSON.stringify({ notices: [], total: 0, cursor: null, uri: "", error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
