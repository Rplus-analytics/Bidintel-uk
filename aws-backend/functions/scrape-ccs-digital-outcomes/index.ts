// Scrapes Crown Commercial Service Digital Outcomes opportunities.
// The site (contractawardservice.crowncommercial.gov.uk) has no public API, so
// we walk paginated HTML across frameworks (dos6, dos7) x statuses (open, closed).
//
// Ported from supabase/functions/scrape-ccs-digital-outcomes (Deno) as an
// EventBridge Lambda. The HTML parsing is the sensitive part here and is carried
// over BYTE-IDENTICALLY: decodeEntities, stripTags, parseMoney, the
// govuk-supplier-list <li> regex, the ordered-paragraph field extraction, the
// framework/lot split and the longest-remaining-paragraph description heuristic.
// Scrapers break on whitespace; none of it was reformatted.
//
// TIMEOUT: MAX_RUNTIME_MS is 50_000, tuned to Supabase, and the loop checks it
// between pages across 4 framework x status combos of up to 200 pages each.
// The header comment claims "one invocation handles the entire catalogue" — that
// holds only while the catalogue stays small. Give it 900s on Lambda.

import type { ScheduledEvent } from "aws-lambda";
import { createDbClient, isDbConfigured } from "../_shared/db";

const supabase = createDbClient();


const BASE = "https://redirect.contractawardservice.crowncommercial.gov.uk/digital-outcomes/opportunities";
const FRAMEWORKS = ["dos7", "dos6"];
const STATUSES = ["open", "closed"];
const MAX_PAGES_PER_COMBO = 200;
const MAX_RUNTIME_MS = 50_000;

type Parsed = {
  project_id: string;
  title: string | null;
  url: string | null;
  buyer_name: string | null;
  procurement_route: string | null;
  value_text: string | null;
  value_number: number | null;
  framework_lot: string | null;
  framework: string | null;
  lot: string | null;
  status: string | null;
  description: string | null;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function parseMoney(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/£\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Parse a listing page. Returns opportunities found + total-results (if present).
function parseListing(html: string, filterFramework: string, filterStatus: string): {
  items: Parsed[];
  total: number | null;
} {
  const items: Parsed[] = [];
  const totalMatch = html.match(/id="totalRecordsNew"[\s\S]*?<strong[^>]*>(\d+)<\/strong>/i);
  const total = totalMatch ? Number(totalMatch[1]) : null;

  // Each opportunity is inside a <ul class="govuk-list govuk-supplier-list"><li>...</li></ul>
  const liRegex = /<ul class="govuk-list govuk-supplier-list">\s*<li>([\s\S]*?)<\/li>\s*<\/ul>/g;
  let m: RegExpExecArray | null;
  while ((m = liRegex.exec(html)) !== null) {
    const block = m[1];

    const linkMatch = block.match(
      /<a[^>]*href="([^"]*opportunity-details\/project\/(\d+))"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) continue;
    const url = decodeEntities(linkMatch[1]);
    const project_id = linkMatch[2];
    const title = stripTags(linkMatch[3]);

    // Ordered <p> lines: buyer, procurement route, value, framework/lot, status, description
    const pRegex = /<p class="govuk-body[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
    const paragraphs: string[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = pRegex.exec(block)) !== null) paragraphs.push(stripTags(pm[1]));

    const buyer_name = paragraphs[0] || null;
    const procurement_route = paragraphs.find((p) => p.startsWith("Procurement route:"))
      ?.replace(/^Procurement route:\s*/i, "") || null;
    const value_text = paragraphs.find((p) => p.startsWith("Value:"))
      ?.replace(/^Value:\s*/i, "").trim() || null;
    const value_number = parseMoney(value_text);
    const framework_lot = paragraphs.find((p) => /Digital Outcomes/i.test(p) && /Lot/i.test(p)) || null;
    let framework: string | null = null;
    let lot: string | null = null;
    if (framework_lot) {
      const fm = framework_lot.match(/^(.*?),\s*(Lot\s*\d+:.*)$/i);
      if (fm) { framework = fm[1].trim(); lot = fm[2].trim(); }
      else framework = framework_lot;
    }
    // status is a short paragraph ("open" / "closed")
    const status = paragraphs.find((p) => /^(open|closed)$/i.test(p))?.toLowerCase() || filterStatus;
    // description is the longest remaining paragraph
    const description = paragraphs
      .filter((p) =>
        p !== buyer_name && !p.startsWith("Procurement route:") && !p.startsWith("Value:") &&
        p !== framework_lot && !/^(open|closed)$/i.test(p)
      )
      .sort((a, b) => b.length - a.length)[0] || null;

    items.push({
      project_id, title, url, buyer_name, procurement_route,
      value_text, value_number, framework_lot, framework, lot,
      status, description,
    });
  }

  return { items, total };
}

