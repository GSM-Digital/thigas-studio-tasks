// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  evaluateTaskCompletion: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({ from: mocks.from })),
}));
vi.mock("@/lib/ai/completion-evaluator", () => ({
  evaluateTaskCompletion: mocks.evaluateTaskCompletion,
}));

import { reevaluateCompletedTask } from "@/lib/ai/reevaluate-task";

describe("reavaliação final da tarefa", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.evaluateTaskCompletion.mockReset();
  });

  it("combina eficiência e bônus do relato sem alterar os pontos-base", async () => {
    const readQuery = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
    readQuery.select.mockReturnValue(readQuery);
    readQuery.eq.mockReturnValue(readQuery);
    readQuery.single.mockResolvedValue({
      data: {
        title: "Migrar landing page",
        description: "Migrar e validar os formulários.",
        completion_summary: "Resolvi uma incompatibilidade externa no DNS e validei a publicação sem indisponibilidade.",
        base_points: 25,
        estimated_duration_seconds: 7200,
        tracked_seconds: 3600,
        manual_duration_seconds: null,
        classification_metadata: { justification: "Classificação original." },
      },
      error: null,
    });
    const updateQuery = { update: vi.fn(), eq: vi.fn() };
    updateQuery.update.mockReturnValue(updateQuery);
    updateQuery.eq.mockReturnValueOnce(updateQuery).mockResolvedValueOnce({ error: null });
    mocks.from.mockReturnValueOnce(readQuery).mockReturnValueOnce(updateQuery);
    mocks.evaluateTaskCompletion.mockResolvedValue({
      percentage: 10,
      adjustment: 3,
      rationale: "O relato comprova a resolução de uma dependência externa relevante sem indisponibilidade.",
      model: "test-model",
    });

    await reevaluateCompletedTask(
      "44444444-4444-4444-8444-444444444444",
      "22222222-2222-4222-8222-222222222222",
    );

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      efficiency_adjustment: 0,
      execution_adjustment: 3,
      points: 28,
      completion_rationale: "O relato comprova a resolução de uma dependência externa relevante sem indisponibilidade.",
      classification_status: "classified",
      classification_metadata: expect.objectContaining({
        justification: "Classificação original.",
        execution_bonus_percentage: 10,
        efficiency_percentage: 0,
      }),
    }));
  });
});
