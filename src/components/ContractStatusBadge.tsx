import { type ContractStatus } from "@/data/mockData";

const statusConfig: Record<ContractStatus, string> = {
  live: "badge-live",
  closing: "badge-closing",
  awarded: "badge-awarded",
  expired: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground",
};

export default function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <span className={statusConfig[status]}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}