async function fetchPage(framework: string, status: string, page: number): Promise<string | null> {
  const url = `${BASE}?p=${page}&framework=${framework}&status=${status}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 BidIntel/1.0",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) { await res.body?.cancel(); return null; }
    return await res.text();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertBatch(parsed: Parsed[]): Promise<{ raw: number; norm: number }> {
  if (!parsed.length) return { raw: 0, norm: 0 };
  // dedupe within batch
  const byId = new Map<string, Parsed>();
  for (const p of parsed) byId.set(p.project_id, p);
  const deduped = Array.from(byId.values());

  const rawRows = deduped.map((p) => ({
    project_id: p.project_id,
    payload: p as unknown as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
  }));
  const { error: rawErr } = await supabase
    .from("raw_ccs_digital_outcomes")
    .upsert(rawRows, { onConflict: "project_id" });
  if (rawErr) throw new Error(`raw upsert: ${rawErr.message}`);

  const normRows = deduped.map((p) => ({
    source: "ccs_digital_outcomes",
    external_id: p.project_id,
    title: p.title,
    description: p.description,
    buyer_name: p.buyer_name,
    procedure_type: p.procurement_route,
    value_max: p.value_number,
    value_min: p.value_number,
    currency: "GBP",
    source_url: p.url,
    status: p.status,
    framework: p.framework,
    lot: p.lot,
    country: "GB",
    raw_json: p as unknown as Record<string, unknown>,
  }));
  const { error: normErr } = await supabase
    .from("tenders_ccs")
    .upsert(normRows, { onConflict: "source,external_id" });
  if (normErr) throw new Error(`tenders_ccs upsert: ${normErr.message}`);

  // Also mirror into the main `tenders` table so CCS rows surface on Buyers,
  // Tenders and other pages that read from `tenders`. Map CCS status text to
  // the tender_status enum (open→active, closed→complete).
  const mainRows = deduped.map((p) => ({
    source: "ccs_digital_outcomes",
    external_id: p.project_id,
    title: p.title,
    description: p.description,
    buyer_name: p.buyer_name,
    procedure_type: p.procurement_route,
    value_max: p.value_number,
    value_min: p.value_number,
    currency: "GBP",
    source_url: p.url,
    status: p.status === "open" ? "active" : p.status === "closed" ? "complete" : p.status === "cancelled" ? "cancelled" : "unknown",
    country: "GB",
    raw_json: p as unknown as Record<string, unknown>,
  }));
  const { error: mainErr } = await supabase
    .from("tenders")
    .upsert(mainRows, { onConflict: "source,external_id" });
  if (mainErr) throw new Error(`tenders upsert: ${mainErr.message}`);

  return { raw: rawRows.length, norm: normRows.length };
}

async function run(detail: Record<string, any>): Promise<any> {
  const start = Date.now();
  const summary: Record<string, { pages: number; scraped: number; upserted: number }> = {};
  const errors: unknown[] = [];
  let totalScraped = 0;
  let totalUpserted = 0;

  const { data: run } = await supabase
    .from("ingest_runs")
    .insert({ source: "ccs_digital_outcomes", started_at: new Date().toISOString() })
    .select("id").single();
  const runId = run?.id;

  try {
    for (const framework of FRAMEWORKS) {
      for (const status of STATUSES) {
        const key = `${framework}:${status}`;
        summary[key] = { pages: 0, scraped: 0, upserted: 0 };
        const seenIds = new Set<string>();
        for (let p = 1; p <= MAX_PAGES_PER_COMBO; p++) {
          if (Date.now() - start > MAX_RUNTIME_MS) break;
          const html = await fetchPage(framework, status, p);
          if (!html) { errors.push({ framework, status, page: p, error: "fetch failed" }); break; }
          const { items } = parseListing(html, framework, status);
          if (items.length === 0) break;
          summary[key].pages++;
          summary[key].scraped += items.length;
          totalScraped += items.length;

          // stop early if every item on this page was already seen (no more pages)
          const newItems = items.filter((it) => !seenIds.has(it.project_id));
          for (const it of items) seenIds.add(it.project_id);
          if (newItems.length === 0) break;

          try {
            const r = await upsertBatch(newItems);
            summary[key].upserted += r.norm;
            totalUpserted += r.norm;
          } catch (e) {
            errors.push({ framework, status, page: p, error: (e as Error).message });
          }
        }
      }
      if (Date.now() - start > MAX_RUNTIME_MS) break;
    }

    // Update backfill_state with progress marker (year=totalUpserted so we can eyeball it)
    await supabase.from("backfill_state").upsert(
      {
        source: "ccs_digital_outcomes",
        year: totalUpserted,
        month0: 0,
        completed: errors.length === 0,
        last_run_at: new Date().toISOString(),
      },
      { onConflict: "source" },
    );

    if (runId) {
      await supabase.from("ingest_runs").update({
        finished_at: new Date().toISOString(),
        count: totalUpserted,
        errors: errors.length ? errors : null,
        duration_ms: Date.now() - start,
      }).eq("id", runId);
    }

    return {
      ok: true, run_id: runId, total_scraped: totalScraped, total_upserted: totalUpserted,
      by_combo: summary, errors, duration_ms: Date.now() - start,
    };
  } catch (e) {
    const msg = (e as Error).message;
    if (runId) {
      await supabase.from("ingest_runs").update({
        finished_at: new Date().toISOString(),
        errors: [{ fatal: msg }],
        duration_ms: Date.now() - start,
      }).eq("id", runId);
    }
    // The original returned HTTP 500; a scheduled Lambda must throw.
    throw new Error(msg);
  }
}

/**
 * EventBridge entry point. A scheduled Lambda has no HTTP response: the return
 * value is the invocation result (visible in CloudWatch / Step Functions) and a
 * throw is what marks the invocation failed so it reaches the DLQ and the
 * Errors metric. The Deno original's `return new Response(..., {status:500})`
 * would have been silently recorded as a SUCCESSFUL invocation here.
 */
export const handler = async (event: ScheduledEvent | { detail?: Record<string, any> }): Promise<any> => {
  const detail = (event as any)?.detail ?? {};

  if (!isDbConfigured()) {
    const message =
      "scrape-ccs-digital-outcomes is scaffolded but not wired to RDS. See functions/_shared/db.ts TODO(rds). " +
      "The Supabase version remains the live implementation.";
    console.warn(message);
    throw new Error(message);
  }

  return run(detail);
};

// Exported for offline verification of the scraping logic against the Deno
// original — the parsing is the sensitive part of this function.
export { parseListing, parseMoney, stripTags, decodeEntities };
