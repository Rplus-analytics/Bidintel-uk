// Hybrid semantic + keyword + CPV search with domain-aware expansion + procurement-aware ranking.
//
// Ported from supabase/functions/semantic-search (Deno). The entire procurement
// domain taxonomy — DOMAINS, COMPATIBLE, classifyDomain, buildExpansion — is
// carried over character-for-character; it is tuned data, and paraphrasing it
// would silently change search results. Database access is stubbed — see db.ts.
//
// This is the flagship path the migration report warns about:
//
//   semantic-search -> search_tenders_hybrid (14-arg) -> tenders.embedding vector(1536)
//                                                      + tenders.search_tsv
//                                                      + tenders_embedding_hnsw_idx
//                                                      -> pgvector 0.8.0 + pg_trgm 1.6
//
// `search_tenders_hybrid` exists in FOUR overloads on the source database (5, 10,
// 13 and 14 arg). This function calls the 14-arg variant, the one with
// core_terms, context_terms, active_only and intent_domain. Porting a different
// overload to RDS breaks search silently rather than loudly — db.ts uses named
// argument notation specifically to make the binding explicit.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { searchTendersHybrid, isDbConfigured } from "./db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const EMBED_MODEL = "text-embedding-3-small";

// --- Procurement domain taxonomy --------------------------------------------
// Each domain owns its keyword expansions and CPV prefixes. Cross-domain
// pollution (e.g. adding generic IT 72000000 to a Cleaning query) is the
// largest remaining source of false positives, so expansion is now gated by
// the detected domain.
type Domain =
  | "catering"
  | "cleaning"
  | "fm"
  | "cyber"
  | "software"
  | "it"
  | "construction"
  | "care"
  | "nursing"
  | "healthcare"
  | "transport"
  | "taxi"
  | "consultancy"
  | "legal"
  | "training"
  | "education"
  | "grounds"
  | "waste"
  | "staffing"
  | "defence"
  | "gov_finance"
  | "frameworks"
  | "general";

interface DomainDef {
  label: string;
  // hints used by the classifier
  hints: string[];
  // expansion terms added to keyword/embedding query
  terms: string[];
  // CPV prefixes considered domain-relevant
  cpvs: string[];
  // procurement-intent words that should appear in a strong match
  core: string[];
  // generic words from the query that on their own indicate noise
  context?: string[];
}

