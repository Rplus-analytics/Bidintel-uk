import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { KEYWORD_SUGGESTIONS, SERVICE_CATEGORIES, POPULAR_FRAMEWORKS } from "@/lib/searchTaxonomy";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

function useDebounced<T>(v: T, ms = 250): T {
  const [s, setS] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setS(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return s;
}

// Curated, business-friendly procurement phrases. These complement the
// taxonomy keywords and CPV category labels — never full tender titles.
const COMMON_PROCUREMENT_PHRASES: string[] = [
  "Agency Staff",
  "Asbestos Removal",
  "Audio Visual Equipment",
  "Bus Services",
  "Care Home Services",
  "Catering Equipment",
  "Childrens Services",
  "Civil Engineering",
  "Cloud Services",
  "Community Transport",
  "Contact Centre Services",
  "Corporate Travel",
  "Domiciliary Care",
  "Electrical Works",
  "Energy Supply",
  "Engineering Consultancy",
  "Environmental Services",
  "Equality and Diversity Training",
  "Event Management",
  "Fire Safety Services",
  "Fleet Management",
  "Furniture Supply",
  "Gas Maintenance",
  "Grounds Maintenance",
  "Highways Maintenance",
  "Home Care Services",
  "Hospital Cleaning",
  "Housing Repairs",
  "HR Services",
  "ICT Hardware",
  "Independent Living",
  "Interpretation Services",
  "Janitorial Supplies",
  "Laboratory Services",
  "Landscaping Services",
  "Laundry Services",
  "Legal Services",
  "Lift Maintenance",
  "Managed Print Services",
  "Marketing and Communications",
  "Medical Equipment",
  "Network Services",
  "Occupational Health",
  "Office Supplies",
  "Patient Transport",
  "Payroll Services",
  "Personal Protective Equipment",
  "Pharmaceutical Supply",
  "Project Management",
  "Property Maintenance",
  "Refuse Collection",
  "Repairs and Maintenance",
  "Residential Care",
  "Roofing Works",
  "School Meals",
  "School Transport",
  "Security Services",
  "Social Care",
  "Staff Training",
  "Street Lighting",
  "Supported Living",
  "Taxi Services",
  "Telecommunications",
  "Temporary Accommodation",
  "Translation Services",
  "Waste Management",
  "Window Cleaning",
  "Workforce Management",
];

// UK procurement abbreviations and entities. Mirrors the domain hints used by
// the Hybrid Semantic Search classifier so autocomplete stays consistent with
// what the search engine already understands.
const PROCUREMENT_ENTITIES: string[] = [
  // NHS family
  "NHS",
  "NHS England",
  "NHS Scotland",
  "NHS Wales",
  "NHS Supply Chain",
  "NHS SBS",
  "NHS Shared Business Services",
  "NHS Trusts",
  "NHS Foundation Trust",
  // Central government
  "Crown Commercial Service",
  "CCS",
  "HMRC",
  "MoD",
  "Ministry of Defence",
  "DfE",
  "Department for Education",
  "DWP",
  "Department for Work and Pensions",
  "DHSC",
  "DVSA",
  "DVLA",
  "Home Office",
  "Cabinet Office",
  "Ministry of Justice",
  "MoJ",
  "Foreign Commonwealth and Development Office",
  "FCDO",
  // Local government
  "County Council",
  "Borough Council",
  "City Council",
  "District Council",
  "Metropolitan Council",
  "Combined Authority",
  "Greater London Authority",
  "Transport for London",
  "TfL",
  // Buying organisations
  "YPO",
  "ESPO",
  "NEPO",
  "CPC",
  "Procurement for Housing",
  "PfH",
  // Frameworks
  "G-Cloud 14",
  "G-Cloud 13",
  "Digital Outcomes",
  "DOS 6",
  "RM6281",
  "RM6263",
  "RM6187",
  "RM6100",
  "RM1043",
  "Dynamic Purchasing System",
  "DPS",
];

// Dedup + merge static sources once on module load.
const STATIC_TERMS: string[] = Array.from(
  new Set<string>([
    ...PROCUREMENT_ENTITIES,
    ...POPULAR_FRAMEWORKS.map((f) => f.label),
    ...KEYWORD_SUGGESTIONS,
    ...COMMON_PROCUREMENT_PHRASES,
    ...SERVICE_CATEGORIES.map((c) => c.label),
  ]),
).sort((a, b) => a.localeCompare(b));

/**
 * Smart autocomplete for the main contract search box.
 * Suggests business-friendly procurement search terms (services, categories,
 * common phrases, CPV descriptions, UK procurement entities, buyers, and
 * frameworks) — never full tender titles. Pure UI — never triggers the search.
 */
export function SearchAutocomplete({ value, onChange, placeholder, className }: Props) {
  const debounced = useDebounced(value, 250);
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) { setItems([]); setLoading(false); return; }
    const needle = q.toLowerCase();

    // 1) Local static matches first — instant, business-friendly phrases and
    //    UK procurement entities/abbreviations.
    const local: string[] = [];
    const seen = new Set<string>();
    const pushIfNew = (s: string) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      local.push(s);
    };
    // Prefer prefix matches, then substring matches.
    for (const t of STATIC_TERMS) if (t.toLowerCase().startsWith(needle)) pushIfNew(t);
    for (const t of STATIC_TERMS) if (!t.toLowerCase().startsWith(needle) && t.toLowerCase().includes(needle)) pushIfNew(t);

    // Show static hits immediately, then top up from live data below.
    setItems(local.slice(0, 8));
    setLoading(true);

    let cancelled = false;
    (async () => {
      // 2) Live buyers (contracting authorities) — most useful for entity
      //    queries like "nhs", "manchester", "hmrc".
      const [buyersRes, frameworksRes, cpvRes] = await Promise.all([
        supabase.from("buyers").select("name").ilike("name", `%${q}%`).order("name").limit(6),
        supabase.from("frameworks").select("name, reference_number").or(`name.ilike.%${q}%,reference_number.ilike.%${q}%`).limit(6),
        // Only query CPV labels when local pool still has room — cheaper.
        local.length < 8
          ? supabase.from("cpv_codes").select("label").ilike("label", `%${q}%`).not("label", "is", null).order("label").limit(10)
          : Promise.resolve({ data: [] as { label: string | null }[] }),
      ]);
      if (cancelled) return;

      for (const r of (buyersRes.data || []) as { name: string | null }[]) {
        const t = (r.name || "").trim();
        if (t) pushIfNew(t);
      }
      for (const r of (frameworksRes.data || []) as { name: string | null; reference_number: string | null }[]) {
        if (r.reference_number) pushIfNew(r.reference_number.trim());
        if (r.name) pushIfNew(r.name.trim());
      }
      for (const r of ((cpvRes as any).data || []) as { label: string | null }[]) {
        const t = (r.label || "").trim();
        if (t) pushIfNew(t);
      }

      setItems(local.slice(0, 8));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [debounced]);

  useEffect(() => { setFocusIdx(-1); }, [items.length, debounced]);

  const showDropdown = open && value.trim().length >= 2;
  const showEmpty = showDropdown && !loading && items.length === 0;

  const apply = (s: string) => {
    onChange(s);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (!showDropdown || items.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusIdx((i) => (i + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusIdx((i) => (i <= 0 ? items.length - 1 : i - 1));
          } else if (e.key === "Enter" && focusIdx >= 0) {
            e.preventDefault();
            apply(items[focusIdx]);
          }
        }}
        className="pl-9 bg-secondary border-border"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
      />
      {showDropdown && (items.length > 0 || showEmpty) && (
        <div
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 rounded-md border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden"
        >
          {showEmpty ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No suggestions found. Press Enter to search anyway.
            </div>
          ) : (
            items.map((s, i) => (
              <button
                key={`${i}-${s}`}
                type="button"
                role="option"
                aria-selected={i === focusIdx}
                onMouseDown={(e) => { e.preventDefault(); apply(s); }}
                onMouseEnter={() => setFocusIdx(i)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm truncate block",
                  i === focusIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                {s}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
