import { ApiError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import type { TaskView } from "@/lib/types";

export async function getTaskView(taskId: string): Promise<TaskView> {
  const supabase = await createClient();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, title, description, client_id, status, complexity_level, base_points, efficiency_adjustment, points, estimated_duration_seconds, due_at, completed_at, tracked_seconds, manual_duration_seconds, classification_status")
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
    clientId: task.client_id,
    clientName: client?.name ?? "Cliente removido",
    clientColor: client?.color ?? "#8e8e93",
    status: task.status,
    complexityLevel: task.complexity_level,
    basePoints: task.base_points,
    efficiencyAdjustment: task.efficiency_adjustment,
    points: task.points,
    estimatedDurationSeconds: task.estimated_duration_seconds,
    dueAt: task.due_at,
    completedAt: task.completed_at,
    activeTimerStartedAt: activeTimer?.started_at ?? null,
    trackedSeconds: task.tracked_seconds,
    manualDurationSeconds: task.manual_duration_seconds,
    classificationStatus: task.classification_status,
  };
}
