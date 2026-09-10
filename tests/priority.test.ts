import { describe, expect, it } from "vitest";
import { calculateTaskUrgency, sortTasksByUrgency } from "@/lib/domain/priority";
import type { TaskView } from "@/lib/types";

function task(
  id: string,
  dueAt: string | null,
  estimatedDurationSeconds: number,
  complexityLevel: 1 | 2 | 3 | 4,
): TaskView {
  return {
    id,
    title: id,
    clientId: "client",
    clientName: "Cliente",
    clientColor: "#000000",
    status: "open",
    completionSummary: null,
    completionRationale: null,
    complexityLevel,
    basePoints: 1,
    efficiencyAdjustment: 0,
    executionAdjustment: 0,
    points: 1,
    estimatedDurationSeconds,
    dueAt,
    completedAt: null,
    activeTimerStartedAt: null,
    trackedSeconds: 0,
    manualDurationSeconds: null,
    classificationStatus: "classified",
  };
}

describe("prioridade inteligente de tarefas", () => {
  const now = new Date("2030-01-02T09:00:00.000Z").getTime();

  it("prioriza a tarefa longa quando duas demandas têm o mesmo prazo", () => {
    const dueAt = "2030-01-03T18:00:00.000Z";
    const short = task("Curta", dueAt, 1800, 1);
    const long = task("Longa", dueAt, 8 * 3600, 3);

    expect(sortTasksByUrgency([short, long], now).map((item) => item.id)).toEqual([
      "Longa",
      "Curta",
    ]);
  });

  it("mantém uma entrega realmente próxima acima de uma tarefa posterior", () => {
    const dueSoon = task("Entrega próxima", "2030-01-02T11:00:00.000Z", 3600, 1);
    const dueTomorrow = task("Entrega amanhã", "2030-01-03T18:00:00.000Z", 8 * 3600, 3);

    expect(sortTasksByUrgency([dueTomorrow, dueSoon], now)[0]?.id).toBe("Entrega próxima");
  });

  it("aplica uma margem maior para tarefas de alta complexidade", () => {
    const dueAt = "2030-01-03T18:00:00.000Z";
    const simple = task("Simples", dueAt, 4 * 3600, 1);
    const complex = task("Complexa", dueAt, 4 * 3600, 4);

    expect(calculateTaskUrgency(complex, now)).toBeGreaterThan(calculateTaskUrgency(simple, now)!);
    expect(sortTasksByUrgency([simple, complex], now)[0]?.id).toBe("Complexa");
  });

  it("coloca tarefas sem prazo no fim sem alterar a coleção original", () => {
    const withoutDeadline = task("Sem prazo", null, 8 * 3600, 4);
    const withDeadline = task("Com prazo", "2030-01-10T18:00:00.000Z", 900, 1);
    const original = [withoutDeadline, withDeadline];

    expect(sortTasksByUrgency(original, now).map((item) => item.id)).toEqual([
      "Com prazo",
      "Sem prazo",
    ]);
    expect(original.map((item) => item.id)).toEqual(["Sem prazo", "Com prazo"]);
  });
});
