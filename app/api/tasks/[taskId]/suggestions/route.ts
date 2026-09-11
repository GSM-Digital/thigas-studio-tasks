import { z } from "zod";
import { createAiErrorDiagnostic } from "@/lib/ai/error-diagnostics";
import { generateTaskSuggestions } from "@/lib/ai/task-suggestions";
import { loadSuggestionLearningHistory } from "@/lib/ai/suggestion-learning-history";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError } from "@/lib/http";
import { mapTaskSuggestion } from "@/lib/domain/task-suggestions";
import { createClient } from "@/lib/supabase/server";
import { TASK_SUGGESTION_COLUMNS } from "@/lib/task-suggestion-view";

const paramsSchema = z.object({ taskId: z.uuid() });

async function loadSuggestions(taskId: string, agencyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_suggestions")
    .select(TASK_SUGGESTION_COLUMNS)
    .eq("task_id", taskId)
    .eq("agency_id", agencyId)
    .order("position");
  if (error) throw new ApiError(500, "SUGGESTIONS_READ_FAILED", "Não foi possível carregar as sugestões do Jarvis.");
  return (data ?? []).map(mapTaskSuggestion);
}

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    const { taskId } = paramsSchema.parse(await context.params);
    return Response.json({ suggestions: await loadSuggestions(taskId, viewer.agencyId), cached: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const cached = await loadSuggestions(taskId, viewer.agencyId);
    if (cached.length > 0) return Response.json({ suggestions: cached, cached: true });

    const supabase = await createClient();
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, title, description, client_id, status, complexity_level, estimated_duration_seconds, due_at")
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId)
      .maybeSingle();
    if (taskError) throw new ApiError(500, "TASK_READ_FAILED", "Não foi possível consultar a tarefa.");
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Tarefa não encontrada.");
    if (task.status === "completed" || task.status === "approved") {
      throw new ApiError(409, "TASK_FINALIZED", "As sugestões precisam ser criadas antes da conclusão.");
    }
    const [{ data: client }, learningHistory] = await Promise.all([
      supabase.from("clients").select("name").eq("id", task.client_id).maybeSingle(),
      loadSuggestionLearningHistory({ supabase, agencyId: viewer.agencyId, currentTaskId: taskId }),
    ]);

    let generated;
    try {
      generated = await generateTaskSuggestions({
        title: task.title,
        description: task.description,
        clientName: client?.name ?? "Cliente não informado",
        complexityLevel: task.complexity_level,
        estimatedDurationSeconds: task.estimated_duration_seconds,
        dueAt: task.due_at,
        learningHistory,
      });
    } catch (error) {
      const diagnostic = createAiErrorDiagnostic(error);
      console.error("Jarvis suggestions failed", diagnostic);
      throw new ApiError(502, "SUGGESTIONS_AI_FAILED", diagnostic.title, { diagnostic });
    }

    if (generated.length === 0) {
      return Response.json({ suggestions: [], cached: false, learned: true });
    }

    const { error: insertError } = await supabase.from("task_suggestions").insert(
      generated.map((suggestion, index) => ({
        agency_id: viewer.agencyId,
        task_id: taskId,
        position: index + 1,
        title: suggestion.title,
        description: suggestion.description,
        category: suggestion.category,
        reward_percentage: suggestion.rewardPercentage,
        omission_penalty_percentage: suggestion.omissionPenaltyPercentage,
        evidence_required: suggestion.evidenceRequired,
        tools: suggestion.tools,
      })),
    );
    if (insertError) {
      const concurrent = await loadSuggestions(taskId, viewer.agencyId);
      if (concurrent.length > 0) return Response.json({ suggestions: concurrent, cached: true });
      throw new ApiError(500, "SUGGESTIONS_SAVE_FAILED", `Não foi possível salvar as sugestões: ${insertError.message}`);
    }
    return Response.json({ suggestions: await loadSuggestions(taskId, viewer.agencyId), cached: false }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