const DOMAINS: Record<Exclude<Domain, "general">, DomainDef> = {
  catering: {
    label: "Food / Catering Services",
    hints: ["catering", "food", "meal", "meals", "school meals", "lunch", "breakfast", "kitchen", "canteen", "nutrition"],
    terms: ["catering services", "food services", "meal provision", "school meals", "pupil meals"],
    cpvs: ["5552", "5551", "5550", "1589", "1580", "15894", "55320", "55520", "55521", "55522", "55523", "55524"],
    core: ["catering", "meal", "meals", "food", "nutrition", "kitchen", "canteen", "lunch", "breakfast"],
    context: ["school", "education", "pupil", "academy", "hospital", "patient"],
  },
  cleaning: {
    label: "Cleaning Services",
    hints: ["cleaning", "janitorial", "sanitation", "housekeeping", "hospital cleaning", "office cleaning"],
    terms: ["cleaning services", "janitorial services", "hospital cleaning", "office cleaning"],
    cpvs: ["9091", "90910", "90911", "90919", "90920", "90921", "90922", "90923", "90924"],
    core: ["cleaning", "janitorial", "sanitation", "housekeeping"],
    context: ["hospital", "school", "office", "communal"],
  },
  fm: {
    label: "Facilities Management",
    hints: ["facilities management", "facilities", "fm services", "hard fm", "soft fm", "estate management", "building maintenance"],
    terms: ["facilities management", "FM services", "hard FM", "soft FM", "building maintenance", "estate management"],
    cpvs: ["7099", "79993", "50700", "50710", "50720", "50730", "50740", "50750", "50760", "50800"],
    core: ["facilities", "fm", "estate", "maintenance"],
  },
  cyber: {
    label: "Cyber Security",
    hints: ["cyber", "cybersecurity", "infosec", "information security", "penetration test", "soc", "iso 27001"],
    // Deliberately NOT adding generic 72000000 or physical security CPVs.
    terms: ["cyber security", "information security", "infosec", "penetration testing", "security operations centre"],
    cpvs: ["72212732", "72611000", "48730000", "35120000"],
    core: ["cyber", "infosec", "information security", "penetration", "siem", "soc"],
  },
  software: {
    label: "Software Development",
    hints: ["software development", "bespoke software", "application development", "web development", "mobile app", "saas"],
    terms: ["software development", "application development", "bespoke software", "web development"],
    cpvs: ["7222", "7223", "7224", "7225", "7226", "4800", "48000"],
    core: ["software", "application", "platform", "development", "bespoke"],
  },
  it: {
    label: "IT Services & Hardware",
    hints: ["it services", "it support", "information technology", "managed it", "it hardware", "digital transformation"],
    terms: ["IT services", "information technology", "managed IT services", "IT support"],
    cpvs: ["72", "48"],
    core: ["it", "information technology", "infrastructure", "managed services"],
  },
  construction: {
    label: "Construction Works",
    hints: ["construction", "building works", "refurbishment", "renovation", "demolition", "civils", "highways"],
    terms: ["construction works", "building works", "refurbishment", "civil engineering"],
    cpvs: ["45"],
    core: ["construction", "building", "works", "refurbishment", "civils"],
  },
  care: {
    label: "Social Care",
    hints: ["domiciliary care", "social care", "homecare", "care services", "supported living"],
    terms: ["care services", "social care", "domiciliary care", "supported living"],
    cpvs: ["85", "85300", "85310", "85311", "85312"],
    core: ["care", "carer", "domiciliary", "social care"],
  },
  nursing: {
    label: "Healthcare / Nursing",
    hints: ["nursing", "nurse", "clinical staffing", "healthcare staffing", "agency nurse"],
    terms: ["nursing services", "healthcare staffing", "clinical staffing"],
    cpvs: ["85141", "85120", "85100"],
    core: ["nursing", "nurse", "clinical"],
  },
  transport: {
    label: "Transport / Logistics",
    hints: ["transport", "logistics", "haulage", "fleet", "freight"],
    terms: ["transport services", "logistics services", "fleet services"],
    cpvs: ["60"],
    core: ["transport", "logistics", "haulage", "fleet"],
  },
  taxi: {
    label: "Taxi / Passenger Transport",
    hints: ["taxi", "passenger transport", "school transport"],
    terms: ["taxi services", "passenger transport", "school transport"],
    cpvs: ["60120", "60130", "60140"],
    core: ["taxi", "passenger transport"],
  },
  consultancy: {
    label: "Consultancy",
    hints: ["consultancy", "consulting", "advisory"],
    terms: ["consulting services", "advisory services", "management consultancy"],
    cpvs: ["79400", "79410", "79411", "79420"],
    core: ["consultancy", "consulting", "advisory"],
  },
  legal: {
    label: "Legal Services",
    hints: ["legal", "solicitor", "barrister", "law firm"],
    terms: ["legal services", "legal advice"],
    cpvs: ["79100", "79110", "79111", "79112"],
    core: ["legal", "solicitor", "barrister"],
  },
  training: {
    label: "Training Services",
    hints: ["training", "learning and development", "l&d", "apprenticeship", "leadership development"],
    terms: ["training services", "learning and development", "apprenticeship training"],
    cpvs: ["805", "80500", "80510", "80520", "80530"],
    core: ["training", "learning", "apprenticeship"],
  },
  grounds: {
    label: "Grounds Maintenance / Landscaping",
    hints: ["grounds maintenance", "grounds", "landscaping", "grass cutting", "tree surgery", "arboriculture", "parks maintenance", "horticulture", "verge maintenance"],
    terms: ["grounds maintenance", "landscaping services", "grass cutting", "tree surgery", "arboricultural services", "parks maintenance", "horticultural services"],
    cpvs: ["7731", "77310", "77311", "77312", "77313", "77314", "77340", "77341", "77342", "7732", "77320"],
    core: ["grounds", "landscaping", "grass", "arboriculture", "tree surgery", "horticulture", "parks"],
  },
  waste: {
    label: "Waste Management",
    hints: ["waste management", "waste collection", "refuse collection", "recycling", "clinical waste", "hazardous waste", "skip hire", "waste disposal"],
    terms: ["waste management", "waste collection", "refuse collection", "recycling services", "clinical waste disposal", "hazardous waste disposal"],
    cpvs: ["9051", "90510", "90511", "90512", "90513", "90514", "9052", "90520", "90521", "90522", "90523", "90524", "9053", "9054"],
    core: ["waste", "refuse", "recycling", "disposal"],
  },
  staffing: {
    label: "Temporary Staffing / Recruitment",
    hints: ["temporary staffing", "agency staff", "agency workers", "temporary labour", "interim staff", "contingent workforce", "recruitment services", "managed service provider", "msp", "vendor neutral"],
    terms: ["temporary staffing", "agency staff supply", "recruitment services", "interim staff", "contingent workforce", "managed service provider"],
    cpvs: ["7962", "79620", "79621", "79622", "79623", "79624", "79625", "7961", "79610", "79611"],
    core: ["staffing", "agency", "temporary", "interim", "recruitment", "contingent", "workforce"],
  },
  healthcare: {
    label: "Healthcare",
    hints: ["nhs", "national health service", "healthcare", "health care", "hospital", "primary care", "gp practice", "ccg", "icb", "integrated care board", "trust hospital"],
    terms: ["healthcare services", "NHS services", "hospital services", "clinical services"],
    cpvs: ["85", "85100", "85110", "85120", "85140", "85141", "85142", "85143", "85144", "85145", "85146", "85147", "85148", "85149"],
    core: ["healthcare", "nhs", "hospital", "clinical", "medical"],
  },
  education: {
    label: "Education",
    hints: ["dfe", "department for education", "education services", "schools", "school ", "academy trust", "multi-academy trust", "mat ", "further education", "higher education", "university", "college", "sen ", "send ", "sixth form", "early years"],
    terms: ["education services", "schools services", "academy trust services", "further education services", "higher education services"],
    cpvs: ["80", "80100", "80110", "80200", "80210", "80300", "80400", "80410", "80420"],
    core: ["education", "school", "academy", "university", "college", "learning"],
  },
  defence: {
    label: "Defence",
    hints: ["mod", "mod ", "ministry of defence", "defence", "military", "royal navy", "raf", "royal air force", "british army", "dstl", "de&s", "des "],
    terms: ["defence services", "military services", "Ministry of Defence services"],
    cpvs: ["35", "3510", "35100", "35200", "35300", "35400", "35500", "35600", "35700", "35800"],
    core: ["defence", "military", "mod", "ministry of defence"],
  },
  gov_finance: {
    label: "Government Finance",
    hints: ["hmrc", "hm revenue", "hm treasury", "hmt", "tax authority", "revenue and customs", "public finance", "government finance"],
    terms: ["government finance services", "tax administration services", "HMRC services", "public finance services"],
    cpvs: ["66", "66100", "66110", "66120", "66130", "66600", "79210", "79211", "79212", "79220", "79221"],
    core: ["hmrc", "tax", "revenue", "treasury", "finance"],
  },
  frameworks: {
    label: "Procurement Frameworks",
    hints: ["ccs", "crown commercial", "crown commercial service", "framework agreement", "dynamic purchasing system", "dps ", "g-cloud", "gcloud", "digital outcomes", "rm6", "ypo", "nhs sbs", "eshcp", "kcs"],
    terms: ["framework agreement", "Crown Commercial Service", "dynamic purchasing system", "G-Cloud framework"],
    cpvs: [],
    core: ["framework", "ccs", "crown commercial", "dps", "g-cloud"],
  },
};

