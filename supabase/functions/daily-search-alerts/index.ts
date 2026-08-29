import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_ADDRESS = Deno.env.get("ALERTS_FROM_ADDRESS") || "BidIntel Alerts <onboarding@resend.dev>";

interface SavedSearch {
  id: string;
  name: string;
  filters: { keyword?: string; buyers?: string[] } | null;
  email_recipients: string[];
  active: boolean;
  created_at: string;
  last_alerted_at: string | null;
  source?: string | null;
  buyer?: string | null;
  supplier?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  published_from?: string | null;
  published_to?: string | null;
  cpv?: string | null;
  notice_type?: string | null;
}

// Map UI source values to tenders.source codes
const SOURCE_MAP: Record<string, string[]> = {
  "contracts-finder": ["cf"],
  "find-a-tender": ["fts"],
  scotland: ["pcs", "contracts_scotland"],
  "ccs-digital-outcomes": ["ccs_digital_outcomes"],
  ted: ["ted"],
  sell2wales: ["s2w"],
  "etenders-ie": ["etenders-ie"],
  "etenders-ni": ["etenders-ni"],
};

// Display labels for the source filter values stored on saved_searches.source.
// Used to render "Sources Monitored" in the monitoring summary email.
// Only the currently supported UK MVP procurement sources are listed here.
// Retired sources (TED EU, Sell2Wales, eTenders IE/NI, etc.) are intentionally
// excluded — this map is the single source of truth for the email template.
const SOURCE_DISPLAY: Record<string, string> = {
  "contracts-finder": "Contracts Finder",
  "find-a-tender": "Find a Tender Service (FTS)",
  scotland: "Public Contracts Scotland (PCS)",
  "ccs-digital-outcomes": "CCS Digital Outcomes",
};

function sourcesMonitored(s: SavedSearch): string[] {
  // Reuse the saved search's own source configuration. If the user picked a
  // specific source we show only that one, otherwise we show every currently
  // supported UK MVP source.
  if (s.source && s.source !== "all" && SOURCE_DISPLAY[s.source]) {
    return [SOURCE_DISPLAY[s.source]];
  }
  return Object.values(SOURCE_DISPLAY);
}

// BidIntel Procurement Monitor schedule — single source of truth for both the
// scheduling logic and the "Next Scheduled Check" value shown in the digest
// email. The business schedule is exactly one value: 08:00 Europe/London.
// Always presented as UK local time regardless of server or recipient timezone.
// UK daylight saving (GMT ↔ BST) is respected automatically via the
// Europe/London zone. Change the hour here to move the digest.
const MONITOR_SCHEDULE = { hour: 8, minute: 0, tz: "Europe/London" } as const;

// Engineering-only retry policy — NOT part of the business schedule. The digest
// targets 08:00 Europe/London. If that run fails, the (hourly) scheduler is
// allowed to retry on the following UK hours up to this many hours later, i.e.
// 09:00, 10:00, 11:00 for a value of 3. A send still happens at most once per UK
// calendar day (see the last_alerted_at idempotency guard in runAlerts).
const MAX_RETRY_HOURS = 3;

/*
 * SCHEDULING CONTRACT — READ BEFORE CHANGING.
 *
 * Do NOT replace this logic with a rolling 24-hour interval.
 *
 * A previous implementation measured 24 hours from the previous successful
 * execution (last_alerted_at) and skipped while `now - last_alerted_at < 24h`.
 *
 * Because the scheduler (pg_cron) runs hourly and last_alerted_at was stamped a
 * few seconds past the hour, each day the same-hour tick fell ~1 minute short of
 * 24h and slipped to the next hourly tick. This caused the delivery time to
 * drift approximately one hour later each day (observed: 08:00 → 09:00 → 10:00…).
 *
 * Scheduling MUST always be based on the Europe/London calendar day (an absolute
 * wall-clock date) rather than elapsed time from the previous execution. The
 * calendar-day key decouples today's send from yesterday's send timestamp, so
 * the delivery time can never creep forward.
 */

