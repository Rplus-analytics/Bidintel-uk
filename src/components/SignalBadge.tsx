import { Sparkles } from "lucide-react";

interface Props {
  score: 0 | 1 | 2 | 3;
  reasons?: string[];
}

const STYLES: Record<number, string> = {
  0: "bg-muted text-muted-foreground",
  1: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  2: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  3: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

export function SignalBadge({ score, reasons }: Props) {
  const title = reasons && reasons.length ? reasons.join(" · ") : "No profile match";
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STYLES[score]}`}
    >
      <Sparkles className="h-3 w-3" />
      BidIntel {score}/3
    </span>
  );
}
