// Curated procurement taxonomy used by the search filter UI.
// CPV prefixes are stored internally; users see plain-English categories.

export interface ServiceCategory {
  id: string;
  label: string;
  cpvPrefix: string; // primary CPV prefix used as filter value
  keywords?: string[]; // optional extra terms for AI suggestion matching
}

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  { id: "cyber", label: "Cyber Security Services", cpvPrefix: "7222", keywords: ["cyber", "security", "infosec", "soc"] },
  { id: "software", label: "Software Development", cpvPrefix: "7223", keywords: ["software", "development", "application", "bespoke"] },
  { id: "it-services", label: "IT Services & Hardware", cpvPrefix: "72", keywords: ["it", "technology", "digital"] },
  { id: "cleaning", label: "Cleaning Services", cpvPrefix: "9091", keywords: ["cleaning", "janitorial"] },
  { id: "fm", label: "Facilities Management", cpvPrefix: "7099", keywords: ["facilities", "fm", "estate"] },
  { id: "recruitment", label: "Recruitment Services", cpvPrefix: "7950", keywords: ["recruitment", "staffing", "agency"] },
  { id: "catering", label: "Catering Services", cpvPrefix: "5552", keywords: ["catering", "food", "meals"] },
  { id: "training", label: "Training Services", cpvPrefix: "80", keywords: ["training", "learning", "education"] },
  { id: "consultancy", label: "Consultancy", cpvPrefix: "7900", keywords: ["consultancy", "advisory"] },
  { id: "construction", label: "Construction Works", cpvPrefix: "45", keywords: ["construction", "building", "works"] },
  { id: "healthcare", label: "Healthcare Services", cpvPrefix: "85", keywords: ["health", "clinical", "medical"] },
  { id: "transport", label: "Transport Services", cpvPrefix: "60", keywords: ["transport", "logistics", "fleet"] },
];

export const POPULAR_CATEGORIES: string[] = [
  "catering",
  "cyber",
  "cleaning",
  "fm",
  "software",
  "recruitment",
  "training",
];

export interface PopularFramework {
  id: string;
  label: string;
  keyword: string; // used to populate framework filter
}

export const POPULAR_FRAMEWORKS: PopularFramework[] = [
  { id: "ccs", label: "CCS", keyword: "CCS" },
  { id: "gcloud14", label: "G-Cloud 14", keyword: "G-Cloud 14" },
  { id: "dos", label: "DOS", keyword: "Digital Outcomes" },
  { id: "rm6281", label: "RM6281", keyword: "RM6281" },
  { id: "nhssbs", label: "NHS SBS", keyword: "NHS SBS" },
  { id: "ypo", label: "YPO", keyword: "YPO" },
];

export interface DatePreset {
  id: string;
  label: string;
  from: () => string; // YYYY-MM-DD
}

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export const DATE_PRESETS: DatePreset[] = [
  { id: "7d", label: "Past 7 days", from: () => isoDaysAgo(7) },
  { id: "30d", label: "Past 30 days", from: () => isoDaysAgo(30) },
  { id: "90d", label: "Past 90 days", from: () => isoDaysAgo(90) },
  {
    id: "ytd",
    label: "This year",
    from: () => `${new Date().getFullYear()}-01-01`,
  },
];

// Config-driven default preset applied when users open a search surface with
// no explicit criteria. Change this ID to adjust the default across the app.
export const DEFAULT_DATE_PRESET_ID = "30d";

export function getDefaultDatePreset(): DatePreset {
  return DATE_PRESETS.find((p) => p.id === DEFAULT_DATE_PRESET_ID) ?? DATE_PRESETS[1];
}

export function getDefaultPublishedFrom(): string {
  return getDefaultDatePreset().from();
}

export interface ValueBand {
  id: string;
  label: string;
  min: string; // store as string to match filter shape
  max: string;
}

export const VALUE_BANDS: ValueBand[] = [
  { id: "u50", label: "Under £50k", min: "", max: "50000" },
  { id: "50-250", label: "£50k–£250k", min: "50000", max: "250000" },
  { id: "250-1m", label: "£250k–£1M", min: "250000", max: "1000000" },
  { id: "1-5m", label: "£1M–£5M", min: "1000000", max: "5000000" },
  { id: "5m+", label: "£5M+", min: "5000000", max: "" },
];

// Static keyword suggestions — common procurement terms used for typeahead.
export const KEYWORD_SUGGESTIONS: string[] = [
  "Data Analytics",
  "Data Services",
  "Database Services",
  "Digital Transformation",
  "Digital Skills",
  "Cyber Security",
  "Cloud Hosting",
  "Cloud Migration",
  "Software Development",
  "Software as a Service",
  "Application Support",
  "Web Development",
  "Mobile Application",
  "Artificial Intelligence",
  "Machine Learning",
  "Catering Services",
  "School Catering",
  "Hospital Cleaning",
  "Office Cleaning",
  "Facilities Management",
  "Building Maintenance",
  "Estate Management",
  "Recruitment Services",
  "Temporary Staffing",
  "Executive Search",
  "Training Services",
  "Apprenticeship",
  "Leadership Development",
  "Consultancy Services",
  "Management Consultancy",
  "Healthcare Services",
  "Mental Health Services",
  "Domiciliary Care",
  "Transport Services",
  "Fleet Management",
  "Vehicle Hire",
  "Construction Works",
  "Refurbishment",
  "Demolition",
  "Highways Maintenance",
  "Grounds Maintenance",
  "Security Services",
  "Manned Guarding",
  "Legal Services",
  "Audit Services",
  "Insurance Services",
  "Marketing Services",
  "Translation Services",
  "Print Services",
];

export function filterKeywordSuggestions(q: string, limit = 8): string[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return KEYWORD_SUGGESTIONS.filter((k) => k.toLowerCase().includes(needle)).slice(0, limit);
}

export function findCategoryByCpv(cpv: string | null | undefined): ServiceCategory | null {
  if (!cpv) return null;
  // Prefer longest matching prefix
  const matches = SERVICE_CATEGORIES.filter((c) => cpv.startsWith(c.cpvPrefix));
  if (!matches.length) return null;
  return matches.sort((a, b) => b.cpvPrefix.length - a.cpvPrefix.length)[0];
}
