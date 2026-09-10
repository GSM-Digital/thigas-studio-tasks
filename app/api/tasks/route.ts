import { z } from "zod";
import { classifyTask } from "@/lib/ai/classifier";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { resolveOrCreateClient } from "@/lib/clients/resolve";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";

const createTaskSchema = z.object({
  title: z.string().trim().min(3).max(240),
  description: z.string().trim().max(4_000).nullable().optional(),
  clientId: z.uuid().nullable().optional(),
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
    const { data: clientRows, error: clientsError } = await supabase
      .from("clients")
      .select("id, name, color")
      .eq("agency_id", viewer.agencyId)
      .eq("active", true)
      .order("name");
    if (clientsError) throw new ApiError(500, "CLIENTS_LOAD_FAILED", "Não foi possível carregar os clientes.");
    const clients = clientRows ?? [];
    if (input.clientId && !clients.some((client) => client.id === input.clientId)) {
      throw new ApiError(404, "CLIENT_NOT_FOUND", "Cliente não encontrado.");
    }

    let classification;
    try {
      classification = await classifyTask({
        title: input.title,
        description: input.description ?? null,
        clients,
        selectedClientId: input.clientId ?? null,
        estimatedDurationSeconds: input.estimatedDurationSeconds ?? null,
      });
    } catch (error) {
      console.error("Task classification failed", error);
      throw new ApiError(502, "CLASSIFICATION_FAILED", "A classificação automática está indisponível. Tente novamente.");
    }
    const resolvedClient = await resolveOrCreateClient({
      supabase,
      agencyId: viewer.agencyId,
      clients,
      clientId: input.clientId ?? null,
      clientName: classification.clientName,
    });
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        agency_id: viewer.agencyId,
        client_id: resolvedClient.client.id,
        created_by: viewer.id,
        assignee_id: viewer.id,
        title: input.title,
        description: input.description?.trim() || null,
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
          client_resolution_source: resolvedClient.created ? "jarvis_created" : input.clientId ? "user" : "jarvis_matched",
        },
      })
      .select("id")
      .single();
    if (error || !task) throw new ApiError(500, "TASK_CREATE_FAILED", "Não foi possível criar a tarefa.");

    return Response.json({
      task: await getTaskView(task.id),
      client: resolvedClient.client,
      clientCreated: resolvedClient.created,
    }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
