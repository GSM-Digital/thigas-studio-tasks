import { z } from "zod";
import { reevaluateCompletedTask } from "@/lib/ai/reevaluate-task";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";
import { createAiErrorDiagnostic } from "@/lib/ai/error-diagnostics";
import { logAiError, persistTaskEvaluationFailure } from "@/lib/ai/task-evaluation-error";

const paramsSchema = z.object({ taskId: z.uuid() });

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const supabase = await createClient();

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, status, completion_summary")
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId)
      .maybeSingle();

    if (taskError) throw new ApiError(500, "TASK_READ_FAILED", "Não foi possível consultar a tarefa.");
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Tarefa não encontrada.");
    if (task.status !== "completed") {
      throw new ApiError(409, "TASK_NOT_COMPLETED", "Somente tarefas concluídas podem ser reavaliadas.");
    }
    if (!task.completion_summary) {
      throw new ApiError(409, "COMPLETION_SUMMARY_REQUIRED", "A tarefa não possui um relato de conclusão para o Jarvis analisar.");
    }

    const { error: pendingError } = await supabase
      .from("tasks")
      .update({ classification_status: "pending" })
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId);
    if (pendingError) {
      throw new ApiError(409, "EVALUATION_STATE_FAILED", "Não foi possível iniciar a reavaliação.");
    }

    try {
      await reevaluateCompletedTask(taskId, viewer.agencyId);
    } catch (evaluationError) {
      const diagnostic = createAiErrorDiagnostic(evaluationError);
      logAiError("Jarvis task reevaluation failed", diagnostic);
      await persistTaskEvaluationFailure(taskId, viewer.agencyId, diagnostic);
      throw new ApiError(
        diagnostic.category === "quota_exhausted" ? 429 : 503,
        diagnostic.code,
        diagnostic.message,
        { diagnostic },
      );
    }

    return Response.json({ task: await getTaskView(taskId) });
  } catch (error) {
    return jsonError(error);
  }
}
