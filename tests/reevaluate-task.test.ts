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
    const suggestionQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
    suggestionQuery.select.mockReturnValue(suggestionQuery);
    suggestionQuery.eq.mockReturnValue(suggestionQuery);
    suggestionQuery.order.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValueOnce(readQuery).mockReturnValueOnce(suggestionQuery).mockReturnValueOnce(updateQuery);
    mocks.evaluateTaskCompletion.mockResolvedValue({
      summary: "Resolvi uma incompatibilidade externa no DNS e validei a publicação sem indisponibilidade.",
      percentage: 10,
      adjustment: 3,
      rationale: "O relato comprova a resolução de uma dependência externa relevante sem indisponibilidade.",
      model: "test-model",
      checklistReviews: [],
    });

    await reevaluateCompletedTask(
      "44444444-4444-4444-8444-444444444444",
      "22222222-2222-4222-8222-222222222222",
    );

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      efficiency_adjustment: 0,
      execution_adjustment: 3,
      completion_summary: "Resolvi uma incompatibilidade externa no DNS e validei a publicação sem indisponibilidade.",
      points: 28,
      completion_rationale: "O relato comprova a resolução de uma dependência externa relevante sem indisponibilidade.",
      classification_status: "classified",
      classification_metadata: expect.objectContaining({
        justification: "Classificação original.",
        last_evaluation_error: null,
        completion_raw_notes: "Resolvi uma incompatibilidade externa no DNS e validei a publicação sem indisponibilidade.",
        execution_adjustment_percentage: 10,
        efficiency_percentage: 0,
      }),
    }));
  });

  it("suprime bônus de velocidade e impede pontuação negativa quando a execução é penalizada", async () => {
    const readQuery = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
    readQuery.select.mockReturnValue(readQuery);
    readQuery.eq.mockReturnValue(readQuery);
    readQuery.single.mockResolvedValue({
      data: {
        title: "Implementar landing page",
        description: "Implementar integralmente a página.",
        completion_summary: "Outra pessoa implementou toda a página por mim; eu apenas conferi o link publicado.",
        base_points: 60,
        estimated_duration_seconds: 28_800,
        tracked_seconds: 1_800,
        manual_duration_seconds: null,
        classification_metadata: {},
      },
      error: null,
    });
    const updateQuery = { update: vi.fn(), eq: vi.fn() };
    updateQuery.update.mockReturnValue(updateQuery);
    updateQuery.eq.mockReturnValueOnce(updateQuery).mockResolvedValueOnce({ error: null });
    const suggestionQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
    suggestionQuery.select.mockReturnValue(suggestionQuery);
    suggestionQuery.eq.mockReturnValue(suggestionQuery);
    suggestionQuery.order.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValueOnce(readQuery).mockReturnValueOnce(suggestionQuery).mockReturnValueOnce(updateQuery);
    mocks.evaluateTaskCompletion.mockResolvedValue({
      summary: "Outra pessoa implementou toda a página; eu apenas conferi o link publicado.",
      percentage: -100,
      adjustment: -60,
      rationale: "O relato declara que o desenvolvedor não executou a implementação.",
      model: "test-model",
      checklistReviews: [],
    });

    await reevaluateCompletedTask(
      "44444444-4444-4444-8444-444444444444",
      "22222222-2222-4222-8222-222222222222",
    );

    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      efficiency_adjustment: 0,
      execution_adjustment: -60,
      points: 0,
      classification_metadata: expect.objectContaining({
        execution_adjustment_percentage: -100,
        calculated_efficiency_percentage: 40,
        efficiency_bonus_suppressed: true,
      }),
    }));
  });

  it("aplica o desconto essencial do checklist e não deixa um bônus geral escondê-lo", async () => {
    const readQuery = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
    readQuery.select.mockReturnValue(readQuery); readQuery.eq.mockReturnValue(readQuery);
    readQuery.single.mockResolvedValue({ data: {
      title: "Migrar landing page", description: "Migrar sem perda de dados.", completion_summary: "Migrei a página, mas não fiz a cópia de segurança.",
      base_points: 20, estimated_duration_seconds: 7200, tracked_seconds: 1200, manual_duration_seconds: null, classification_metadata: {},
    }, error: null });
    const suggestionRow = {
      id: "55555555-5555-4555-8555-555555555555", task_id: "44444444-4444-4444-8444-444444444444", position: 1,
      title: "Fazer cópia de segurança", description: "Salvar os dados antes de migrar.", category: "essential", reward_percentage: 3,
      omission_penalty_percentage: 10, evidence_required: true, tools: [], status: "pending", evidence: null,
      verification_status: "pending", verification_rationale: null,
    };
    const suggestionRead = { select: vi.fn(), eq: vi.fn(), order: vi.fn().mockResolvedValue({ data: [suggestionRow], error: null }) };
    suggestionRead.select.mockReturnValue(suggestionRead); suggestionRead.eq.mockReturnValue(suggestionRead);
    const taskUpdate = { update: vi.fn(), eq: vi.fn() };
    taskUpdate.update.mockReturnValue(taskUpdate); taskUpdate.eq.mockReturnValueOnce(taskUpdate).mockResolvedValueOnce({ error: null });
    const suggestionUpdate = { update: vi.fn(), eq: vi.fn() };
    suggestionUpdate.update.mockReturnValue(suggestionUpdate); suggestionUpdate.eq.mockReturnValueOnce(suggestionUpdate).mockResolvedValueOnce({ error: null });
    mocks.from.mockReturnValueOnce(readQuery).mockReturnValueOnce(suggestionRead).mockReturnValueOnce(taskUpdate).mockReturnValueOnce(suggestionUpdate);
    mocks.evaluateTaskCompletion.mockResolvedValue({
      summary: "Migrei a página, mas não fiz a cópia de segurança.", percentage: 5, adjustment: 1,
      rationale: "O relato descreve uma pequena melhoria adicional.", model: "test-model",
      checklistReviews: [{ position: 1, result: "rejected", rationale: "A cópia de segurança não foi realizada." }],
    });

    await reevaluateCompletedTask("44444444-4444-4444-8444-444444444444", "22222222-2222-4222-8222-222222222222");

    expect(taskUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      efficiency_adjustment: 0, execution_adjustment: -2, points: 18,
      classification_metadata: expect.objectContaining({ narrative_adjustment_percentage: 0, checklist_penalty_percentage: 10, execution_adjustment_percentage: -10 }),
    }));
    expect(suggestionUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ verification_status: "rejected", verification_rationale: "A cópia de segurança não foi realizada." }));
  });
});