// Wall-clock parts for an instant, evaluated in the Europe/London zone. This is
// the single conversion point that makes the schedule DST-aware: Intl resolves
// GMT/BST for us, so `hour` and the date key below always reflect UK local time
// regardless of the (UTC) clock pg_cron actually wakes us on.
function londonParts(d: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MONITOR_SCHEDULE.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

// Europe/London calendar day (YYYY-MM-DD) for an instant. This is the
// idempotency key: at most one digest per UK calendar day, decoupled from any
// elapsed-time measurement.
function londonDateKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function nextScheduledCheckLabel(): string {
  const hh = String(MONITOR_SCHEDULE.hour).padStart(2, "0");
  const mm = String(MONITOR_SCHEDULE.minute).padStart(2, "0");
  // Detect current UK timezone abbreviation (GMT in winter, BST in summer)
  // so the label reflects DST without ever converting to the recipient's zone.
  let tzAbbr = "UK Time";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: MONITOR_SCHEDULE.tz,
      hour: "2-digit",
      timeZoneName: "short",
    }).formatToParts(new Date());
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    if (name === "GMT" || name === "BST") tzAbbr = `UK Time (${name})`;
  } catch {
    /* fall back to plain "UK Time" */
  }
  return `${hh}:${mm} ${tzAbbr}`;
}

interface Tender {
  id: string;
  title: string | null;
  buyer_name: string | null;
  value_max: number | null;
  deadline_at: string | null;
  source_url: string | null;
  published_at: string | null;
  source: string | null;
  external_id: string | null;
}

const APP_BASE_URL = "https://bidintel.rplusai.co.uk";

