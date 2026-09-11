import type { TaskSuggestion, TaskSuggestionVerification } from "@/lib/types";

export const TASK_SUGGESTION_CATEGORY_LABELS = {
  essential: "Essencial",
  recommended: "Recomendado",
  value: "Valor adicional",
  follow_up: "Follow-up",
} as const;

export interface SuggestionReview {
  position: number;
  result: Exclude<TaskSuggestionVerification, "pending">;
  rationale: string;
}

export interface ChecklistScore {
  percentage: number;
  earnedPercentage: number;
  penaltyPercentage: number;
}

export function calculateChecklistScore(
  suggestions: TaskSuggestion[],
  reviews: SuggestionReview[],
): ChecklistScore {
  const byPosition = new Map(reviews.map((review) => [review.position, review]));
  let earnedPercentage = 0;
  let penaltyPercentage = 0;

  for (const suggestion of suggestions) {
    const result = byPosition.get(suggestion.position)?.result ?? "rejected";
    if (suggestion.status === "completed" && result === "verified") {
      earnedPercentage += suggestion.rewardPercentage;
    } else if (
      suggestion.category === "essential"
      && result !== "not_applicable"
    ) {
      penaltyPercentage += suggestion.omissionPenaltyPercentage;
    }
  }

  earnedPercentage = Math.min(20, earnedPercentage);
  penaltyPercentage = Math.min(100, penaltyPercentage);
  return {
    percentage: Math.max(-100, Math.min(20, earnedPercentage - penaltyPercentage)),
    earnedPercentage,
    penaltyPercentage,
  };
}

export function mapTaskSuggestion(row: {
  id: string; task_id: string; position: number; title: string; description: string;
  category: TaskSuggestion["category"]; reward_percentage: number; omission_penalty_percentage: number;
  evidence_required: boolean; tools: string[]; status: TaskSuggestion["status"];
  evidence: string | null; verification_status: TaskSuggestion["verificationStatus"];
  verification_rationale: string | null;
}): TaskSuggestion {
  return {
    id: row.id,
    taskId: row.task_id,
    position: row.position,
    title: row.title,
    description: row.description,
    category: row.category,
    rewardPercentage: row.reward_percentage,
    omissionPenaltyPercentage: row.omission_penalty_percentage,
    evidenceRequired: row.evidence_required,
    tools: row.tools ?? [],
    status: row.status,
    evidence: row.evidence,
    verificationStatus: row.verification_status,
    verificationRationale: row.verification_rationale,
  };
}