// Map of compatible co-domains (a query that scores in domain X can keep
// expansions from these auxiliary domains). Defaults: only the primary
// domain — i.e. no cross-domain spill unless explicitly listed below.
const COMPATIBLE: Partial<Record<Domain, Domain[]>> = {
  software: ["it"],
  cyber: [], // intentionally NOT it — keeps generic IT noise out of cyber queries
  it: ["software"],
  fm: ["cleaning"], // FM commonly bundles cleaning
  nursing: ["care", "healthcare"],
  healthcare: ["nursing", "care"],
  education: ["training"],
  training: ["education"],
  staffing: ["nursing"], // healthcare staffing overlap
};

function classifyDomain(q: string): { domain: Domain; matchedHints: string[] } {
  const lower = ` ${q.toLowerCase()} `;
  let best: { domain: Domain; score: number; hints: string[] } = { domain: "general", score: 0, hints: [] };
  for (const [key, def] of Object.entries(DOMAINS) as [Exclude<Domain, "general">, DomainDef][]) {
    const hits: string[] = [];
    let score = 0;
    for (const h of def.hints) {
      if (lower.includes(` ${h} `) || lower.includes(h)) {
        hits.push(h);
        // Longer hint phrases are more discriminating.
        score += h.length;
      }
    }
    if (score > best.score) best = { domain: key, score, hints: hits };
  }
  return { domain: best.domain, matchedHints: best.hints };
}

