import type { TaskView } from "@/lib/types";

const COMPLEXITY_BUFFER = {
  1: 0,
  2: 0.15,
  3: 0.3,
  4: 0.5,
} as const;

type PriorityTask = Pick<
  TaskView,
  "id" | "title" | "dueAt" | "complexityLevel" | "estimatedDurationSeconds"
>;

/**
 * Positive means the task has already reached its safe start point. Higher is
 * more urgent. Complexity adds contingency to the raw execution estimate.
 */
export function calculateTaskUrgency(task: PriorityTask, nowMs = Date.now()): number | null {
  if (!task.dueAt) return null;
  const dueAtMs = new Date(task.dueAt).getTime();
  if (!Number.isFinite(dueAtMs)) return null;

  const executionSeconds = Math.max(0, task.estimatedDurationSeconds);
  const riskAdjustedSeconds = executionSeconds * (1 + COMPLEXITY_BUFFER[task.complexityLevel]);
  const remainingSeconds = (dueAtMs - nowMs) / 1000;
  return riskAdjustedSeconds - remainingSeconds;
}

export function sortTasksByUrgency<T extends PriorityTask>(tasks: readonly T[], nowMs = Date.now()): T[] {
  return [...tasks].sort((left, right) => {
    const leftUrgency = calculateTaskUrgency(left, nowMs);
    const rightUrgency = calculateTaskUrgency(right, nowMs);
    if (leftUrgency === null && rightUrgency !== null) return 1;
    if (leftUrgency !== null && rightUrgency === null) return -1;
    if (leftUrgency !== null && rightUrgency !== null && leftUrgency !== rightUrgency) {
      return rightUrgency - leftUrgency;
    }

    const leftDueAt = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDueAt = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDueAt !== rightDueAt) return leftDueAt - rightDueAt;
    if (left.complexityLevel !== right.complexityLevel) {
      return right.complexityLevel - left.complexityLevel;
    }
    if (left.estimatedDurationSeconds !== right.estimatedDurationSeconds) {
      return right.estimatedDurationSeconds - left.estimatedDurationSeconds;
    }
    return left.title.localeCompare(right.title, "pt-BR") || left.id.localeCompare(right.id);
  });
}
