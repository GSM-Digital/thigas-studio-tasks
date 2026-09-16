import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { ApiError, jsonError } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { TaskView } from "@/lib/types";

const querySchema = z.object({
  periodStart: z.iso.datetime({ offset: true }),
  periodEnd: z.iso.datetime({ offset: true }),
}).refine(({ periodStart, periodEnd }) => {
  const duration = Date.parse(periodEnd) - Date.parse(periodStart);
  return duration > 0 && duration <= 370 * 86_400_000;
}, "Informe um período válido de até um ano.");

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer();
    const params = new URL(request.url).searchParams;
    const { periodStart, periodEnd } = querySchema.parse(Object.fromEntries(params));
    const supabase = await createClient();
    const { data: clients, error: clientsError } = await supabase.from("clients")
      .select("id, name, color").eq("agency_id", viewer.agencyId);
    if (clientsError) throw new ApiError(500, "REPORT_QUERY_FAILED", "Não foi possível carregar os clientes do período.");
    const names = new Map((clients ?? []).map((client) => [client.id, client]));
    const rows: Database["public"]["Tables"]["tasks"]["Row"][] = [];
    // Fetch every page: historical reports must not inherit the workspace's 500-task cap.
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("tasks").select("*")
        .eq("agency_id", viewer.agencyId).in("status", ["completed", "approved"])
        .gte("completed_at", periodStart).lt("completed_at", periodEnd)
        .order("completed_at").order("id").range(offset, offset + pageSize - 1);
      if (error) throw new ApiError(500, "REPORT_QUERY_FAILED", "Não foi possível carregar as entregas do período. Tente novamente.");
      rows.push(...(data ?? []));
      if ((data ?? []).length < pageSize) break;
    }
    const tasks: TaskView[] = rows.map((task) => ({
      id: task.id, title: task.title, description: task.description,
      completionSummary: task.completion_summary, completionRationale: task.completion_rationale,
      clientId: task.client_id, clientName: names.get(task.client_id)?.name ?? "Cliente removido",
      clientColor: names.get(task.client_id)?.color ?? "#8e8e93", status: task.status,
      complexityLevel: task.complexity_level, basePoints: task.base_points,
      efficiencyAdjustment: task.efficiency_adjustment, executionAdjustment: task.execution_adjustment,
      points: task.points, estimatedDurationSeconds: task.estimated_duration_seconds,
      dueAt: task.due_at, completedAt: task.completed_at, activeTimerStartedAt: null,
      trackedSeconds: task.tracked_seconds, manualDurationSeconds: task.manual_duration_seconds,
      classificationStatus: task.classification_status,
    }));
    return Response.json({ tasks }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
