import { classifyTask } from "@/lib/ai/classifier";
import { createClient } from "@/lib/supabase/server";

export async function reevaluateCompletedTask(taskId: string, agencyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("title, estimated_duration_seconds, tracked_seconds, manual_duration_seconds")
    .eq("id", taskId)
    .eq("agency_id", agencyId)
    .single();

  if (error || !task) throw new Error("Tarefa indisponível para avaliação do Jarvis.");
  const actualDurationSeconds = task.manual_duration_seconds ?? task.tracked_seconds;
  const classification = await classifyTask({
    title: task.title,
    estimatedDurationSeconds: task.estimated_duration_seconds,
    actualDurationSeconds,
  });

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      complexity_level: classification.complexityLevel,
      base_points: classification.basePoints,
      efficiency_adjustment: classification.efficiencyAdjustment,
      points: classification.finalPoints,
      classification_status: "classified",
      ai_model: classification.model,
      classification_metadata: {
        analyst: "Jarvis",
        justification: classification.rationale,
        evaluated_actual_seconds: actualDurationSeconds,
      },
    })
    .eq("id", taskId)
    .eq("agency_id", agencyId);

  if (updateError) throw new Error(`Falha ao salvar avaliação do Jarvis: ${updateError.message}`);
}
