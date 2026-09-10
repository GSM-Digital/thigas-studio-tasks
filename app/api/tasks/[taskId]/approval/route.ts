import { z } from "zod";
import { requireAgency, requireViewer } from "@/lib/auth";
import { ApiError, jsonError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";

const paramsSchema = z.object({ taskId: z.uuid() });

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireAgency(viewer);
    const { taskId } = paramsSchema.parse(await context.params);
    const supabase = await createClient();
    const { error } = await supabase.rpc("approve_task", { target_task_id: taskId });
    if (error) throw new ApiError(409, "APPROVAL_FAILED", error.message);
    return Response.json({ task: await getTaskView(taskId) });
  } catch (error) {
    return jsonError(error);
  }
}
