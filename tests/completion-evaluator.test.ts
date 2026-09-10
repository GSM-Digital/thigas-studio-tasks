import { describe, expect, it, vi } from "vitest";
import {
  evaluateTaskCompletion,
  type CompletionEvaluationInput,
} from "@/lib/ai/completion-evaluator";
import type { StructuredGenerationClient } from "@/lib/ai/gemini";

const input: CompletionEvaluationInput = {
  title: "Implementar formulário da landing page",
  description: "Integrar o formulário ao CRM e validar os eventos.",
  completionSummary: "A integração foi concluída e validada sem intercorrências fora do escopo.",
  basePoints: 10,
  estimatedDurationSeconds: 7200,
  actualDurationSeconds: 5400,
};

function clientWith(output: Record<string, unknown>): StructuredGenerationClient {
  return { generateStructured: vi.fn().mockResolvedValue(output) };
}

describe("avaliação do relato de conclusão", () => {
  it("não concede bônus para execução normal", async () => {
    const evaluation = await evaluateTaskCompletion(input, clientWith({
      bonus_execucao_percentual: 0,
      justificativa_bonus: "O relato descreve somente a execução e a validação já previstas no escopo original.",
    }), "test-model");

    expect(evaluation).toMatchObject({ percentage: 0, adjustment: 0, model: "test-model" });
  });

  it("converte o percentual do Jarvis em pontos de forma determinística", async () => {
    const evaluation = await evaluateTaskCompletion({ ...input, basePoints: 35 }, clientWith({
      bonus_execucao_percentual: 15,
      justificativa_bonus: "O relato demonstra a resolução de uma falha externa relevante e a prevenção de perda de leads.",
    }), "test-model");

    expect(evaluation).toMatchObject({ percentage: 15, adjustment: 5 });
  });

  it("rejeita percentuais fora das faixas permitidas", async () => {
    await expect(evaluateTaskCompletion(input, clientWith({
      bonus_execucao_percentual: 12,
      justificativa_bonus: "Percentual propositalmente inválido para testar o contrato estruturado da avaliação.",
    }), "test-model")).rejects.toThrow();
  });
});
