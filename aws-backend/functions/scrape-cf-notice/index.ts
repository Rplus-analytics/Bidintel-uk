// Contracts Finder notice-page scraper.
//
// Ported from supabase/functions/scrape-cf-notice (Deno). The HTML parsing
// (extractField / extractDl / parseNotice), the browser-like fetch headers, the
// concurrency of 5 and the 500ms pause between chunks are all unchanged.
//
// ONE DELIBERATE BEHAVIOUR CHANGE — read before deploying:
//
// The Supabase original is NOT a stateless proxy, despite being listed as one in
// docs/migration/supabase-aws-migration-status.md (section 10, row 14 and the
// section 11 matrix both record "no DB / Supabase deps: none"). It actually:
//   1. reads a batch of 50 unscraped rows from `cf_scrape_queue`,
//   2. writes the parsed fields back to each row (scraped, scraped_at, error), and
//   3. inserts a summary row into `ingest_runs`,
// all with the service-role key.
//
// Those three steps need Postgres, which does not exist on AWS yet, so this port
// covers the half that is genuinely portable today: the scrape + parse. Callers
// pass the notice IDs explicitly and get the parsed fields back; nothing is read
// from or written to any datastore.
//
//   POST { "noticeIds": ["abc-123", "def-456"] }
//     -> { processed, results: [{ notice_id, supply_chain, ojeu_procedure_type,
//                                 accelerated_justification, closing_time }, ...] }
//
// The queue-drain mode returns 501 until the datastore is migrated. See the
// "Partially ported" section of aws-backend/README.md for what to add then.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractField(html: string, label: string): string | null {
  // Look for <h4><strong>Label</strong></h4>\s*<p>...</p>
  const re = new RegExp(
    `<h4[^>]*>\\s*<strong>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</strong>\\s*</h4>\\s*<p[^>]*>([\\s\\S]*?)</p>`,
    'i'
  )
  const m = html.match(re)
  if (!m) return null
  const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || null
}

function extractDl(html: string, label: string): string | null {
  // <dt>...<strong>Label</strong>...</dt>\s*<dd>...<p>value</p>...</dd>
  const re = new RegExp(
    `<dt[^>]*>[\\s\\S]*?<strong>\\s*${label}\\s*</strong>[\\s\\S]*?</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`,
    'i'
  )
  const m = html.match(re)
  if (!m) return null
  const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || null
}

function parseNotice(html: string) {
  const labels = {
    supply_chain: ['Supply chain', 'Supply Chain Information', 'Supply chain information'],
    ojeu_procedure_type: ['Procedure type', 'OJEU procedure type', 'OJEU Procedure Type'],
    accelerated_justification: ['Accelerated justification', 'Accelerated Justification', 'Justification for accelerated procedure'],
    closing_time: ['Closing time', 'Closing Time'],
  }
  const out: Record<string, string | null> = {}
  for (const [k, candidates] of Object.entries(labels)) {
    let v: string | null = null
    for (const l of candidates) {
      v = extractField(html, l) ?? extractDl(html, l)
      if (v) break
    }
    out[k] = v
  }
  return out
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
}

const CONCURRENCY = 5

// Same scrape + parse as the original processOne, minus the cf_scrape_queue writes.
async function processOne(noticeId: string) {
  const url = `https://www.contractsfinder.service.gov.uk/Notice/${noticeId}`
  try {
    const resp = await fetch(url, { headers: FETCH_HEADERS })
    if (!resp.ok) {
      return { notice_id: noticeId, status: resp.status, error: true }
    }
    const html = await resp.text()
    const fields = parseNotice(html)
    return { notice_id: noticeId, ...fields }
  } catch (e) {
    return { notice_id: noticeId, error: String(e) }
  }
}

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

  const startedAt = new Date()

  let noticeIds: string[]
  try {
    const body = readJsonBody(event)
    noticeIds = Array.isArray(body?.noticeIds)
      ? body.noticeIds.map((v: unknown) => String(v)).filter(Boolean)
      : []
  } catch {
    noticeIds = []
  }

  // Queue-drain mode (the original's default) needs cf_scrape_queue + ingest_runs.
  if (noticeIds.length === 0) {
    return {
      statusCode: 501,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "noticeIds required",
        detail:
          "This Lambda implements the stateless scrape+parse half of scrape-cf-notice. " +
          "Queue-drain mode (read cf_scrape_queue, write results back, log to ingest_runs) " +
          "is not ported: it needs the database, which is still on Supabase. " +
          "Pass { noticeIds: [...] } to scrape specific notices.",
      }),
    }
  }

  const results: any[] = []
  for (let i = 0; i < noticeIds.length; i += CONCURRENCY) {
    const chunk = noticeIds.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.all(chunk.map(processOne))
    results.push(...chunkResults)
    if (i + CONCURRENCY < noticeIds.length) await sleep(500)
  }

  // Stands in for the original's ingest_runs insert; CloudWatch is the sink for now.
  console.log(JSON.stringify({
    source: 'scrape-cf-notice',
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    count: results.length,
    duration_ms: Date.now() - startedAt.getTime(),
  }))

  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ processed: results.length, results }),
  }
};
