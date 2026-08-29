import { useMemo, useState } from "react";
import { FRAMEWORKS, type Framework } from "@/data/frameworks";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar, ExternalLink, Building2, FileBadge, Layers, Package, Users, ChevronDown, Search } from "lucide-react";
import frameworkLots from "@/data/frameworkLots.json";
import frameworkSuppliers from "@/data/frameworkSuppliers.json";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type Lot = { title: string; expires: string | null; description?: string };
const LOTS: Record<string, Lot[]> = frameworkLots as Record<string, Lot[]>;
type SupplierData = { total: number; suppliers: string[] };
const SUPPLIERS: Record<string, SupplierData> = frameworkSuppliers as Record<string, SupplierData>;

function getSupplierPortalUrl(f: { owner: string; url: string; id: string }): string {
  const o = f.owner.toLowerCase();
  if (o.includes("gca") || o.includes("ccs")) return "https://supplierregistration.cabinetoffice.gov.uk/dps";
  return f.url;
}

export default function Frameworks() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [owner, setOwner] = useState<string>("all");
  const [selected, setSelected] = useState<Framework | null>(null);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [suppliersOpen, setSuppliersOpen] = useState(false);

  const categories = useMemo(() => {
    const set = new Set(FRAMEWORKS.map((f) => f.category));
    return ["all", ...Array.from(set).sort()];
  }, []);
  const owners = useMemo(() => {
    const set = new Set(FRAMEWORKS.map((f) => f.owner));
    return ["all", ...Array.from(set).sort()];
  }, []);

  const filtered = useMemo(() => {
    return FRAMEWORKS.filter((f) => category === "all" || f.category === category)
      .filter((f) => owner === "all" || f.owner === owner)
      .filter((f) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          f.name.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q) ||
          f.owner.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query, category, owner]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">UK Public Sector Frameworks</h1>
        <p className="text-muted-foreground mt-2">
          {FRAMEWORKS.length} live procurement frameworks and dynamic markets across central government, NHS, local
          authorities, housing and devolved administrations. Sources include the{" "}
          <a
            href="https://www.gca.gov.uk/agreements"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Government Commercial Agency
          </a>{" "}
          (formerly CCS), NHS SBS, NHS Commercial Solutions, HealthTrust Europe, YPO, ESPO, KCS, NEPO, LHC, PfH, NHS LPP
          and Scottish Procurement.
        </p>
      </header>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Input
          placeholder="Search by name, ID, owner, category or keyword..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c === "all" ? "All categories" : c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Owner" /></SelectTrigger>
          <SelectContent>
            {owners.map((o) => (
              <SelectItem key={o} value={o}>{o === "all" ? "All owners" : o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground mb-3">{filtered.length} frameworks</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((f) => (
          <Card
            key={f.url + f.id}
            onClick={() => setSelected(f)}
            className="p-5 flex flex-col gap-3 hover:border-primary/50 transition-colors cursor-pointer"
          >
            <div>
              <h3 className="font-semibold text-foreground leading-tight hover:text-primary transition-colors">
                {f.name}
              </h3>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge variant="secondary" className="text-xs">
                  <Layers className="h-3 w-3 mr-1" />
                  {f.category}
                </Badge>
                {f.id && (
                  <Badge variant="outline" className="text-xs">
                    <FileBadge className="h-3 w-3 mr-1" />
                    {f.id}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="line-clamp-1">{f.owner}</span>
              </div>
              {f.endDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 shrink-0" />
                  <span>Expires {f.endDate}</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-3">{f.description}</p>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-muted-foreground text-sm mt-4">No frameworks match.</p>}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl">{selected.name}</DialogTitle>
                <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-4 w-4" /> {selected.owner}
                  </span>
                  {selected.id && (
                    <span className="inline-flex items-center gap-1.5">
                      <FileBadge className="h-4 w-4" /> {selected.id}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <Layers className="h-4 w-4" /> {selected.category}
                  </span>
                </DialogDescription>
              </DialogHeader>

              <div>
                <h4 className="text-sm font-semibold text-foreground mb-1.5">About this framework</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{selected.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {selected.startDate && (
                  <div>
                    <div className="text-xs text-muted-foreground">Start date</div>
                    <div className="text-foreground">{selected.startDate}</div>
                  </div>
                )}
                {selected.endDate && (
                  <div>
                    <div className="text-xs text-muted-foreground">End date</div>
                    <div className="text-foreground">{selected.endDate}</div>
                  </div>
                )}
                {selected.regulation && (
                  <div>
                    <div className="text-xs text-muted-foreground">Regulation</div>
                    <div className="text-foreground">{selected.regulation}</div>
                  </div>
                )}
              </div>

              {(() => {
                const lots = LOTS[selected.id] || [];
                return (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <Package className="h-4 w-4" /> Products & Lots {lots.length > 0 && <span className="text-xs text-muted-foreground font-normal">({lots.length})</span>}
                    </h4>
                    {lots.length > 0 ? (
                      <ul className="space-y-2">
                        {lots.map((lot, i) => (
                          <li key={i} className="border border-border rounded-md p-3">
                            <div className="text-sm font-medium text-foreground">{lot.title}</div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                              {lot.expires && <span>Expires {lot.expires}</span>}
                              {lot.description && <span>{lot.description}</span>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">Lot breakdown not available — see the framework page for details.</p>
                    )}
                  </div>
                );
              })()}

              {(() => {
                const data = SUPPLIERS[selected.id];
                const all = data?.suppliers || [];
                const total = data?.total ?? all.length;
                const q = supplierQuery.trim().toLowerCase();
                const filteredSuppliers = q ? all.filter((s) => s.toLowerCase().includes(q)) : all;
                return (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <Users className="h-4 w-4" /> Appointed Suppliers {total > 0 && <span className="text-xs text-muted-foreground font-normal">({total})</span>}
                    </h4>
                    {all.length > 0 ? (
                      <Collapsible open={suppliersOpen} onOpenChange={setSuppliersOpen}>
                        <CollapsibleTrigger className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                          {suppliersOpen ? "Hide" : "Show"} supplier list
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${suppliersOpen ? "rotate-180" : ""}`} />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-3">
                          <div className="relative mb-2">
                            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              value={supplierQuery}
                              onChange={(e) => setSupplierQuery(e.target.value)}
                              placeholder="Filter suppliers..."
                              className="pl-8 h-9 text-sm"
                            />
                          </div>
                          <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border">
                            {filteredSuppliers.map((s, i) => (
                              <div key={i} className="px-3 py-1.5 text-sm text-foreground">{s}</div>
                            ))}
                            {filteredSuppliers.length === 0 && (
                              <div className="px-3 py-2 text-sm text-muted-foreground">No matching suppliers.</div>
                            )}
                          </div>
                          {all.length < total && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Showing {all.length} of {total} suppliers — view full list on the official portal.
                            </p>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      <p className="text-sm text-muted-foreground mb-2">
                        Supplier list not yet captured — view on the official portal (buyer registration required).
                      </p>
                    )}
                    <a
                      href={getSupplierPortalUrl(selected)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-2"
                    >
                      View on official portal <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                );
              })()}

              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Visit framework page <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