function buildExpansion(q: string) {
  const { domain, matchedHints } = classifyDomain(q);

  // Walk every domain so we can split into "allowed" vs "rejected" for
  // diagnostics — the rejected set is what the old DICT would have leaked in.
  const allowedDomains = new Set<Domain>([domain, ...(COMPATIBLE[domain] ?? [])]);

  const terms = new Set<string>();
  const cpvs = new Set<string>();
  const core = new Set<string>();
  const context = new Set<string>();
  const rejectedTerms = new Set<string>();
  const rejectedCpvs = new Set<string>();
  const matched: string[] = [];

  const lower = q.toLowerCase();

  for (const [key, def] of Object.entries(DOMAINS) as [Exclude<Domain, "general">, DomainDef][]) {
    // a domain is "triggered" if any of its hints appears in the query
    const triggered = def.hints.some((h) => lower.includes(h));
    if (!triggered) continue;
    matched.push(key);
    const allowed = allowedDomains.has(key);
    for (const t of def.terms) (allowed ? terms : rejectedTerms).add(t);
    for (const c of def.cpvs) (allowed ? cpvs : rejectedCpvs).add(c);
    if (allowed) {
      for (const t of def.core) core.add(t.toLowerCase());
      for (const t of def.context ?? []) context.add(t.toLowerCase());
    }
  }

  // If nothing matched at all, fall back to a minimal expansion using the raw query.
  if (terms.size === 0 && cpvs.size === 0 && domain === "general") {
    // no expansion — keyword + semantic only
  }

  return {
    domain,
    domainLabel: domain === "general" ? "General / Unclassified" : DOMAINS[domain].label,
    matchedHints,
    matched,
    terms: [...terms],
    cpvs: [...cpvs],
    core: [...core],
    context: [...context],
    rejectedTerms: [...rejectedTerms],
    rejectedCpvs: [...rejectedCpvs],
    allowedDomains: [...allowedDomains],
  };
}

async function embed(input: string): Promise<number[]> {
  // OpenAI directly, not the Lovable AI Gateway. Must stay the SAME model that
  // produced the stored vectors (text-embedding-3-small) — a different model
  // puts queries in a different vector space and every similarity score becomes
  // noise, silently, with no error.
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json: any = await res.json();
  return json?.data?.[0]?.embedding as number[];
}

