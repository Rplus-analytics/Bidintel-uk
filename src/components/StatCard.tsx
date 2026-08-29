import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  delay?: number;
}

export default function StatCard({ label, value, change, changeType = "neutral", icon: Icon, delay = 0 }: StatCardProps) {
  return (
    <div className="glass-card p-5 opacity-0 animate-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-label">{label}</p>
          <p className="stat-value mt-1">{value}</p>
          {change && (
            <p className={`text-xs mt-1 font-medium ${changeType === "positive" ? "text-success" : changeType === "negative" ? "text-destructive" : "text-muted-foreground"}`}>
              {change}
            </p>
          )}
        </div>
        <div className="p-2.5 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </div>
  );
}
