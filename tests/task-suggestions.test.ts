import { describe, expect, it } from "vitest";
import { calculateChecklistScore } from "@/lib/domain/task-suggestions";
import type { TaskSuggestion } from "@/lib/types";

function suggestion(overrides: Partial<TaskSuggestion>): TaskSuggestion {
  return {
    id: crypto.randomUUID(), taskId: crypto.randomUUID(), position: 1,
    title: "Fazer cópia de segurança", description: "Salvar uma cópia antes de alterar.",
    category: "essential", rewardPercentage: 3, omissionPenaltyPercentage: 10,
    evidenceRequired: true, tools: [], status: "pending", evidence: null,
    verificationStatus: "pending", verificationRationale: null, ...overrides,
  };
}

describe("pontuação do checklist do Jarvis", () => {
  it("soma bônus somente dos itens realizados e confirmados", () => {
    const items = [
      suggestion({ position: 1, status: "completed" }),
      suggestion({ position: 2, category: "recommended", rewardPercentage: 2, omissionPenaltyPercentage: 0, status: "completed" }),
    ];
    expect(calculateChecklistScore(items, [
      { position: 1, result: "verified", rationale: "Comprovado." },
      { position: 2, result: "rejected", rationale: "Sem comprovação." },
    ])).toEqual({ percentage: 3, earnedPercentage: 3, penaltyPercentage: 0 });
  });

  it("desconta item essencial pendente e não pune sugestão opcional", () => {
    const items = [
      suggestion({ position: 1 }),
      suggestion({ position: 2, category: "value", rewardPercentage: 5, omissionPenaltyPercentage: 0 }),
    ];
    expect(calculateChecklistScore(items, [])).toEqual({ percentage: -10, earnedPercentage: 0, penaltyPercentage: 10 });
  });

  it("aceita item dispensado somente quando o Jarvis confirma a justificativa", () => {
    const item = suggestion({ status: "not_applicable", evidence: "A página ainda não será publicada." });
    expect(calculateChecklistScore([item], [{ position: 1, result: "not_applicable", rationale: "Não haverá publicação." }]).percentage).toBe(0);
    expect(calculateChecklistScore([item], [{ position: 1, result: "rejected", rationale: "A explicação não procede." }]).percentage).toBe(-10);
  });
});
