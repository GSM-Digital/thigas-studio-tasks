import { describe, expect, it } from "vitest";
import { groupTasksByDeadline } from "@/lib/domain/task-groups";
import type { TaskView } from "@/lib/types";

function task(id: string, dueAt: string | null, estimatedDurationSeconds = 3_600): TaskView {
  return {
    id,
    title: id,
    description: null,
    completionSummary: null,
    completionRationale: null,
    clientId: "client-1",
    clientName: "Cliente",
    clientColor: "#007aff",
    status: "open",
    complexityLevel: 2,
    basePoints: 8,
    efficiencyAdjustment: 0,
    executionAdjustment: 0,
    points: 8,
    estimatedDurationSeconds,
    dueAt,
    completedAt: null,
    activeTimerStartedAt: null,
    trackedSeconds: 0,
    manualDurationSeconds: null,
    classificationStatus: "classified",
  };
}

describe("groupTasksByDeadline", () => {
  const now = new Date("2026-09-10T12:00:00-03:00");
  const timeZone = "America/Sao_Paulo";

  it("separa tarefas em datas relativas no estilo Lembretes", () => {
    const groups = groupTasksByDeadline([
      task("sem prazo", null),
      task("futura", "2026-09-15T18:00:00-03:00"),
      task("depois", "2026-09-12T18:00:00-03:00"),
      task("amanhã", "2026-09-11T18:00:00-03:00"),
      task("hoje", "2026-09-10T18:00:00-03:00"),
      task("atrasada", "2026-09-09T18:00:00-03:00"),
    ], now, timeZone);

    expect(groups.map(({ kind }) => kind)).toEqual([
      "overdue",
      "today",
      "tomorrow",
      "day-after-tomorrow",
      "future",
      "no-deadline",
    ]);
    expect(groups.map(({ label }) => label)).toEqual([
      "Atrasadas",
      "Hoje",
      "Amanhã",
      "Depois de amanhã",
      "Terça-feira, 15 de setembro",
      "Sem prazo",
    ]);
  });

  it("mantém a prioridade inteligente dentro do mesmo dia", () => {
    const groups = groupTasksByDeadline([
      task("curta", "2026-09-11T18:00:00-03:00", 900),
      task("longa", "2026-09-11T18:00:00-03:00", 28_800),
    ], now, timeZone);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tasks.map(({ id }) => id)).toEqual(["longa", "curta"]);
  });
});
