import { z } from "zod";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";
import { reevaluateCompletedTask } from "@/lib/ai/reevaluate-task";

const inputSchema = z.object({ durationSeconds: z.number().int().min(0).max(359_999_999) });
const paramsSchema = z.object({ taskId: z.uuid() });

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const { durationSeconds } = await parseJson(request, inputSchema);
    const supabase = await createClient();
    const { data: active } = await supabase.from("time_entries").select("id").eq("task_id", taskId).is("stopped_at", null).maybeSingle();
    if (active) throw new ApiError(409, "TIMER_RUNNING", "Pare o cronômetro antes de editar o tempo.");

    const { data: task, error } = await supabase
      .from("tasks")
      .update({ manual_duration_seconds: durationSeconds })
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId)
      .select("status")
      .single();
    if (error) throw new ApiError(409, "TIME_UPDATE_FAILED", error.message);
    if (task.status === "completed" || task.status === "approved") {
      try {
        await reevaluateCompletedTask(taskId, viewer.agencyId);
      } catch (evaluationError) {
        console.error("Jarvis task reevaluation failed", evaluationError);
      }
    }
    return Response.json({ task: await getTaskView(taskId) });
  } catch (error) {
    return jsonError(error);
  }
}
