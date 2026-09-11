import { z } from "zod";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";
import { reevaluateCompletedTask } from "@/lib/ai/reevaluate-task";
import { createAiErrorDiagnostic } from "@/lib/ai/error-diagnostics";
import { logAiError, persistTaskEvaluationFailure } from "@/lib/ai/task-evaluation-error";
import { findCompletedEssentialsMissingEvidence } from "@/lib/domain/task-suggestions";

const updateSchema = z.object({
  completed: z.boolean().optional(),
  description: z.string().trim().max(4_000).nullable().optional(),
  completionSummary: z.string().trim().min(10).max(4_000).optional(),
  clientId: z.uuid().optional(),
  dueAt: z.string().datetime({ offset: true }).refine(
    (value) => new Date(value).getTime() > Date.now(),
    "O prazo deve estar no futuro.",
  ).optional(),
}).superRefine((input, context) => {
  if (input.completed === undefined && input.description === undefined && input.clientId === undefined && input.dueAt === undefined) {
    context.addIssue({ code: "custom", message: "Informe ao menos uma alteração." });
  }
  if (input.completed === true && !input.completionSummary) {
    context.addIssue({
      code: "custom",
      path: ["completionSummary"],
      message: "Descreva brevemente como foi a execução antes de concluir.",
    });
  }
  if (input.completionSummary !== undefined && input.completed !== true) {
    context.addIssue({
      code: "custom",
      path: ["completionSummary"],
      message: "O relato de conclusão só pode ser enviado ao concluir a tarefa.",
    });
  }
});
const paramsSchema = z.object({ taskId: z.uuid() });

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const input = await parseJson(request, updateSchema);
    const supabase = await createClient();

    if (input.clientId) {
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("id", input.clientId)
        .eq("agency_id", viewer.agencyId)
        .eq("active", true)
        .maybeSingle();
      if (clientError) throw new ApiError(500, "CLIENT_READ_FAILED", "Não foi possível consultar o cliente.");
      if (!client) throw new ApiError(404, "CLIENT_NOT_FOUND", "Cliente não encontrado.");
    }

    if (input.completed) {
      const { data: requiredEvidenceRows, error: requiredEvidenceError } = await supabase
        .from("task_suggestions")
        .select("id, title, category, status, evidence_required, evidence")
        .eq("task_id", taskId)
        .eq("agency_id", viewer.agencyId)
        .eq("category", "essential")
        .eq("status", "completed")
        .eq("evidence_required", true);
      if (requiredEvidenceError) {
        throw new ApiError(500, "CHECKLIST_READ_FAILED", "Não foi possível validar as comprovações do checklist.");
      }
      const missingEvidence = findCompletedEssentialsMissingEvidence((requiredEvidenceRows ?? []).map((suggestion) => ({
        id: suggestion.id,
        title: suggestion.title,
        category: suggestion.category,
        status: suggestion.status,
        evidenceRequired: suggestion.evidence_required,
        evidence: suggestion.evidence,
      })));
      if (missingEvidence.length > 0) {
        throw new ApiError(
          422,
          "REQUIRED_CHECKLIST_EVIDENCE_MISSING",
          `Escreva a comprovação obrigatória de: ${missingEvidence.map((item) => item.title).join(", ")}.`,
          { suggestionIds: missingEvidence.map((item) => item.id) },
        );
      }

      const { data: active } = await supabase
        .from("time_entries")
        .select("id")
        .eq("task_id", taskId)
        .is("stopped_at", null)
        .maybeSingle();
      if (active) {
        const { error: stopError } = await supabase.rpc("stop_task_timer", { target_task_id: taskId });
        if (stopError) throw new ApiError(409, "TIMER_STOP_FAILED", stopError.message);
      }
    }

    const updates: Database["public"]["Tables"]["tasks"]["Update"] = {};
    if (input.description !== undefined) updates.description = input.description?.trim() || null;
    if (input.clientId !== undefined) updates.client_id = input.clientId;
    if (input.dueAt !== undefined) updates.due_at = input.dueAt;
    if (input.completed !== undefined) {
      updates.status = input.completed ? "completed" : "open";
      updates.completed_at = input.completed ? new Date().toISOString() : null;
      updates.approved_at = null;
      updates.approved_by = null;
    }
    if (input.completed) {
      updates.completion_summary = input.completionSummary;
      updates.completion_rationale = null;
      updates.classification_status = "pending";
    }
    const { error } = await supabase
      .from("tasks")
      .update(updates)
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId);
    if (error) throw new ApiError(409, "TASK_UPDATE_FAILED", error.message);
    if (input.completed) {
      try {
        await reevaluateCompletedTask(taskId, viewer.agencyId);
      } catch (evaluationError) {
        const diagnostic = createAiErrorDiagnostic(evaluationError);
        logAiError("Jarvis task evaluation failed", diagnostic);
        await persistTaskEvaluationFailure(taskId, viewer.agencyId, diagnostic);
      }
    }
    return Response.json({ task: await getTaskView(taskId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const supabase = await createClient();

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, status")
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId)
      .maybeSingle();
    if (taskError) throw new ApiError(500, "TASK_READ_FAILED", "Não foi possível consultar a tarefa.");
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Tarefa não encontrada.");
    if (task.status === "completed" || task.status === "approved") {
      throw new ApiError(409, "TASK_FINALIZED", "Tarefas concluídas ou aprovadas não podem ser excluídas.");
    }

    const { data: activeTimer, error: timerError } = await supabase
      .from("time_entries")
      .select("id")
      .eq("task_id", taskId)
      .is("stopped_at", null)
      .maybeSingle();
    if (timerError) throw new ApiError(500, "TIMER_READ_FAILED", "Não foi possível verificar o cronômetro.");
    if (activeTimer) throw new ApiError(409, "TIMER_RUNNING", "Pare o cronômetro antes de excluir a tarefa.");

    const { data: deleted, error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId)
      .in("status", ["open", "in_progress"])
      .select("id")
      .maybeSingle();
    if (deleteError) throw new ApiError(409, "TASK_DELETE_FAILED", "Não foi possível excluir a tarefa.");
    if (!deleted) throw new ApiError(409, "TASK_STATE_CHANGED", "O estado da tarefa mudou. Atualize a página e tente novamente.");
    return Response.json({ removedTaskId: deleted.id });
  } catch (error) {
    return jsonError(error);
  }
}
