const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CF_BASE = "https://www.contractsfinder.service.gov.uk";
const SEARCH_URL = `${CF_BASE}/api/rest/2/search_notices/json`;

// Map our app's stages -> CF V2 notice types + statuses.
// V2 types: Pipeline | Future Opportunity | Opportunity | Contract | Early Engagement
// V2 statuses: Open | Closed | Awarded | Cancelled
function buildTypesAndStatuses(stages?: string | string[]) {
  const list = (Array.isArray(stages) ? stages : (stages ? String(stages).split(",") : []))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const types = new Set<string>();
  const statuses = new Set<string>();

  if (list.length === 0 || list.includes("tender")) {
    types.add("Opportunity");
    statuses.add("Open");
  }
  if (list.includes("award") || list.length === 0) {
    types.add("Contract");
    statuses.add("Awarded");
  }
  if (list.includes("planning") || list.includes("pipeline")) {
    types.add("Pipeline");
    types.add("Future Opportunity");
    types.add("Early Engagement");
  }

  return {
    types: Array.from(types),
    statuses: Array.from(statuses),
  };
}

function mapStatus(t?: string, s?: string): string {
  const type = (t || "").toLowerCase();
  const status = (s || "").toLowerCase();
  if (status === "awarded" || type === "contract") return "Awarded";
  if (status === "open" || type === "opportunity") return "Open";
  if (type === "pipeline" || type === "future opportunity") return "Pipeline";
  if (type === "early engagement") return "Early Engagement";
  return s || t || "Unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { keyword, stages, publishedFrom, publishedTo, limit } = await req.json();

    const { types, statuses } = buildTypesAndStatuses(stages);

    // Default to last 30 days if no date range specified
    const pubFrom = publishedFrom ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const pubTo = publishedTo || new Date().toISOString();

    const body = {
      searchCriteria: {
        types,
        statuses,
        keyword: keyword || null,
        publishedFrom: pubFrom,
        publishedTo: pubTo,
      },
      size: Math.min(Number(limit) || 100, 1000),
    };

    console.log("CF V2 search request:", JSON.stringify(body));

    async function fetchWithTimeout(timeoutMs: number): Promise<Response> {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(SEARCH_URL, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }
    }

    let response: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await fetchWithTimeout(20000);
        if (response.ok) break;
        if (response.status < 500 || attempt === 2) break;
        console.warn(`CF V2 attempt ${attempt} returned ${response.status}, retrying...`);
      } catch (e) {
        lastErr = e;
        console.warn(`CF V2 attempt ${attempt} failed:`, e instanceof Error ? e.message : e);
        if (attempt === 2) break;
      }
    }

    if (!response) {
      const msg = lastErr instanceof Error ? lastErr.message : "Upstream request failed";
      return new Response(
        JSON.stringify({ notices: [], total: 0, cursor: null, uri: SEARCH_URL, error: `Upstream unreachable: ${msg}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("CF V2 API error:", response.status, errorText.slice(0, 500));
      return new Response(
        JSON.stringify({ notices: [], total: 0, cursor: null, uri: SEARCH_URL, error: `Upstream ${response.status}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const hits: any[] = data?.noticeList || [];

    const notices = hits.map((h: any) => {
      const r = h?.item || {};
      const id = r.id || r.noticeIdentifier || "";
      const value = typeof r.awardedValue === "number" && r.awardedValue > 0
        ? r.awardedValue
        : (r.valueLow ?? 0);
      return {
        id,
        title: r.title || "Untitled",
        buyer: r.organisationName || "Unknown",
        description: r.description || "",
        value,
        valueHigh: r.valueHigh ?? value,
        currency: "GBP",
        status: mapStatus(r.noticeType, r.noticeStatus),
        publishedDate: r.publishedDate || "",
        deadlineDate: r.deadlineDate || "",
        region: r.regionText || r.region || "",
        sector: r.cpvDescription || r.sector || "",
        cpvCode: (r.cpvCodes || "").split(",")[0]?.trim() || "",
        source: "Contracts Finder (V2)",
        noticeType: r.noticeType || "",
        link: id ? `${CF_BASE}/Notice/${id}` : `${CF_BASE}/Search`,
        debug: {
          releaseId: id,
          noticeIdentifier: r.noticeIdentifier,
          isSuitableForSme: r.isSuitableForSme,
          isSuitableForVco: r.isSuitableForVco,
          awardedToSme: r.awardedToSme,
          awardedToVcse: r.awardedToVcse,
          awardedSupplier: r.awardedSupplier,
        },
      };
    });

    return new Response(
      JSON.stringify({
        notices,
        total: data?.hitCount ?? notices.length,
        cursor: null,
        uri: SEARCH_URL,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
