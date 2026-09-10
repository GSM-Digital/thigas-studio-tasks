export type AppRole = "developer" | "agency";
export type TaskStatus = "open" | "in_progress" | "completed" | "approved";
export type ClassificationStatus = "pending" | "classified" | "failed" | "manual";

export interface ClientSummary {
  id: string;
  name: string;
  color: string;
}

export interface TaskView {
  id: string;
  title: string;
  description?: string | null;
  clientId: string;
  clientName: string;
  clientColor: string;
  status: TaskStatus;
  complexityLevel: 1 | 2 | 3 | 4;
  basePoints: number;
  efficiencyAdjustment: number;
  points: number;
  estimatedDurationSeconds: number;
  dueAt: string | null;
  completedAt: string | null;
  activeTimerStartedAt: string | null;
  trackedSeconds: number;
  manualDurationSeconds: number | null;
  classificationStatus: ClassificationStatus;
}

export interface Viewer {
  id: string;
  name: string;
  role: AppRole;
  agencyId: string;
}

export interface WorkspaceSettings {
  agencyName: string;
  currencyCode: "BRL";
  pointValueCents: number;
}

export interface TaskClassification {
  complexityLevel: 1 | 2 | 3 | 4;
  basePoints: number;
  efficiencyAdjustment: number;
  finalPoints: number;
  rationale: string;
  model: string;
}

export interface BillingReportTask {
  id: string;
  title: string;
  completedAt: string;
  points: number;
  amountCents: number;
  durationSeconds: number;
}

export interface BillingReportClient {
  clientId: string;
  clientName: string;
  tasks: BillingReportTask[];
  totalPoints: number;
  totalAmountCents: number;
  totalDurationSeconds: number;
}

export interface BillingReport {
  periodStart: string;
  periodEnd: string;
  currencyCode: "BRL";
  pointValueCents: number;
  clients: BillingReportClient[];
  totalPoints: number;
  totalAmountCents: number;
  totalDurationSeconds: number;
}
