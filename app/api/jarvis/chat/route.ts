import { z } from "zod";
import {
  interpretJarvisConversation,
  type JarvisChatMessage,
} from "@/lib/ai/jarvis-chat";
import { createAiErrorDiagnostic } from "@/lib/ai/error-diagnostics";
import { logAiError } from "@/lib/ai/task-evaluation-error";
import { requireDeveloper, requireViewer } from "@/lib/auth";
import { resolveOrCreateClient } from "@/lib/clients/resolve";
import { ApiError, jsonError, parseJson } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import { getTaskView } from "@/lib/task-view";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(800),
});

const inputSchema = z.object({
  messages: z.array(messageSchema).min(1).max(12).refine(
    (messages) => messages.at(-1)?.role === "user",
    "A última mensagem deve ser do usuário.",
  ),
});

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    requireDeveloper(viewer);
    const input = await parseJson(request, inputSchema);
    const supabase = await createClient();
    const [agencyResult, clientsResult] = await Promise.all([
      supabase
        .from("agencies")
        .select("timezone")
        .eq("id", viewer.agencyId)
        .single(),
      supabase
        .from("clients")
        .select("id, name, color")
        .eq("agency_id", viewer.agencyId)
        .eq("active", true)
        .order("name"),
    ]);

    if (agencyResult.error || !agencyResult.data) {
      throw new ApiError(500, "AGENCY_LOAD_FAILED", "Não foi possível carregar a agência.");
    }
    if (clientsResult.error) {
      throw new ApiError(500, "CLIENTS_LOAD_FAILED", "Não foi possível carregar os clientes.");
    }
    const clients = clientsResult.data ?? [];
    let decision;
    try {
      decision = await interpretJarvisConversation(
        input.messages as JarvisChatMessage[],
        clients.map((client) => ({ id: client.id, name: client.name, color: client.color })),
        { timezone: agencyResult.data.timezone },
      );
    } catch (error) {
      const diagnostic = createAiErrorDiagnostic(error);
      logAiError("Jarvis conversation failed", diagnostic);
      throw new ApiError(
        diagnostic.category === "quota_exhausted" || diagnostic.category === "rate_limited" ? 429 : 503,
        diagnostic.code,
        diagnostic.message,
        { diagnostic },
      );
    }

    if (decision.action === "ask") {
      return Response.json({ message: decision.message, task: null, client: null, clientCreated: false });
    }

    const draft = decision.task;
    const resolvedClient = await resolveOrCreateClient({
      supabase,
      agencyId: viewer.agencyId,
      clients,
      clientId: draft.clientId,
      clientName: draft.clientName,
    });
    const { data: task, error } = await supabase
      .from("tasks")
      .insert({
        agency_id: viewer.agencyId,
        client_id: resolvedClient.client.id,
        created_by: viewer.id,
        assignee_id: viewer.id,
        title: draft.title,
        description: draft.description,
        status: "open",
        complexity_level: draft.classification.complexityLevel,
        base_points: draft.classification.basePoints,
        efficiency_adjustment: 0,
        points: draft.classification.finalPoints,
        estimated_duration_seconds: draft.estimatedDurationSeconds,
        due_at: draft.dueAt,
        classification_status: "classified",
        ai_model: draft.classification.model,
        classification_metadata: {
          analyst: "Jarvis",
          source: "jarvis_chat",
          justification: draft.classification.rationale,
          estimated_duration_source: "jarvis_chat",
          client_resolution_source: resolvedClient.created ? "jarvis_created" : "jarvis_matched",
        },
      })
      .select("id")
      .single();

    if (error || !task) {
      console.error("Jarvis task persistence failed", error);
      throw new ApiError(500, "TASK_CREATE_FAILED", "O Jarvis entendeu a demanda, mas não conseguiu salvá-la.");
    }

    const taskView = await getTaskView(task.id);
    return Response.json({
      message: `Demanda adicionada: “${taskView.title}” para ${taskView.clientName}, com nível ${taskView.complexityLevel} e ${taskView.points} pontos.`,
      task: taskView,
      client: resolvedClient.client,
      clientCreated: resolvedClient.created,
    }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