// Mirrors Deno's `await req.json().catch(() => ({}))` — a malformed or absent
// body degrades to an empty object and therefore to the empty-query response,
// rather than throwing.
function readJsonBody(event: APIGatewayProxyEventV2): any {
  try {
    const raw = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body ?? "";
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const {
      query = "",
      cpvPrefix = null,
      daysBack = 365,
      matchCount = 200,
      weights = { keyword: 0.5, cpv: 0.3, semantic: 0.2 },
      activeOnly = true,
    } = readJsonBody(event);
    const q = String(query || "").trim();
    if (!q) {
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          results: [],
          embeddingAvailable: false,
          expansion: {
            domain: "general",
            domainLabel: "General / Unclassified",
            matchedHints: [],
            matched: [],
            terms: [],
            cpvs: [],
            core: [],
            context: [],
            rejectedTerms: [],
            rejectedCpvs: [],
            allowedDomains: [],
          },
          count: 0,
        }),
      };
    }

    const expansion = buildExpansion(q);
    const embedInput = [q, ...expansion.terms, ...expansion.core].join(". ");

    let queryEmbedding: number[] | null = null;
    let embedError: string | null = null;
    try {
      queryEmbedding = await embed(embedInput);
    } catch (e: any) {
      embedError = e?.message || String(e);
      console.warn("query embed failed, keyword+CPV only:", embedError);
    }

    const sinceTs = new Date(Date.now() - Number(daysBack) * 86400000).toISOString();

    // The Supabase original degrades gracefully when the RPC fails: it returns
    // 200 with an `rpcError` field and an empty result set rather than a 5xx.
    // The un-wired stub takes the same shape so the frontend contract holds.
    if (!isDbConfigured()) {
      const msg =
        "semantic-search is scaffolded but not wired to RDS. See db.ts TODO(rds). " +
        "The Supabase version remains the live implementation.";
      console.warn(msg);
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          results: [],
          embeddingAvailable: queryEmbedding !== null,
          embedError,
          rpcError: msg,
          expansion,
          count: 0,
        }),
      };
    }

    let rows: any[];
    try {
      rows = await searchTendersHybrid({
        query_embedding: queryEmbedding,
        query_text: q,
        match_count: Math.min(Math.max(Number(matchCount) || 100, 1), 300),
        since_ts: sinceTs,
        cpv_prefix: cpvPrefix || null,
        expansion_terms: expansion.terms,
        cpv_prefixes: expansion.cpvs,
        w_keyword: Number(weights?.keyword ?? 0.5),
        w_cpv: Number(weights?.cpv ?? 0.3),
        w_semantic: Number(weights?.semantic ?? 0.2),
        core_terms: expansion.core,
        context_terms: expansion.context,
        active_only: Boolean(activeOnly),
        intent_domain: expansion.domain || null,
      });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.warn("hybrid rpc failed:", msg);
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          results: [],
          embeddingAvailable: queryEmbedding !== null,
          embedError,
          rpcError: msg,
          expansion,
          count: 0,
        }),
      };
    }

    console.log("[semantic-search] query=%j domain=%s", q, expansion.domain);
    console.log("[semantic-search] allowed.terms=%j allowed.cpvs=%j", expansion.terms, expansion.cpvs);
    console.log("[semantic-search] rejected.terms=%j rejected.cpvs=%j", expansion.rejectedTerms, expansion.rejectedCpvs);
    console.log("[semantic-search] weights=%j returned=%d", weights, rows.length);

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        results: rows,
        embeddingAvailable: queryEmbedding !== null,
        embedError,
        expansion,
        weights,
        count: rows.length,
      }),
    };
  } catch (e: any) {
    console.error("semantic-search error:", e);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: e?.message || String(e) }),
    };
  }
};

// Exported for offline verification of the taxonomy against the Deno original.
export { classifyDomain, buildExpansion };
