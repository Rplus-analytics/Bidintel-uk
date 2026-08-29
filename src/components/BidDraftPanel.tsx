import { useState } from "react";
import { Loader2, Sparkles, Copy, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateBidStatus, type SavedBid } from "@/hooks/useSavedBids";
import { toast } from "sonner";

interface Props {
  bid: SavedBid | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BidDraftPanel({ bid, open, onOpenChange }: Props) {
  const [companyInfo, setCompanyInfo] = useState("");
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const updateStatus = useUpdateBidStatus();

  const generate = async () => {
    if (!bid) return;
    setGenerating(true);
    setDraft("");
    try {
      const { data, error } = await supabase.functions.invoke("draft-bid-response", {
        body: { bidId: bid.id, companyInfo, instructions },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setDraft((data as any).draft || "");
      setHistoryCount((data as any).historyCount ?? null);
      toast.success("Draft generated");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate draft");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(draft);
    toast.success("Copied to clipboard");
  };

  const saveToNotes = () => {
    if (!bid || !draft) return;
    updateStatus.mutate(
      { id: bid.id, notes: draft },
      { onSuccess: () => toast.success("Saved to bid notes") },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Draft Response
          </SheetTitle>
          <SheetDescription className="line-clamp-2">{bid?.title}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div>
            <Label htmlFor="company-info" className="text-xs">Company info / capabilities</Label>
            <Textarea
              id="company-info"
              placeholder="Brief: company name, sectors, certifications (ISO, Cyber Essentials), team size, USPs, notable clients…"
              value={companyInfo}
              onChange={(e) => setCompanyInfo(e.target.value)}
              className="min-h-[100px] mt-1"
            />
          </div>
          <div>
            <Label htmlFor="instructions" className="text-xs">Specific instructions (optional)</Label>
            <Textarea
              id="instructions"
              placeholder="e.g. Emphasise sustainability, target a 12-week delivery, focus on social value…"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[60px] mt-1"
            />
          </div>

          <Button onClick={generate} disabled={generating || !bid} className="w-full">
            {generating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Drafting from your bid history…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Generate Draft</>
            )}
          </Button>

          {historyCount !== null && !generating && (
            <p className="text-xs text-muted-foreground">
              Trained on {historyCount} past bid{historyCount === 1 ? "" : "s"} from your organisation.
            </p>
          )}

          {draft && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copy}><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy</Button>
                <Button variant="outline" size="sm" onClick={saveToNotes}><Save className="h-3.5 w-3.5 mr-1.5" /> Save to bid notes</Button>
              </div>
              <div className="glass-card p-4 prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{draft}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
