import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { ApiError, jsonError } from "@/lib/http";
import { generateBillingReport, reportToCsv } from "@/lib/reports/generate";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  periodStart: z.iso.datetime({ offset: true }),
  periodEnd: z.iso.datetime({ offset: true }),
  format: z.enum(["json", "csv"]).default("json"),
});

export async function GET(request: Request) {
  try {
    const viewer = await requireViewer();
    const url = new URL(request.url);
    const query = querySchema.parse({
      periodStart: url.searchParams.get("periodStart"),
      periodEnd: url.searchParams.get("periodEnd"),
      format: url.searchParams.get("format") ?? "json",
    });
    const supabase = await createClient();
    const [agencyResult, tasksResult, clientsResult] = await Promise.all([
      supabase.from("agencies").select("point_value_cents, currency_code").eq("id", viewer.agencyId).single(),
      supabase
        .from("tasks")
        .select("id, title, client_id, completed_at, points, tracked_seconds, manual_duration_seconds")
        .eq("agency_id", viewer.agencyId)
        .in("status", ["completed", "approved"])
        .gte("completed_at", query.periodStart)
        .lt("completed_at", query.periodEnd)
        .order("completed_at"),
      supabase.from("clients").select("id, name").eq("agency_id", viewer.agencyId),
    ]);
    const firstError = agencyResult.error ?? tasksResult.error ?? clientsResult.error;
    if (firstError || !agencyResult.data) {
      throw new ApiError(500, "REPORT_QUERY_FAILED", firstError?.message ?? "Agência não encontrada.");
    }
    const names = new Map((clientsResult.data ?? []).map((client) => [client.id, client.name]));
    const report = generateBillingReport({
      tasks: (tasksResult.data ?? []).flatMap((task) => task.completed_at ? [{
        id: task.id,
        title: task.title,
        clientId: task.client_id,
        clientName: names.get(task.client_id) ?? "Cliente removido",
        completedAt: task.completed_at,
        points: task.points,
        trackedSeconds: task.tracked_seconds,
        manualDurationSeconds: task.manual_duration_seconds,
      }] : []),
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      pointValueCents: agencyResult.data.point_value_cents,
      currencyCode: agencyResult.data.currency_code,
    });

    if (query.format === "csv") {
      return new Response(reportToCsv(report), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="faturamento-${query.periodStart.slice(0, 10)}.csv"`,
        },
      });
    }
    return Response.json({ report });
  } catch (error) {
    return jsonError(error);
  }
}
