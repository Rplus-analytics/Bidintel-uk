import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const startedAt = new Date()
  const { data: queue, error: qErr } = await supabase
    .from('cf_scrape_queue')
    .select('id, notice_id')
    .eq('scraped', false)
    .order('created_at', { ascending: true })
    .limit(50)

  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
  }

  async function processOne(row: { id: string; notice_id: string }) {
    const url = `https://www.contractsfinder.service.gov.uk/Notice/${row.notice_id}`
    try {
      const resp = await fetch(url, { headers: FETCH_HEADERS })
      if (!resp.ok) {
        await supabase.from('cf_scrape_queue').update({
          scraped: true, scraped_at: new Date().toISOString(),
          error: `HTTP ${resp.status}`,
        }).eq('id', row.id)
        return { notice_id: row.notice_id, status: resp.status, error: true }
      }
      const html = await resp.text()
      const fields = parseNotice(html)
      await supabase.from('cf_scrape_queue').update({
        scraped: true, scraped_at: new Date().toISOString(),
        supply_chain: fields.supply_chain,
        ojeu_procedure_type: fields.ojeu_procedure_type,
        accelerated_justification: fields.accelerated_justification,
        closing_time: fields.closing_time,
        error: null,
      }).eq('id', row.id)
      return { notice_id: row.notice_id, ...fields }
    } catch (e) {
      await supabase.from('cf_scrape_queue').update({
        scraped: true, scraped_at: new Date().toISOString(),
        error: String(e),
      }).eq('id', row.id)
      return { notice_id: row.notice_id, error: String(e) }
    }
  }

  const CONCURRENCY = 5
  const results: any[] = []
  const rows = queue ?? []
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY)
    const chunkResults = await Promise.all(chunk.map(processOne))
    results.push(...chunkResults)
    if (i + CONCURRENCY < rows.length) await sleep(500)
  }

  await supabase.from('ingest_runs').insert({
    source: 'scrape-cf-notice',
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    count: results.length,
    duration_ms: Date.now() - startedAt.getTime(),
  })

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
