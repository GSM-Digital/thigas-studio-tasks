import { describe, expect, it, vi } from "vitest";
import { classifyTask, toJarvisOutput, type ClassifierClient } from "@/lib/ai/classifier";

function clientWith(output: Record<string, unknown>): ClassifierClient {
  return { generateStructured: vi.fn().mockResolvedValue(output) };
}

describe("avaliação do Jarvis", () => {
  it("aceita Structured Output e normaliza a eficiência no servidor", async () => {
    const classification = await classifyTask(
      { title: "Configurar GA4", estimatedDurationSeconds: 7200, actualDurationSeconds: 1200 },
      clientWith({
        nivel_complexidade: 2,
        pontos_base: 10,
        bonus_ou_penalidade: "+1",
        pontuacao_final: 11,
        justificativa: "Configuração moderada concluída muito abaixo do prazo estimado.",
      }),
      "gemini-3.8-flash",
    );

    expect(classification).toMatchObject({
      complexityLevel: 2,
      basePoints: 10,
      efficiencyAdjustment: 4,
      finalPoints: 14,
      model: "gemini-3.8-flash",
    });
    expect(toJarvisOutput(classification)).toMatchObject({
      nivel_complexidade: 2,
      pontos_base: 10,
      bonus_ou_penalidade: "+4",
      pontuacao_final: 14,
    });
  });

  it("mantém pontos base quando o tempo real ainda não existe", async () => {
    await expect(classifyTask(
      { title: "Implementar formulário", estimatedDurationSeconds: 7200 },
      clientWith({
        nivel_complexidade: 2,
        pontos_base: 12,
        bonus_ou_penalidade: "+0",
        pontuacao_final: 12,
        justificativa: "Implementação moderada sem tempo real informado até o momento.",
      }),
      "test-model",
    )).resolves.toMatchObject({ finalPoints: 12, efficiencyAdjustment: 0 });
  });

  it("rejeita nível e pontos base incompatíveis mesmo com JSON válido", async () => {
    const client = clientWith({
      nivel_complexidade: 1,
      pontos_base: 50,
      bonus_ou_penalidade: "+0",
      pontuacao_final: 50,
      justificativa: "Pontuação propositalmente incompatível para validar o contrato.",
    });
    await expect(classifyTask(
      { title: "Ajustar texto", estimatedDurationSeconds: 1800 },
      client,
      "test-model",
    )).rejects.toThrow("faixa");
  });
});
