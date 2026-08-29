export type ContractStatus = "live" | "closing" | "awarded" | "expired";
export type BidStage = "identified" | "qualifying" | "preparing" | "submitted" | "won" | "lost";

export interface Contract {
  id: string;
  title: string;
  buyer: string;
  value: number;
  status: ContractStatus;
  deadline: string;
  publishedDate: string;
  cpvCode: string;
  sector: string;
  region: string;
  source: string;
}

export interface BidOpportunity {
  id: string;
  contractId: string;
  title: string;
  buyer: string;
  value: number;
  stage: BidStage;
  deadline: string;
  winProbability: number;
  notes: string;
  assignedTo: string;
}

export interface Supplier {
  id: string;
  name: string;
  contractsWon: number;
  totalValue: number;
  sectors: string[];
  region: string;
}

export const contracts: Contract[] = [
  { id: "CF-2024-001", title: "NHS Digital Transformation Programme", buyer: "NHS England", value: 12500000, status: "live", deadline: "2024-04-15", publishedDate: "2024-03-01", cpvCode: "72000000", sector: "IT Services", region: "National", source: "Contracts Finder" },
  { id: "CF-2024-002", title: "Highways Maintenance Framework - South East", buyer: "National Highways", value: 45000000, status: "live", deadline: "2024-04-20", publishedDate: "2024-02-28", cpvCode: "45233000", sector: "Construction", region: "South East", source: "FTS" },
  { id: "CF-2024-003", title: "Social Care Case Management System", buyer: "Birmingham City Council", value: 3200000, status: "closing", deadline: "2024-03-28", publishedDate: "2024-02-15", cpvCode: "72212000", sector: "IT Services", region: "West Midlands", source: "Contracts Finder" },
  { id: "CF-2024-004", title: "Fleet Vehicle Procurement", buyer: "Metropolitan Police", value: 8700000, status: "awarded", deadline: "2024-02-28", publishedDate: "2024-01-10", cpvCode: "34100000", sector: "Vehicles", region: "London", source: "FTS" },
  { id: "CF-2024-005", title: "School Meals Catering Services", buyer: "Leeds City Council", value: 5600000, status: "live", deadline: "2024-05-01", publishedDate: "2024-03-05", cpvCode: "55524000", sector: "Catering", region: "Yorkshire", source: "Contracts Finder" },
  { id: "CF-2024-006", title: "Cloud Hosting & Managed Services", buyer: "HMRC", value: 22000000, status: "live", deadline: "2024-04-30", publishedDate: "2024-03-10", cpvCode: "72310000", sector: "IT Services", region: "National", source: "FTS" },
  { id: "CF-2024-007", title: "Waste Collection & Recycling Services", buyer: "Manchester City Council", value: 15800000, status: "closing", deadline: "2024-03-25", publishedDate: "2024-01-20", cpvCode: "90500000", sector: "Environmental", region: "North West", source: "Contracts Finder" },
  { id: "CF-2024-008", title: "GP Surgery Refurbishment Programme", buyer: "NHS Property Services", value: 4100000, status: "awarded", deadline: "2024-03-01", publishedDate: "2024-01-05", cpvCode: "45215000", sector: "Construction", region: "National", source: "FTS" },
  { id: "CF-2024-009", title: "Cyber Security Assessment Framework", buyer: "Cabinet Office", value: 9500000, status: "live", deadline: "2024-05-15", publishedDate: "2024-03-12", cpvCode: "72000000", sector: "IT Services", region: "National", source: "Contracts Finder" },
  { id: "CF-2024-010", title: "Public Transport Ticketing System", buyer: "Transport for London", value: 18000000, status: "live", deadline: "2024-06-01", publishedDate: "2024-03-15", cpvCode: "48000000", sector: "IT Services", region: "London", source: "FTS" },
];

export const bidPipeline: BidOpportunity[] = [
  { id: "BID-001", contractId: "CF-2024-001", title: "NHS Digital Transformation Programme", buyer: "NHS England", value: 12500000, stage: "preparing", deadline: "2024-04-15", winProbability: 65, notes: "Strong track record with NHS. Need to finalise technical approach.", assignedTo: "Sarah Mitchell" },
  { id: "BID-002", contractId: "CF-2024-006", title: "Cloud Hosting & Managed Services", buyer: "HMRC", value: 22000000, stage: "qualifying", deadline: "2024-04-30", winProbability: 40, notes: "New relationship. Preparing PQQ response.", assignedTo: "James Walker" },
  { id: "BID-003", contractId: "CF-2024-009", title: "Cyber Security Assessment Framework", buyer: "Cabinet Office", value: 9500000, stage: "identified", deadline: "2024-05-15", winProbability: 55, notes: "Good fit for our capabilities. Monitoring for PQQ release.", assignedTo: "Emma Chen" },
  { id: "BID-004", contractId: "CF-2024-010", title: "Public Transport Ticketing System", buyer: "Transport for London", value: 18000000, stage: "preparing", deadline: "2024-06-01", winProbability: 30, notes: "Competitive field. Partnering with Accenture for delivery.", assignedTo: "Sarah Mitchell" },
  { id: "BID-005", contractId: "CF-2024-004", title: "Fleet Vehicle Procurement", buyer: "Metropolitan Police", value: 8700000, stage: "won", deadline: "2024-02-28", winProbability: 100, notes: "Contract awarded. Mobilisation phase.", assignedTo: "James Walker" },
  { id: "BID-006", contractId: "CF-2024-008", title: "GP Surgery Refurbishment Programme", buyer: "NHS Property Services", value: 4100000, stage: "lost", deadline: "2024-03-01", winProbability: 0, notes: "Lost on price. Debrief scheduled.", assignedTo: "Emma Chen" },
  { id: "BID-007", contractId: "CF-2024-005", title: "School Meals Catering Services", buyer: "Leeds City Council", value: 5600000, stage: "submitted", deadline: "2024-05-01", winProbability: 72, notes: "Strong submission. Awaiting evaluation outcome.", assignedTo: "James Walker" },
];

export const spendBySector = [
  { sector: "IT Services", value: 72000, count: 1240 },
  { sector: "Construction", value: 58000, count: 890 },
  { sector: "Healthcare", value: 45000, count: 650 },
  { sector: "Environmental", value: 23000, count: 420 },
  { sector: "Catering", value: 12000, count: 310 },
  { sector: "Transport", value: 34000, count: 560 },
];

export const monthlyTrends = [
  { month: "Oct", contracts: 1240, value: 3200 },
  { month: "Nov", contracts: 1380, value: 3800 },
  { month: "Dec", contracts: 980, value: 2100 },
  { month: "Jan", contracts: 1520, value: 4100 },
  { month: "Feb", contracts: 1680, value: 4500 },
  { month: "Mar", contracts: 1890, value: 5200 },
];

export const regions = ["National", "London", "South East", "South West", "East", "West Midlands", "East Midlands", "North West", "North East", "Yorkshire", "Scotland", "Wales"];
export const sectors = ["IT Services", "Construction", "Healthcare", "Environmental", "Catering", "Transport", "Vehicles", "Professional Services"];
export const sources = ["Contracts Finder", "FTS", "PCS", "Sell2Wales"];

export function formatCurrency(value: number): string {
  if (value >= 1000000) return `£${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `£${(value / 1000).toFixed(0)}K`;
  return `£${value}`;
}