function cleanSourceUrl(t: { source: string | null; source_url: string | null; external_id: string | null }): string {
  // Contracts Finder Notice URLs only resolve when the trailing "-NNNNNN" suffix
  // on the release id is stripped. Fix any stored URLs that include it.
  if (t.source === "cf") {
    if (t.external_id) {
      const guid = String(t.external_id).replace(/-\d+$/, "");
      return `https://www.contractsfinder.service.gov.uk/Notice/${guid}`;
    }
    if (t.source_url) {
      return t.source_url.replace(/(\/Notice\/[0-9a-f-]{20,}?)-\d+(?=$|[/?#])/i, "$1");
    }
  }
  return t.source_url || "#";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fmtMoney(v: number | null): string {
  if (v == null) return "—";
  return "£" + Math.round(v).toLocaleString("en-GB");
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

type DigestMode = "first" | "incremental";

function buildMonitoringFooterHtml(s: SavedSearch): string {
  const sources = sourcesMonitored(s);
  const sourcesList = sources.map((src) => `<li style="margin:4px 0;">${escapeHtml(src)}</li>`).join("");
  const nextCheck = nextScheduledCheckLabel();

  return `
    <div style="padding:20px 24px;border-top:1px solid #e5e7eb;background:#f8fafc;">
      <h2 style="margin:0 0 10px;font-size:16px;color:#0f172a;">Tender Monitoring</h2>
      <div style="font-size:14px;color:#0f172a;margin-bottom:10px;">🟢 Monitoring Active</div>
      <div style="font-size:14px;color:#334155;margin-bottom:14px;">Tender monitoring runs daily at ${escapeHtml(nextCheck)}.</div>
      <div style="font-size:14px;color:#0f172a;margin-bottom:6px;font-weight:600;">Sources monitored</div>
      <ul style="margin:0 0 14px;padding-left:18px;font-size:14px;color:#334155;">${sourcesList}</ul>
      <div style="font-size:13px;color:#64748b;line-height:1.5;">We'll continue monitoring the market and automatically notify you whenever new matching tenders are published.</div>
    </div>`;
}

function buildResultsHtml(s: SavedSearch, header: string, intro: string, rows: Tender[]): string {
  const searchId = s.id;
  const searchName = s.name;
  const displayRows = rows.slice(0, 10);
  const totalMatching = rows.length;
  const displayedCount = displayRows.length;
  const remainingCount = totalMatching - displayedCount;
  const moreHref = `${APP_BASE_URL}/contracts?savedSearch=${encodeURIComponent(searchId)}`;
  const moreText =
    remainingCount > 0
      ? `<div style="padding:16px 18px;text-align:center;font-size:14px;border-top:1px solid #e5e7eb;background:#f8fafc;color:#334155;">
         <div style="margin-bottom:6px;">Showing the first ${displayedCount} of ${totalMatching} matching tenders.</div>
         <a href="${moreHref}" style="color:#2563eb;text-decoration:underline;font-weight:500;">View the remaining ${remainingCount} matching tender${remainingCount === 1 ? "" : "s"} →</a>
       </div>`
      : "";
  const footer = buildMonitoringFooterHtml(s);

  const items = displayRows
    .map((t) => {
      const srcUrl = cleanSourceUrl(t);
      // Reuse the existing Tender Details page. The BidDetail route resolves
      // tenders via in-memory cache then Supabase fallback by id/external_id.
      const detailId = t.external_id || t.id;
      const appUrl = `${APP_BASE_URL}/open-bids/${encodeURIComponent(detailId)}`;
      return `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:14px 10px;font-size:14px;color:#0f172a;">
        <a href="${escapeHtml(appUrl)}" style="color:#2563eb;text-decoration:none;font-weight:600;">${escapeHtml(t.title || "(no title)")}</a>
      </td>
      <td style="padding:14px 10px;font-size:13px;color:#0f172a;">${escapeHtml(t.buyer_name || "—")}</td>
      <td style="padding:14px 10px;font-size:13px;color:#0f172a;white-space:nowrap;">${fmtDate(t.deadline_at)}</td>
      <td style="padding:14px 10px;font-size:13px;color:#0f172a;white-space:nowrap;">${fmtMoney(t.value_max)}</td>
      <td style="padding:14px 10px;font-size:13px;white-space:nowrap;">
        <a href="${escapeHtml(appUrl)}" style="color:#2563eb;text-decoration:none;font-weight:600;">View Tender →</a>
        <a href="${escapeHtml(srcUrl)}" style="color:#64748b;text-decoration:none;margin-left:8px;font-size:11px;">Source ↗</a>
      </td>
    </tr>
  `;
    })
    .join("");

  return `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:720px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.7;">BidIntel Procurement Monitor</div>
        <h1 style="margin:6px 0 0;font-size:22px;">${escapeHtml(searchName)}</h1>
        <div style="font-size:13px;opacity:.85;margin-top:6px;">${escapeHtml(header)}</div>
        <div style="font-size:14px;opacity:.9;margin-top:12px;line-height:1.5;">${escapeHtml(intro)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f1f5f9;">
          <th align="left" style="padding:10px;font-size:11px;text-transform:uppercase;color:#64748b;">Tender</th>
          <th align="left" style="padding:10px;font-size:11px;text-transform:uppercase;color:#64748b;">Buyer</th>
          <th align="left" style="padding:10px;font-size:11px;text-transform:uppercase;color:#64748b;">Closing Date</th>
          <th align="left" style="padding:10px;font-size:11px;text-transform:uppercase;color:#64748b;">Estimated Value</th>
          <th align="left" style="padding:10px;font-size:11px;text-transform:uppercase;color:#64748b;">Actions</th>
        </tr></thead>
        <tbody>${items}</tbody>
      </table>
      ${moreText}
      ${footer}
      <div style="padding:18px;text-align:center;border-top:1px solid #e5e7eb;background:#f8fafc;">
        <a href="${APP_BASE_URL}/contracts?savedSearch=${encodeURIComponent(searchId)}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;margin:0 6px 6px 0;">
          View Matching Tenders
        </a>
        <a href="${APP_BASE_URL}/saved-searches"
           style="display:inline-block;background:#fff;color:#2563eb;border:1px solid #2563eb;text-decoration:none;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;margin:0 6px 6px 0;">
          Manage Saved Search
        </a>
      </div>
    </div>
    <div style="text-align:center;color:#94a3b8;font-size:12px;padding:16px;">Sent by BidIntel · Saved Search Alerts</div>
  </div>
</body></html>`;
}

function buildMonitoringSummaryHtml(s: SavedSearch, activeMatchingCount: number): string {
  const sources = sourcesMonitored(s);
  const sourcesList = sources.map((src) => `<li style="margin:2px 0;">${escapeHtml(src)}</li>`).join("");
  const nextCheck = nextScheduledCheckLabel();

  return `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:720px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="padding:20px 24px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.7;">BidIntel Procurement Monitor</div>
        <h1 style="margin:6px 0 0;font-size:22px;">🟢 Your Procurement Monitor is Active</h1>
        <div style="font-size:13px;opacity:.85;margin-top:8px;line-height:1.5;">
          We checked your saved search across the supported UK public procurement sources.
          No new opportunities matched your criteria since your previous digest.
          Your Procurement Monitor continues to monitor the market on your behalf. As soon as a new matching opportunity is published, you'll be notified automatically.
        </div>
      </div>
      <div style="padding:20px 24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#0f172a;">
          <tr><td style="padding:8px 0;color:#64748b;width:220px;">Saved Search</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(s.name)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Monitoring Status</td><td style="padding:8px 0;">🟢 Monitoring Active</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Today's Result</td><td style="padding:8px 0;">No new opportunities</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">Current Matching Tenders</td>
              <td style="padding:8px 0;">You currently have <strong>${activeMatchingCount}</strong> active tender${activeMatchingCount === 1 ? "" : "s"} matching your saved search. Review them anytime by selecting "View Matching Tenders" below.</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">Monitoring Continues</td>
              <td style="padding:8px 0;">Your Procurement Monitor continues to watch for newly published opportunities that match your criteria.</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">Sources Monitored</td>
              <td style="padding:8px 0;"><ul style="margin:0;padding-left:18px;">${sourcesList}</ul></td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Tender monitoring runs daily at 08:00 UK Time (GMT/BST)</td><td style="padding:8px 0;">${escapeHtml(nextCheck)}</td></tr>
        </table>
      </div>
      ${buildMonitoringFooterHtml(s)}
      <div style="padding:18px;text-align:center;border-top:1px solid #e5e7eb;background:#f8fafc;">
        <a href="${APP_BASE_URL}/contracts?savedSearch=${encodeURIComponent(s.id)}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;margin:0 6px 6px 0;">
          View Matching Tenders
        </a>
        <a href="${APP_BASE_URL}/saved-searches"
           style="display:inline-block;background:#fff;color:#2563eb;border:1px solid #2563eb;text-decoration:none;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;margin:0 6px 6px 0;">
          Manage Saved Search
        </a>
      </div>
    </div>
    <div style="text-align:center;color:#94a3b8;font-size:12px;padding:16px;">Sent by BidIntel · Saved Search Alerts</div>
  </div>
</body></html>`;
}

const TENDER_COLS =
  "id,title,buyer_name,value_max,deadline_at,source_url,published_at,description,source,primary_cpv,notice_type,external_id";

/**
 * Call the shared Hybrid Semantic Search edge function so the digest uses the
 * exact same pipeline as the Contracts Search page. Returns tender IDs in
 * ranked order. Falls back to [] on failure (caller can use keyword-less path).
 */
async function fetchSemanticHitIds(keyword: string, cpvPrefix: string | null, activeOnly: boolean): Promise<string[]> {
  const base = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${base}/functions/v1/semantic-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({
      query: keyword,
      cpvPrefix: cpvPrefix || null,
      daysBack: 365,
      matchCount: 300,
      activeOnly,
    }),
  });
  if (!res.ok) {
    console.warn(`semantic-search call failed ${res.status}`);
    return [];
  }
  const json = await res.json().catch(() => ({}));
  const results = (json?.results || []) as { id: string }[];
  return results.map((r) => r.id).filter(Boolean);
}

/**
 * Apply the same post-filters the Contracts page applies after the RPC:
 * source / buyer / supplier / min-max value.
 */
function applyPostFilters(rows: (Tender & { description?: string | null })[], s: SavedSearch): Tender[] {
  let out = rows;
  if (s.source && s.source !== "all") {
    const codes = SOURCE_MAP[s.source];
    if (codes?.length) out = out.filter((r) => r.source && codes.includes(r.source));
  }
  if (s.buyer) {
    const needle = s.buyer.toLowerCase();
    out = out.filter((r) => (r.buyer_name || "").toLowerCase().includes(needle));
  }
  if (s.supplier) {
    const needle = s.supplier.toLowerCase();
    out = out.filter((r) => `${r.description || ""} ${r.title || ""}`.toLowerCase().includes(needle));
  }
  if (s.min_value != null) out = out.filter((r) => (r.value_max ?? 0) >= s.min_value!);
  if (s.max_value != null) out = out.filter((r) => r.value_max != null && r.value_max <= s.max_value!);
  if (s.notice_type) out = out.filter((r) => r.notice_type === s.notice_type);
  return out.map(({ description: _d, ...rest }) => rest as Tender);
}

/**
 * Stages array from saved search → activeOnly hint (matches Contracts.tsx).
 */
function deriveActiveOnly(s: SavedSearch): boolean {
  const stages = (s.filters as any)?.stages as string[] | undefined;
  if (!stages || !stages.length) return true;
  return stages.every((x) => x === "open");
}

/**
 * Unified matcher: returns the same ordered tender set the Contracts page would
 * render for this saved search. Used for both the digest list and the
 * monitoring snapshot count.
 *
 * If a keyword exists, results come from the shared Hybrid Semantic Search
 * pipeline (search_tenders_hybrid). Otherwise we fall back to the legacy
 * filter-only query against `tenders`.
 */
async function fetchMatchingTenders(s: SavedSearch, opts: { activeOnly?: boolean } = {}): Promise<Tender[]> {
  const f = s.filters || {};
  const keyword = (f as any).keyword?.toString().trim() || "";
  const activeOnly = opts.activeOnly ?? deriveActiveOnly(s);

  if (keyword) {
    const ids = await fetchSemanticHitIds(keyword, s.cpv || null, activeOnly);
    if (!ids.length) return [];
    const { data, error } = await supabase.from("tenders").select(TENDER_COLS).in("id", ids);
    if (error) {
      console.warn("hydrate tenders failed:", error.message);
      return [];
    }
    const byId = new Map((data || []).map((t: any) => [t.id, t]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as any[];
    return applyPostFilters(ordered, s);
  }

  // No keyword → filter-only browse (mirrors useStoredNotices on Contracts).
  let q = supabase.from("tenders").select(TENDER_COLS).order("published_at", { ascending: false }).limit(2000);
  if (activeOnly) q = q.gte("deadline_at", new Date().toISOString());
  if (s.published_from) q = q.gte("published_at", s.published_from);
  if (s.published_to) q = q.lte("published_at", s.published_to);
  if (s.source && s.source !== "all") {
    const codes = SOURCE_MAP[s.source];
    if (codes?.length) q = q.in("source", codes);
  }
  if (s.buyer) q = q.ilike("buyer_name", `%${s.buyer}%`);
  if (s.min_value != null) q = q.gte("value_max", s.min_value);
  if (s.max_value != null) q = q.lte("value_max", s.max_value);
  if (s.cpv) q = q.ilike("primary_cpv", `${s.cpv}%`);
  if (s.notice_type) q = q.eq("notice_type", s.notice_type);
  const { data, error } = await q;
  if (error) throw new Error(`tenders: ${error.message}`);
  return applyPostFilters((data || []) as any[], s);
}

/**
 * Build the digest set + monitoring counts using the unified pipeline.
 * - newRows: tenders to show in the email body (incremental window applied).
 * - allMatchingCount: total matching set (the number Contracts page renders).
 */
async function buildDigestSet(
  s: SavedSearch,
  mode: DigestMode,
  force = false,
): Promise<{ newRows: Tender[]; allMatchingCount: number }> {
  const matching = await fetchMatchingTenders(s);
  const allMatchingCount = matching.length;

  let windowed: Tender[];
  if (mode === "incremental" && s.last_alerted_at && !force) {
    // Incremental digest: only opportunities published since the previous send.
    const floor = s.last_alerted_at;
    windowed = matching.filter((t) => t.published_at && t.published_at > floor);
  } else {
    // First digest / QA run: full matching set, matching Contract Search.
    windowed = matching;
    if (s.published_from) windowed = windowed.filter((t) => t.published_at && t.published_at >= s.published_from!);
  }
  if (s.published_to) windowed = windowed.filter((t) => t.published_at && t.published_at <= s.published_to!);

  // TEMP DEBUG (remove after QA verification): proves whether matching tenders are
  // being excluded by the incremental window vs. genuinely not matching. Compare
  // `all` (== Contract Search count) with `windowed` (what the email body shows).
  console.log(
    "[digest] stage=window_debug",
    JSON.stringify({
      id: s.id,
      name: s.name,
      mode,
      force,
      all: allMatchingCount,
      windowed: windowed.length,
      last_alerted_at: s.last_alerted_at,
      published_from: s.published_from,
      published_to: s.published_to,
    }),
  );

  return { newRows: windowed.slice(0, 50), allMatchingCount };
}

async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`resend ${res.status}: ${body}`);
  return body;
}

async function runAlerts(filterId?: string, force = false, userId?: string) {
  const t0 = Date.now();
  // Resolve "now" once and derive every scheduling value from it, so a single
  // run never straddles two UK hours/days mid-evaluation.
  const now = new Date();
  const london = londonParts(now);
  const todayKey = londonDateKey(london);
  console.log(
    "[digest] stage=scheduler_started",
    JSON.stringify({ filterId, force, userId, at: now.toISOString(), london_hour: london.hour, london_day: todayKey }),
  );

  // Automated batch runs (no specific filter, no force) only fire during the
  // scheduled UK hour or one of its retry hours. This gate — not the (UTC) cron
  // clock — is what pins delivery to 08:00 Europe/London and makes it DST-correct.
  // The scheduler ticks hourly; a run outside the window is a no-op. Manual/QA
  // (force) and targeted (filterId/userId) invocations bypass the window.
  const isBatchRun = !filterId && !userId && !force;
  if (isBatchRun) {
    const firstRetryHour = MONITOR_SCHEDULE.hour;
    const lastRetryHour = MONITOR_SCHEDULE.hour + MAX_RETRY_HOURS;
    const withinRetryWindow = london.hour >= firstRetryHour && london.hour <= lastRetryHour;
    if (!withinRetryWindow) {
      console.log(
        "[digest] stage=skipped_run",
        JSON.stringify({
          reason: "outside scheduled hour + retry window",
          current_london_hour: london.hour,
          scheduled_hour: MONITOR_SCHEDULE.hour,
          max_retry_hours: MAX_RETRY_HOURS,
        }),
      );
      return {
        ok: true,
        skipped: "outside scheduled hour + retry window",
        current_london_hour: london.hour,
        count: 0,
        results: [],
      };
    }
  }

  let query = supabase.from("saved_searches").select("*").eq("active", true);
  if (filterId) query = query.eq("id", filterId);
  // [QA UTILITY] When userId is provided, restrict to that user's saved searches only.
  if (userId) query = query.eq("user_id", userId);
  const { data: searches, error } = await query;
  if (error) throw new Error(`saved_searches: ${error.message}`);
  console.log(
    "[digest] stage=selected_searches",
    JSON.stringify({ count: searches?.length ?? 0, ids: (searches ?? []).map((s: any) => s.id) }),
  );

  const results: any[] = [];
  for (const s of (searches ?? []) as SavedSearch[]) {
    try {
      // Idempotency: at most one digest per Europe/London calendar day. This is
      // the replacement for the old 24h rolling window (see SCHEDULING CONTRACT
      // above). Because the key is the UK calendar day — not elapsed time — a
      // successful send blocks further sends today, while a failed send leaves
      // last_alerted_at untouched so a later retry hour the same day can proceed.
      if (!force && s.last_alerted_at && londonDateKey(londonParts(new Date(s.last_alerted_at))) === todayKey) {
        console.log(
          "[digest] stage=skipped",
          JSON.stringify({
            id: s.id,
            name: s.name,
            reason: "already sent today (Europe/London)",
            last_alerted_at: s.last_alerted_at,
          }),
        );
        results.push({ id: s.id, name: s.name, skipped: "already sent today" });
        continue;
      }

      const recipients = s.email_recipients && s.email_recipients.length > 0 ? s.email_recipients : null;
      if (!recipients || recipients.length === 0) {
        console.log("[digest] stage=skipped", JSON.stringify({ id: s.id, name: s.name, reason: "no recipients" }));
        results.push({ id: s.id, name: s.name, skipped: "no recipients" });
        continue;
      }
      console.log(
        "[digest] stage=processing",
        JSON.stringify({
          id: s.id,
          name: s.name,
          recipients,
          keyword: (s.filters as any)?.keyword,
          active: s.active,
          last_alerted_at: s.last_alerted_at,
        }),
      );

      // First successful digest = no prior last_alerted_at. Force/QA runs are
      // treated like a first digest preview but never persist last_alerted_at.
      const isFirstDigest = !s.last_alerted_at;
      const mode: DigestMode = isFirstDigest ? "first" : "incremental";
      const { newRows: rows, allMatchingCount } = await buildDigestSet(s, mode, force);
      console.log(
        "[digest] stage=search_executed",
        JSON.stringify({ id: s.id, mode, matched: rows.length, allMatchingCount }),
      );

      let subject: string;
      let html: string;
      let kind: "first" | "new" | "none";

      if (rows.length === 0) {
        // No new opportunities — send monitoring summary using the unified
        // pipeline's all-matching count so it stays in sync with what the user
        // sees on the Contracts page via "View Matching Tenders".
        subject = `No new opportunities matching "${s.name}" today`;
        html = buildMonitoringSummaryHtml(s, allMatchingCount);
        kind = "none";
      } else if (isFirstDigest) {
        subject = `Current opportunities available for your saved search`;
        html = buildResultsHtml(
          s,
          `🟢 Your Procurement Monitor is Ready`,
          `We've found the current procurement opportunities matching your saved search. We'll continue monitoring the market on your behalf and notify you whenever new matching opportunities become available.`,
          rows,
        );
        kind = "first";
      } else {
        subject = `${rows.length} new opportunities matching "${s.name}"`;
        html = buildResultsHtml(
          s,
          `🟢 Your Procurement Monitor Found New Opportunities`,
          `We've found new procurement opportunities matching your saved search since your previous digest. Review the opportunities below to determine whether they are relevant to your business.`,
          rows,
        );
        kind = "new";
      }

      if (force) subject = `[Test] ${subject}`;

      console.log(
        "[digest] stage=email_generated",
        JSON.stringify({ id: s.id, kind, subject, recipients, rows: rows.length }),
      );
      const emailResp = await sendEmail(recipients, subject, html);
      console.log(
        "[digest] stage=email_sent",
        JSON.stringify({ id: s.id, kind, recipients, response: emailResp.slice(0, 200) }),
      );

      // Only persist last_alerted_at after a successful real (non-force) send.
      if (!force) {
        const { error: upErr } = await supabase
          .from("saved_searches")
          .update({ last_alerted_at: new Date().toISOString() })
          .eq("id", s.id);
        if (upErr) console.error("last_alerted_at update failed", s.id, upErr.message);
      }

      results.push({
        id: s.id,
        name: s.name,
        kind,
        matched: rows.length,
        recipients,
        email: JSON.parse(emailResp),
      });
    } catch (e: any) {
      console.error(
        "[digest] stage=failure",
        JSON.stringify({ id: s.id, name: s.name, error: e?.message || String(e) }),
      );
      results.push({ id: s.id, name: s.name, error: e.message });
    }
  }
  console.log(
    "[digest] stage=scheduler_finished",
    JSON.stringify({
      count: results.length,
      duration_ms: Date.now() - t0,
      errors: results.filter((r) => r.error).length,
      skipped: results.filter((r) => r.skipped).length,
      sent: results.filter((r) => r.email).length,
    }),
  );

  const errs = results.filter((r) => r.error);
  await supabase.from("ingest_runs").insert({
    source: "daily-search-alerts",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    count: results.length,
    duration_ms: Date.now() - t0,
    errors: errs.length ? errs : null,
  });

  return { ok: true, count: results.length, duration_ms: Date.now() - t0, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let filterId: string | undefined;
    let force = url.searchParams.get("force") === "true";
    let userId: string | undefined;
    // [QA UTILITY] Resolve currentUserOnly to the authenticated user's id from the JWT.
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body === "object") {
          if (body.id) filterId = String(body.id);
          if (body.force === true) force = true;
          if (body.userId) userId = String(body.userId);
          if (body.currentUserOnly === true) {
            const authHeader = req.headers.get("Authorization") || "";
            const token = authHeader.replace(/^Bearer\s+/i, "");
            if (token) {
              const { data: u } = await supabase.auth.getUser(token);
              if (u?.user?.id) userId = u.user.id;
            }
            if (!userId) throw new Error("currentUserOnly requires a valid Authorization header");
          }
        }
      } catch (e: any) {
        if (e?.message?.includes("currentUserOnly")) throw e;
        /* empty body ok */
      }
    } else {
      filterId = url.searchParams.get("id") ?? undefined;
    }
    const result = await runAlerts(filterId, force, userId);

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
