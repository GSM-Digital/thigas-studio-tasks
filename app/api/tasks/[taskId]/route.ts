import { z } from "zod";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import type { Database } from "@/lib/database.types";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";
import { reevaluateCompletedTask } from "@/lib/ai/reevaluate-task";

const updateSchema = z.object({
  completed: z.boolean().optional(),
  description: z.string().trim().max(4_000).nullable().optional(),
  clientId: z.uuid().optional(),
  dueAt: z.string().datetime({ offset: true }).refine(
    (value) => new Date(value).getTime() > Date.now(),
    "O prazo deve estar no futuro.",
  ).optional(),
}).refine(
  (input) => input.completed !== undefined || input.description !== undefined || input.clientId !== undefined || input.dueAt !== undefined,
  "Informe ao menos uma alteração.",
);
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
        console.error("Jarvis task evaluation failed", evaluationError);
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
