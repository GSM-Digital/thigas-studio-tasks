import { evaluateTaskCompletion } from "@/lib/ai/completion-evaluator";
import { calculateEfficiencyScore } from "@/lib/domain/points";
import { createClient } from "@/lib/supabase/server";

export async function reevaluateCompletedTask(taskId: string, agencyId: string): Promise<void> {
  const supabase = await createClient();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("title, description, completion_summary, base_points, estimated_duration_seconds, tracked_seconds, manual_duration_seconds, classification_metadata")
    .eq("id", taskId)
    .eq("agency_id", agencyId)
    .single();

  if (error || !task) throw new Error("Tarefa indisponível para avaliação do Jarvis.");
  const actualDurationSeconds = task.manual_duration_seconds ?? task.tracked_seconds;
  if (!task.completion_summary) throw new Error("O relato de conclusão é obrigatório para a avaliação do Jarvis.");
  const previousMetadata = task.classification_metadata && typeof task.classification_metadata === "object" && !Array.isArray(task.classification_metadata)
    ? task.classification_metadata
    : {};
  const rawCompletionNotes = typeof previousMetadata.completion_raw_notes === "string"
    ? previousMetadata.completion_raw_notes
    : task.completion_summary;
  const calculatedEfficiency = calculateEfficiencyScore(
    task.base_points,
    task.estimated_duration_seconds,
    actualDurationSeconds,
  );
  const completion = await evaluateTaskCompletion({
    title: task.title,
    description: task.description,
    completionSummary: rawCompletionNotes,
    basePoints: task.base_points,
    estimatedDurationSeconds: task.estimated_duration_seconds,
    actualDurationSeconds,
  });
  const suppressEfficiencyBonus = completion.percentage < 0 && calculatedEfficiency.adjustment > 0;
  const efficiencyAdjustment = suppressEfficiencyBonus ? 0 : calculatedEfficiency.adjustment;
  const efficiencyPercentage = suppressEfficiencyBonus ? 0 : calculatedEfficiency.percentage;
  const finalPoints = Math.max(0, task.base_points + efficiencyAdjustment + completion.adjustment);
  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      efficiency_adjustment: efficiencyAdjustment,
      execution_adjustment: completion.adjustment,
      completion_summary: completion.summary,
      completion_rationale: completion.rationale,
      points: finalPoints,
      classification_status: "classified",
      ai_model: completion.model,
      classification_metadata: {
        ...previousMetadata,
        analyst: "Jarvis",
        completion_raw_notes: rawCompletionNotes,
        completion_justification: completion.rationale,
        execution_adjustment_percentage: completion.percentage,
        efficiency_percentage: efficiencyPercentage,
        calculated_efficiency_percentage: calculatedEfficiency.percentage,
        efficiency_bonus_suppressed: suppressEfficiencyBonus,
        evaluated_actual_seconds: actualDurationSeconds,
      },
    })
    .eq("id", taskId)
    .eq("agency_id", agencyId);

  if (updateError) throw new Error(`Falha ao salvar avaliação do Jarvis: ${updateError.message}`);
}
