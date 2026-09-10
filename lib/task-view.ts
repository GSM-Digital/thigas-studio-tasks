import { ApiError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import type { TaskView } from "@/lib/types";
import { readAiErrorDiagnostic } from "@/lib/ai/error-diagnostics";

export async function getTaskView(taskId: string): Promise<TaskView> {
  const supabase = await createClient();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, title, description, completion_summary, completion_rationale, client_id, status, complexity_level, base_points, efficiency_adjustment, execution_adjustment, points, estimated_duration_seconds, due_at, completed_at, tracked_seconds, manual_duration_seconds, classification_status, classification_metadata")
    .eq("id", taskId)
    .single();
  if (error || !task) throw new ApiError(404, "TASK_NOT_FOUND", "Tarefa não encontrada.");

  const [{ data: client }, { data: activeTimer }] = await Promise.all([
    supabase.from("clients").select("name, color").eq("id", task.client_id).single(),
    supabase
      .from("time_entries")
      .select("started_at")
      .eq("task_id", task.id)
      .is("stopped_at", null)
      .maybeSingle(),
  ]);

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    completionSummary: task.completion_summary,
    completionRationale: task.completion_rationale,
    clientId: task.client_id,
    clientName: client?.name ?? "Cliente removido",
    clientColor: client?.color ?? "#8e8e93",
    status: task.status,
    complexityLevel: task.complexity_level,
    basePoints: task.base_points,
    efficiencyAdjustment: task.efficiency_adjustment,
    executionAdjustment: task.execution_adjustment,
    points: task.points,
    estimatedDurationSeconds: task.estimated_duration_seconds,
    dueAt: task.due_at,
    completedAt: task.completed_at,
    activeTimerStartedAt: activeTimer?.started_at ?? null,
    trackedSeconds: task.tracked_seconds,
    manualDurationSeconds: task.manual_duration_seconds,
    classificationStatus: task.classification_status,
    classificationError: readAiErrorDiagnostic(
      task.classification_metadata && typeof task.classification_metadata === "object" && !Array.isArray(task.classification_metadata)
        ? task.classification_metadata.last_evaluation_error
        : null,
    ),
  };
}
