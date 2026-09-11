import type { HistoricalSuggestionFeedback } from "@/lib/ai/suggestion-learning";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function loadSuggestionLearningHistory(input: {
  supabase: ServerSupabaseClient;
  agencyId: string;
  currentTaskId: string;
}): Promise<HistoricalSuggestionFeedback[]> {
  const { data: feedbackRows, error: feedbackError } = await input.supabase
    .from("task_suggestions")
    .select("task_id, title, description, status, evidence, updated_at")
    .eq("agency_id", input.agencyId)
    .neq("task_id", input.currentTaskId)
    .in("status", ["not_applicable", "completed"])
    .order("updated_at", { ascending: false })
    .limit(120);

  if (feedbackError) {
    console.error("Jarvis suggestion learning history failed", { stage: "feedback", error: feedbackError.message });
    return [];
  }
  if (!feedbackRows?.length) return [];

  const taskIds = [...new Set(feedbackRows.map((row) => row.task_id))];
  const { data: taskRows, error: taskError } = await input.supabase
    .from("tasks")
    .select("id, title, description")
    .eq("agency_id", input.agencyId)
    .in("id", taskIds);

  if (taskError) {
    console.error("Jarvis suggestion learning history failed", { stage: "tasks", error: taskError.message });
    return [];
  }
  const tasks = new Map((taskRows ?? []).map((task) => [task.id, task]));

  return feedbackRows.flatMap((row) => {
    const task = tasks.get(row.task_id);
    if (!task || (row.status !== "not_applicable" && row.status !== "completed")) return [];
    return [{
      taskTitle: task.title,
      taskDescription: task.description,
      suggestionTitle: row.title,
      suggestionDescription: row.description,
      reason: row.status === "not_applicable" ? row.evidence : null,
      outcome: row.status,
    } satisfies HistoricalSuggestionFeedback];
  });
}
