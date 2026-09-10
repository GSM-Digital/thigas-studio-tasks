import { z } from "zod";
import { classifyTask } from "@/lib/ai/classifier";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";

const createTaskSchema = z.object({
  title: z.string().trim().min(3).max(240),
  clientId: z.uuid(),
  estimatedDurationSeconds: z.number().int().positive().max(359_999_999).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).refine(
    (value) => new Date(value).getTime() > Date.now(),
    "O prazo deve estar no futuro.",
  ),
});

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const input = await parseJson(request, createTaskSchema);
    const supabase = await createClient();
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", input.clientId)
      .eq("agency_id", viewer.agencyId)
      .eq("active", true)
      .maybeSingle();
    if (!client) throw new ApiError(404, "CLIENT_NOT_FOUND", "Cliente não encontrado.");

    let classification;
    try {
      classification = await classifyTask({
        title: input.title,
        estimatedDurationSeconds: input.estimatedDurationSeconds ?? null,
      });
    } catch (error) {
      console.error("Task classification failed", error);
      throw new ApiError(502, "CLASSIFICATION_FAILED", "A classificação automática está indisponível. Tente novamente.");
    }
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        agency_id: viewer.agencyId,
        client_id: input.clientId,
        created_by: viewer.id,
        assignee_id: viewer.id,
        title: input.title,
        status: "open",
        complexity_level: classification.complexityLevel,
        base_points: classification.basePoints,
        efficiency_adjustment: classification.efficiencyAdjustment,
        points: classification.finalPoints,
        estimated_duration_seconds: classification.estimatedDurationSeconds,
        due_at: input.dueAt,
        classification_status: "classified",
        ai_model: classification.model,
        classification_metadata: {
          analyst: "Jarvis",
          justification: classification.rationale,
          estimated_duration_source: classification.estimateSource,
        },
      })
      .select("id")
      .single();
    if (error || !task) throw new ApiError(500, "TASK_CREATE_FAILED", "Não foi possível criar a tarefa.");

    return Response.json({ task: await getTaskView(task.id) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
