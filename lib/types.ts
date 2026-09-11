import type { AiErrorDiagnostic } from "@/lib/ai/error-diagnostics";

export type AppRole = "developer" | "agency";
export type TaskStatus = "open" | "in_progress" | "completed" | "approved";
export type ClassificationStatus = "pending" | "classified" | "failed" | "manual";
export type TaskSuggestionCategory = "essential" | "recommended" | "value" | "follow_up";
export type TaskSuggestionStatus = "pending" | "completed" | "not_applicable";
export type TaskSuggestionVerification = "pending" | "verified" | "rejected" | "not_applicable";

export interface TaskSuggestion {
  id: string;
  taskId: string;
  position: number;
  title: string;
  description: string;
  category: TaskSuggestionCategory;
  rewardPercentage: number;
  omissionPenaltyPercentage: number;
  evidenceRequired: boolean;
  tools: string[];
  status: TaskSuggestionStatus;
  evidence: string | null;
  verificationStatus: TaskSuggestionVerification;
  verificationRationale: string | null;
}

export interface ClientSummary {
  id: string;
  name: string;
  color: string;
}

export interface TaskView {
  id: string;
  title: string;
  description?: string | null;
  completionSummary: string | null;
  completionRationale: string | null;
  clientId: string;
  clientName: string;
  clientColor: string;
  status: TaskStatus;
  complexityLevel: 1 | 2 | 3 | 4;
  basePoints: number;
  efficiencyAdjustment: number;
  executionAdjustment: number;
  points: number;
  estimatedDurationSeconds: number;
  dueAt: string | null;
  completedAt: string | null;
  activeTimerStartedAt: string | null;
  trackedSeconds: number;
  manualDurationSeconds: number | null;
  classificationStatus: ClassificationStatus;
  classificationError?: AiErrorDiagnostic | null;
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
  timezone?: string;
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
