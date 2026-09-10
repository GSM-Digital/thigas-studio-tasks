import { z } from "zod";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";
import { reevaluateCompletedTask } from "@/lib/ai/reevaluate-task";

const updateSchema = z.object({ completed: z.boolean() });
const paramsSchema = z.object({ taskId: z.uuid() });

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const { completed } = await parseJson(request, updateSchema);
    const supabase = await createClient();

    if (completed) {
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

    const { error } = await supabase
      .from("tasks")
      .update({
        status: completed ? "completed" : "open",
        completed_at: completed ? new Date().toISOString() : null,
        approved_at: null,
        approved_by: null,
      })
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId);
    if (error) throw new ApiError(409, "TASK_UPDATE_FAILED", error.message);
    if (completed) {
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
