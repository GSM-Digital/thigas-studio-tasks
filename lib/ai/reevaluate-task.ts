import { evaluateTaskCompletion } from "@/lib/ai/completion-evaluator";
import { calculateEfficiencyScore, calculatePercentageAdjustment } from "@/lib/domain/points";
import { calculateChecklistScore, mapTaskSuggestion, MIN_REQUIRED_EVIDENCE_LENGTH } from "@/lib/domain/task-suggestions";
import { createClient } from "@/lib/supabase/server";

export async function reevaluateCompletedTask(taskId: string, agencyId: string): Promise<void> {
  const supabase = await createClient();
  const [{ data: task, error }, { data: suggestionRows, error: suggestionError }] = await Promise.all([
    supabase
    .from("tasks")
    .select("title, description, completion_summary, base_points, estimated_duration_seconds, tracked_seconds, manual_duration_seconds, classification_metadata")
    .eq("id", taskId)
    .eq("agency_id", agencyId)
    .single(),
    supabase
      .from("task_suggestions")
      .select("id, task_id, position, title, description, category, reward_percentage, omission_penalty_percentage, evidence_required, tools, status, evidence, verification_status, verification_rationale")
      .eq("task_id", taskId)
      .eq("agency_id", agencyId)
      .order("position"),
  ]);

  if (error || !task) throw new Error("Tarefa indisponível para avaliação do Jarvis.");
  if (suggestionError) throw new Error("Não foi possível consultar o checklist da tarefa.");
  const suggestions = (suggestionRows ?? []).map(mapTaskSuggestion);
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
  const checklistForEvaluation = suggestions
    .filter((suggestion) => (
      suggestion.category === "essential"
      || (
        suggestion.status === "completed"
        && (!suggestion.evidenceRequired || (suggestion.evidence?.trim().length ?? 0) >= MIN_REQUIRED_EVIDENCE_LENGTH)
      )
    ))
    .map((suggestion) => ({
      position: suggestion.position,
      title: suggestion.title,
      description: suggestion.description,
      category: suggestion.category,
      status: suggestion.status,
      evidence: suggestion.evidence,
      evidenceRequired: suggestion.evidenceRequired,
      scoringRule: suggestion.category === "essential" ? "essential" as const : "bonus_only" as const,
    }));
  const completion = await evaluateTaskCompletion({
    title: task.title,
    description: task.description,
    completionSummary: rawCompletionNotes,
    basePoints: task.base_points,
    estimatedDurationSeconds: task.estimated_duration_seconds,
    actualDurationSeconds,
    checklist: checklistForEvaluation,
  });
  const checklistScore = calculateChecklistScore(suggestions, completion.checklistReviews);
  const narrativePercentage = checklistScore.percentage < 0 && completion.percentage > 0
    ? 0
    : completion.percentage;
  const combinedExecutionPercentage = Math.max(-100, Math.min(20, narrativePercentage + checklistScore.percentage));
  const executionAdjustment = calculatePercentageAdjustment(task.base_points, combinedExecutionPercentage);
  const suppressEfficiencyBonus = combinedExecutionPercentage < 0 && calculatedEfficiency.adjustment > 0;
  const efficiencyAdjustment = suppressEfficiencyBonus ? 0 : calculatedEfficiency.adjustment;
  const efficiencyPercentage = suppressEfficiencyBonus ? 0 : calculatedEfficiency.percentage;
  const finalPoints = Math.max(0, task.base_points + efficiencyAdjustment + executionAdjustment);
  const checklistRationale = suggestions.length > 0
    ? checklistScore.penaltyPercentage > 0
      ? `Checklist: +${checklistScore.earnedPercentage}% confirmado e -${checklistScore.penaltyPercentage}% por itens essenciais não confirmados.`
      : `Checklist: +${checklistScore.earnedPercentage}% confirmado e nenhum desconto por itens essenciais.`
    : "";
  const completionRationale = [completion.rationale, checklistRationale].filter(Boolean).join(" ");
  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      efficiency_adjustment: efficiencyAdjustment,
      execution_adjustment: executionAdjustment,
      completion_summary: completion.summary,
      completion_rationale: completionRationale,
      points: finalPoints,
      classification_status: "classified",
      ai_model: completion.model,
      classification_metadata: {
        ...previousMetadata,
        analyst: "Jarvis",
        last_evaluation_error: null,
        completion_raw_notes: rawCompletionNotes,
        completion_justification: completionRationale,
        narrative_adjustment_percentage: narrativePercentage,
        checklist_adjustment_percentage: checklistScore.percentage,
        checklist_bonus_percentage: checklistScore.earnedPercentage,
        checklist_penalty_percentage: checklistScore.penaltyPercentage,
        execution_adjustment_percentage: combinedExecutionPercentage,
        efficiency_percentage: efficiencyPercentage,
        calculated_efficiency_percentage: calculatedEfficiency.percentage,
        efficiency_bonus_suppressed: suppressEfficiencyBonus,
        evaluated_actual_seconds: actualDurationSeconds,
      },
    })
    .eq("id", taskId)
    .eq("agency_id", agencyId);

  if (updateError) throw new Error(`Falha ao salvar avaliação do Jarvis: ${updateError.message}`);

  if (suggestions.length > 0) {
    const reviewsByPosition = new Map(completion.checklistReviews.map((review) => [review.position, review]));
    for (const suggestion of suggestions) {
      const review = reviewsByPosition.get(suggestion.position) ?? {
        result: "rejected" as const,
        rationale: suggestion.category === "essential"
          ? "O relato não confirmou que este item essencial foi realizado."
          : "Item opcional não realizado ou não confirmado; sem impacto negativo na pontuação.",
      };
      const { error: reviewError } = await supabase
        .from("task_suggestions")
        .update({
          verification_status: review.result,
          verification_rationale: review.rationale,
          verified_at: new Date().toISOString(),
        })
        .eq("id", suggestion.id)
        .eq("agency_id", agencyId);
      if (reviewError) throw new Error(`Falha ao salvar a avaliação do checklist: ${reviewError.message}`);
    }
  }
}
