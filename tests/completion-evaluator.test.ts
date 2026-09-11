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
    const client = clientWith({
      resumo_conclusao: "Concluí a integração e validei o funcionamento previsto no escopo.",
      ajuste_execucao_percentual: 0,
      justificativa_ajuste: "O relato descreve somente a execução e a validação já previstas no escopo original.",
    });
    const evaluation = await evaluateTaskCompletion(input, client, "test-model");

    expect(evaluation).toMatchObject({
      summary: "Concluí a integração e validei o funcionamento previsto no escopo.",
      percentage: 0,
      adjustment: 0,
      model: "test-model",
    });
    expect(client.generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      operation: "completion_evaluation",
      maxOutputTokens: 600,
      prompt: expect.not.stringMatching(/Pontos base:|SLA:|Tempo real:/),
    }));
  });

  it("converte o percentual do Jarvis em pontos de forma determinística", async () => {
    const evaluation = await evaluateTaskCompletion({ ...input, basePoints: 35 }, clientWith({
      resumo_conclusao: "Resolvi uma falha externa relevante e validei a integração sem perda de leads.",
      ajuste_execucao_percentual: 15,
      justificativa_ajuste: "O relato demonstra a resolução de uma falha externa relevante e a prevenção de perda de leads.",
    }), "test-model");

    expect(evaluation).toMatchObject({ percentage: 15, adjustment: 5 });
  });

  it("aplica penalidade quando o relato informa execução substancial por outra pessoa", async () => {
    const evaluation = await evaluateTaskCompletion({ ...input, basePoints: 10 }, clientWith({
      resumo_conclusao: "A maior parte da implementação foi realizada por outra pessoa; eu apenas validei a entrega.",
      ajuste_execucao_percentual: -70,
      justificativa_ajuste: "O relato informa que outra pessoa realizou a maior parte da implementação e que o desenvolvedor apenas validou a entrega.",
    }), "test-model");

    expect(evaluation).toMatchObject({ percentage: -70, adjustment: -7 });
  });

  it("não penaliza o uso responsável de IA", async () => {
    const evaluation = await evaluateTaskCompletion(input, clientWith({
      resumo_conclusao: "Usei IA sob minha condução e revisei, testei e validei integralmente a entrega.",
      ajuste_execucao_percentual: 0,
      justificativa_ajuste: "O uso de IA foi acompanhado de revisão, testes e validação pelo desenvolvedor, sem falhas ou perda de autoria.",
    }), "test-model");

    expect(evaluation).toMatchObject({ percentage: 0, adjustment: 0 });
  });

  it("rejeita percentuais fora das faixas permitidas", async () => {
    await expect(evaluateTaskCompletion(input, clientWith({
      resumo_conclusao: "Concluí e validei a integração prevista no escopo original da tarefa.",
      ajuste_execucao_percentual: 12,
      justificativa_ajuste: "Percentual propositalmente inválido para testar o contrato estruturado da avaliação.",
    }), "test-model")).rejects.toThrow();
  });
});
