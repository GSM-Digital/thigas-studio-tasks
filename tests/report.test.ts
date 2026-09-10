import { describe, expect, it } from "vitest";
import { generateBillingReport, reportToCsv } from "@/lib/reports/generate";

const tasks = [
  { id: "1", title: "GA4", clientId: "a", clientName: "Make One", completedAt: "2026-08-20T12:00:00.000Z", points: 10, trackedSeconds: 3600, manualDurationSeconds: 2700 },
  { id: "2", title: "Landing", clientId: "a", clientName: "Make One", completedAt: "2026-09-01T12:00:00.000Z", points: 25, trackedSeconds: 7200, manualDurationSeconds: null },
  { id: "3", title: "Fora do ciclo", clientId: "b", clientName: "Norte", completedAt: "2026-09-16T12:00:00.000Z", points: 2, trackedSeconds: 200, manualDurationSeconds: null },
];

describe("relatório de faturamento", () => {
  const report = generateBillingReport({
    tasks,
    periodStart: "2026-08-15T00:00:00.000Z",
    periodEnd: "2026-09-15T00:00:00.000Z",
    pointValueCents: 400,
  });

  it("filtra o período, agrupa cliente e totaliza pontos/valor/tempo", () => {
    expect(report.clients).toHaveLength(1);
    expect(report.totalPoints).toBe(35);
    expect(report.totalAmountCents).toBe(14_000);
    expect(report.totalDurationSeconds).toBe(9_900);
  });

  it("gera CSV compatível com Excel em pt-BR", () => {
    const csv = reportToCsv(report);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Make One;GA4");
  });
});
