import { createClient } from "@/lib/supabase/server";
import type { ClientSummary, TaskView, Viewer, WorkspaceSettings } from "@/lib/types";

export async function loadWorkspace(viewer: Viewer): Promise<{
  clients: ClientSummary[];
  tasks: TaskView[];
  settings: WorkspaceSettings;
}> {
  const supabase = await createClient();
  const [agencyResult, clientsResult, tasksResult, timersResult] = await Promise.all([
    supabase
      .from("agencies")
      .select("name, currency_code, point_value_cents, timezone")
      .eq("id", viewer.agencyId)
      .single(),
    supabase
      .from("clients")
      .select("id, name, color, active")
      .eq("agency_id", viewer.agencyId)
      .order("name"),
    supabase
      .from("tasks")
      .select(
        "id, title, description, client_id, status, complexity_level, base_points, efficiency_adjustment, points, estimated_duration_seconds, due_at, completed_at, tracked_seconds, manual_duration_seconds, classification_status, created_at",
      )
      .eq("agency_id", viewer.agencyId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("time_entries")
      .select("task_id, started_at")
      .eq("agency_id", viewer.agencyId)
      .is("stopped_at", null),
  ]);

  const firstError =
    agencyResult.error ?? clientsResult.error ?? tasksResult.error ?? timersResult.error;
  if (firstError) throw new Error(`Falha ao carregar workspace: ${firstError.message}`);
  if (!agencyResult.data) throw new Error("Agência não encontrada.");

  const allClients: ClientSummary[] = (clientsResult.data ?? []).map((client) => ({
    id: client.id,
    name: client.name,
    color: client.color,
  }));
  const activeClientIds = new Set(
    (clientsResult.data ?? []).filter((client) => client.active).map((client) => client.id),
  );
  const clients = allClients.filter((client) => activeClientIds.has(client.id));
  const clientMap = new Map(allClients.map((client) => [client.id, client]));
  const timerMap = new Map(
    (timersResult.data ?? []).map((timer) => [timer.task_id, timer.started_at]),
  );
  const tasks: TaskView[] = (tasksResult.data ?? []).map((task) => {
    const client = clientMap.get(task.client_id);
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      clientId: task.client_id,
      clientName: client?.name ?? "Cliente removido",
      clientColor: client?.color ?? "#8e8e93",
      status: task.status,
      complexityLevel: task.complexity_level,
      basePoints: task.base_points,
      efficiencyAdjustment: task.efficiency_adjustment,
      points: task.points,
      estimatedDurationSeconds: task.estimated_duration_seconds,
      dueAt: task.due_at,
      completedAt: task.completed_at,
      activeTimerStartedAt: timerMap.get(task.id) ?? null,
      trackedSeconds: task.tracked_seconds,
      manualDurationSeconds: task.manual_duration_seconds,
      classificationStatus: task.classification_status,
    };
  });

  return {
    clients,
    tasks,
    settings: {
      agencyName: agencyResult.data.name,
      currencyCode: agencyResult.data.currency_code,
      pointValueCents: agencyResult.data.point_value_cents,
      timezone: agencyResult.data.timezone,
    },
  };
}
