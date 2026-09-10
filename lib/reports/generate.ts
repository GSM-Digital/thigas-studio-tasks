import { calculateAmountCents } from "@/lib/domain/points";
import type { BillingReport, BillingReportTask } from "@/lib/types";

export interface ReportSourceTask {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  completedAt: string;
  points: number;
  trackedSeconds: number;
  manualDurationSeconds: number | null;
}

export interface GenerateReportInput {
  tasks: ReportSourceTask[];
  periodStart: string;
  periodEnd: string;
  pointValueCents: number;
  currencyCode?: "BRL";
}

export function generateBillingReport(input: GenerateReportInput): BillingReport {
  const start = Date.parse(input.periodStart);
  const end = Date.parse(input.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new RangeError("Período de faturamento inválido.");
  }

  const byClient = new Map<string, BillingReport["clients"][number]>();
  const eligible = input.tasks.filter((task) => {
    const completedAt = Date.parse(task.completedAt);
    return completedAt >= start && completedAt < end;
  });

  for (const task of eligible) {
    const reportTask: BillingReportTask = {
      id: task.id,
      title: task.title,
      completedAt: task.completedAt,
      points: task.points,
      amountCents: calculateAmountCents(task.points, input.pointValueCents),
      durationSeconds: task.manualDurationSeconds ?? task.trackedSeconds,
    };
    const client = byClient.get(task.clientId) ?? {
      clientId: task.clientId,
      clientName: task.clientName,
      tasks: [],
      totalPoints: 0,
      totalAmountCents: 0,
      totalDurationSeconds: 0,
    };
    client.tasks.push(reportTask);
    client.totalPoints += reportTask.points;
    client.totalAmountCents += reportTask.amountCents;
    client.totalDurationSeconds += reportTask.durationSeconds;
    byClient.set(task.clientId, client);
  }

  const clients = [...byClient.values()]
    .map((client) => ({
      ...client,
      tasks: client.tasks.sort((a, b) => a.completedAt.localeCompare(b.completedAt)),
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currencyCode: input.currencyCode ?? "BRL",
    pointValueCents: input.pointValueCents,
    clients,
    totalPoints: clients.reduce((sum, client) => sum + client.totalPoints, 0),
    totalAmountCents: clients.reduce((sum, client) => sum + client.totalAmountCents, 0),
    totalDurationSeconds: clients.reduce(
      (sum, client) => sum + client.totalDurationSeconds,
      0,
    ),
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[";,\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reportToCsv(report: BillingReport): string {
  const rows: Array<Array<string | number>> = [
    ["Cliente", "Tarefa", "Conclusão", "Pontos", "Valor (centavos)", "Tempo (segundos)"],
  ];
  for (const client of report.clients) {
    for (const task of client.tasks) {
      rows.push([
        client.clientName,
        task.title,
        task.completedAt,
        task.points,
        task.amountCents,
        task.durationSeconds,
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`;
}
