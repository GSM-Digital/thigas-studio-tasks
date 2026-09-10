import { z } from "zod";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";

const inputSchema = z.object({ action: z.enum(["start", "stop"]) });
const paramsSchema = z.object({ taskId: z.uuid() });

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const { action } = await parseJson(request, inputSchema);
    const supabase = await createClient();
    const fn = action === "start" ? "start_task_timer" : "stop_task_timer";
    const { error } = await supabase.rpc(fn, { target_task_id: taskId });
    if (error) throw new ApiError(409, "TIMER_CONFLICT", error.message);
    return Response.json({ task: await getTaskView(taskId) });
  } catch (error) {
    return jsonError(error);
  }
}
