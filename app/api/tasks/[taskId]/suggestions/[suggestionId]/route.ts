import { z } from "zod";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { mapTaskSuggestion } from "@/lib/domain/task-suggestions";
import { createClient } from "@/lib/supabase/server";
import { TASK_SUGGESTION_COLUMNS } from "@/lib/task-suggestion-view";

const paramsSchema = z.object({ taskId: z.uuid(), suggestionId: z.uuid() });
const updateSchema = z.object({
  status: z.enum(["pending", "completed", "not_applicable"]),
  evidence: z.string().trim().max(1_000).nullable().optional(),
}).superRefine((input, context) => {
  if (input.status === "not_applicable" && (!input.evidence || input.evidence.length < 5)) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Explique por que esta sugestão não se aplica." });
  }
});

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string; suggestionId: string }> }) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const { taskId, suggestionId } = paramsSchema.parse(await context.params);
    const input = await parseJson(request, updateSchema);
    const supabase = await createClient();
    const { data: task } = await supabase
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .eq("agency_id", viewer.agencyId)
      .maybeSingle();
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Tarefa não encontrada.");
    if (task.status === "completed" || task.status === "approved") {
      throw new ApiError(409, "TASK_FINALIZED", "O checklist não pode ser alterado após a conclusão.");
    }
    const evidence = input.evidence?.trim() || null;
    const { data, error } = await supabase
      .from("task_suggestions")
      .update({
        status: input.status,
        evidence,
        completed_at: input.status === "completed" ? new Date().toISOString() : null,
        verification_status: "pending",
        verification_rationale: null,
        verified_at: null,
      })
      .eq("id", suggestionId)
      .eq("task_id", taskId)
      .eq("agency_id", viewer.agencyId)
      .select(TASK_SUGGESTION_COLUMNS)
      .maybeSingle();
    if (error) throw new ApiError(500, "SUGGESTION_UPDATE_FAILED", "Não foi possível atualizar a sugestão.");
    if (!data) throw new ApiError(404, "SUGGESTION_NOT_FOUND", "Sugestão não encontrada.");
    return Response.json({ suggestion: mapTaskSuggestion(data) });
  } catch (error) {
    return jsonError(error);
  }
}
