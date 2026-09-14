import { describe, expect, it } from "vitest";
import { countOpenTasks } from "@/lib/domain/task-counts";
import type { TaskView } from "@/lib/types";

function task(id: string, clientId: string, status: TaskView["status"]): TaskView {
  return {
    id,
    clientId,
    clientName: clientId,
    clientColor: "#3478f6",
    title: `Demanda ${id}`,
    description: null,
    completionSummary: null,
    completionRationale: null,
    status,
    complexityLevel: 1,
    basePoints: 1,
    efficiencyAdjustment: 0,
    executionAdjustment: 0,
    points: 1,
    estimatedDurationSeconds: 3600,
    dueAt: null,
    completedAt: status === "completed" || status === "approved" ? "2026-09-14T12:00:00.000Z" : null,
    activeTimerStartedAt: null,
    trackedSeconds: 0,
    manualDurationSeconds: null,
    classificationStatus: "classified",
  };
}

describe("contadores de demandas por cliente", () => {
  const tasks = [
    task("1", "neppo", "completed"),
    task("2", "neppo", "approved"),
    task("3", "full-body", "open"),
    task("4", "full-body", "in_progress"),
    task("5", "full-body", "completed"),
  ];

  it("ignora tarefas concluídas e aprovadas", () => {
    expect(countOpenTasks(tasks)).toBe(2);
    expect(countOpenTasks(tasks, "neppo")).toBe(0);
  });

  it("conta tarefas abertas e em andamento do cliente", () => {
    expect(countOpenTasks(tasks, "full-body")).toBe(2);
  });
});
