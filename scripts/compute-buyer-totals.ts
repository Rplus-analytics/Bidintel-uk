import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  (import.meta.env.VITE_SUPABASE_URL as string) || "",
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || ""
);

const MAX_SANE_VALUE = 10_000_000_000;

async function fetchAll(table: string, dateCol: string, fromIso: string, limit: number) {
  const all: any[] = [];
  const pageSize = 1000;
  for (let start = 0; start < limit; start += pageSize) {
    const end = Math.min(start + pageSize - 1, limit - 1);
    const { data, error } = await (supabase as any)
      .from(table)
      .select("*")
      .gte(dateCol, fromIso)
      .order(dateCol, { ascending: false, nullsFirst: false })
      .range(start, end);
    if (error) throw error;
    all.push(...(data || []));
    if ((data || []).length < end - start + 1) break;
  }
  return all;
}

function dedupeKey(n: any) {
  if (n.external_id) return `${(n.source || "").toLowerCase()}|${n.external_id.toLowerCase()}`;
  return `${(n.title || "").toLowerCase()}|${(n.buyer_name || n.buyer || "").toLowerCase()}`.trim();
}

async function main() {
  const from = new Date();
  from.setDate(from.getDate() - 365);
  const fromIso = from.toISOString();

  const [noticeRows, tenderRows] = await Promise.all([
    fetchAll("notices", "published_date", fromIso, 10000),
    fetchAll("tenders", "published_at", fromIso, 10000),
  ]);

  const seen = new Map();
  for (const r of tenderRows) seen.set(dedupeKey(r), r);
  for (const r of noticeRows) {
    const k = dedupeKey(r);
    if (!seen.has(k)) seen.set(k, r);
  }
  const merged = Array.from(seen.values());

  const map = new Map();
  const seenPerBuyer = new Map();

  for (const n of merged) {
    const buyer = n.buyer_name || n.buyer || "";
    if (!buyer) continue;

    const rawVal = (n.value_min !== undefined ? n.value_min : n.value) || (n.value_max !== undefined ? n.value_max : n.value_high) || 0;
    const collapseKey = `${(n.title || "").toLowerCase().trim()}|${Math.round(rawVal)}`;
    let seenSet = seenPerBuyer.get(buyer);
    if (!seenSet) { seenSet = new Set(); seenPerBuyer.set(buyer, seenSet); }
    if (seenSet.has(collapseKey)) continue;
    seenSet.add(collapseKey);

    const cur = (n.currency || "GBP").toUpperCase();
    const titleLower = (n.title || "").toLowerCase();
    const noticeTypeLower = ((n.notice_type || "") + "").toLowerCase();
    const isFramework = titleLower.includes("framework") ||
                        titleLower.includes("dps") ||
                        titleLower.includes("dynamic purchasing") ||
                        noticeTypeLower.includes("framework") ||
                        noticeTypeLower.includes("pin");
    const includeInSpend = (cur === "GBP" || cur === "") && rawVal > 0 && rawVal <= MAX_SANE_VALUE && !isFramework;

    const entry = map.get(buyer) || { name: buyer, contracts: 0, spend: 0 };
    entry.contracts += 1;
    if (includeInSpend) entry.spend += rawVal;
    map.set(buyer, entry);
  }

  const results = Array.from(map.values()).sort((a: any, b: any) => b.spend - a.spend || b.contracts - a.contracts);

  const targets = [
    "Ministry of Justice",
    "Denbighshire Leisure",
    "SUPPLY CHAIN COORDINATION LIMITED",
    "Scape Procure Scotland",
  ];

  for (const t of targets) {
    const match = results.find((r: any) => r.name.toLowerCase().includes(t.toLowerCase()));
    if (match) {
      console.log(`${match.name}: £${(match.spend / 1e6).toFixed(1)}M from ${match.contracts} notices`);
    } else {
      console.log(`${t}: NOT FOUND`);
    }
  }
}

main().catch(console.error);
