import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMatchProfile } from "@/hooks/useMatchProfile";

const splitLines = (s: string) =>
  s
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export default function Settings() {
  const { membership, isAdmin } = useAuth();
  const { data: profile, isLoading } = useMatchProfile();
  const qc = useQueryClient();

  const [keywords, setKeywords] = useState("");
  const [sectors, setSectors] = useState("");
  const [regions, setRegions] = useState("");
  const [cpv, setCpv] = useState("");
  const [minVal, setMinVal] = useState<string>("");
  const [maxVal, setMaxVal] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setKeywords(profile.keywords.join(", "));
      setSectors(profile.sectors.join(", "));
      setRegions(profile.regions.join(", "));
      setCpv(profile.cpv_prefixes.join(", "));
      setMinVal(profile.min_value?.toString() ?? "");
      setMaxVal(profile.max_value?.toString() ?? "");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!membership?.organisation_id) return;
    setSaving(true);
    const payload = {
      organisation_id: membership.organisation_id,
      keywords: splitLines(keywords),
      sectors: splitLines(sectors),
      regions: splitLines(regions),
      cpv_prefixes: splitLines(cpv),
      min_value: minVal ? Number(minVal) : null,
      max_value: maxVal ? Number(maxVal) : null,
    };
    const { error } = await supabase
      .from("org_match_profiles")
      .upsert(payload, { onConflict: "organisation_id" });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile saved", description: "BidIntel Score will update." });
      qc.invalidateQueries({ queryKey: ["org-match-profile"] });
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-1">
          Configure your organisation's tender matching profile.
        </p>
      </div>

      <div className="glass-card p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">BidIntel Score profile</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Notices are scored 0–3 based on how well they match the criteria below.
          Comma or newline separated. {!isAdmin && "(Admin-only edit)"}
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <fieldset disabled={!isAdmin || saving} className="space-y-4">
            <div>
              <Label htmlFor="kw">Keywords</Label>
              <Textarea
                id="kw"
                rows={2}
                placeholder="e.g. cloud hosting, cyber security, data migration"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sectors">Sectors</Label>
              <Input
                id="sectors"
                placeholder="e.g. IT services, Healthcare"
                value={sectors}
                onChange={(e) => setSectors(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="regions">Regions</Label>
              <Input
                id="regions"
                placeholder="e.g. London, Scotland, North West"
                value={regions}
                onChange={(e) => setRegions(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cpv">CPV code prefixes</Label>
              <Input
                id="cpv"
                placeholder="e.g. 72, 48000000"
                value={cpv}
                onChange={(e) => setCpv(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="min">Min value (£)</Label>
                <Input
                  id="min"
                  type="number"
                  placeholder="0"
                  value={minVal}
                  onChange={(e) => setMinVal(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="max">Max value (£)</Label>
                <Input
                  id="max"
                  type="number"
                  placeholder="No limit"
                  value={maxVal}
                  onChange={(e) => setMaxVal(e.target.value)}
                />
              </div>
            </div>

            {isAdmin && (
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save profile
              </Button>
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
}
