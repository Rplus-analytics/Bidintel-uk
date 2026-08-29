import { MoreVertical, Mail, Search, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface SavedSearchCardProps {
  name: string;
  description?: string;
  chips: string[];
  digestActive: boolean;
  digestPending?: boolean;
  onViewMatching: () => void;
  onFindNew: () => void;
  onToggleDigest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MAX_CHIPS = 5;

export function SavedSearchCard({
  name,
  description,
  chips,
  digestActive,
  digestPending,
  onViewMatching,
  onFindNew,
  onToggleDigest,
  onEdit,
  onDelete,
}: SavedSearchCardProps) {
  const visible = chips.slice(0, MAX_CHIPS);
  const overflow = Math.max(0, chips.length - MAX_CHIPS);

  return (
    <div className="glass-card p-5 flex flex-col gap-4 h-full cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-base leading-snug line-clamp-2 flex-1">
          {name}
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 -mr-1 -mt-1 shrink-0"
              aria-label="Saved search actions"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onEdit} className="gap-2">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
        {description || "Monitoring public sector tenders matching your saved search."}
      </p>

      {/* Criteria chips */}
      <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
        {visible.length === 0 ? (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">All Tenders</Badge>
        ) : (
          visible.map((c, i) => (
            <Badge key={i} variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
              {c}
            </Badge>
          ))
        )}
        {overflow > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{overflow} more</Badge>
        )}
      </div>

      <div className="flex-1" />

      {/* Divider */}
      <div className="border-t border-border/60 pt-4 mt-1">
        {/* Primary CTA */}
        <Button className="w-full gap-1.5" onClick={onViewMatching}>
          <Search className="h-3.5 w-3.5" /> View Matching Tenders
        </Button>

        {/* Bottom row */}
        <div className="flex items-center justify-between gap-2 pt-4">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <Switch
              checked={digestActive}
              onCheckedChange={onToggleDigest}
              disabled={digestPending}
              aria-label="Toggle daily digest"
            />
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">Daily Digest</span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8 px-2 text-primary hover:text-primary gap-1"
            onClick={onFindNew}
          >
            <Search className="h-3.5 w-3.5" /> Find New Tenders
          </Button>
        </div>
      </div>
    </div>
  );
}
