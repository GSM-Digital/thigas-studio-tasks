// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ classifyTask: vi.fn() }));
vi.mock("@/lib/ai/classifier", () => ({
  classifyTask: mocks.classifyTask,
  toJarvisOutput: (value: { complexityLevel: number; basePoints: number; efficiencyAdjustment: number; finalPoints: number; rationale: string }) => ({
    nivel_complexidade: value.complexityLevel,
    pontos_base: value.basePoints,
    bonus_ou_penalidade: `${value.efficiencyAdjustment >= 0 ? "+" : ""}${value.efficiencyAdjustment}`,
    pontuacao_final: value.finalPoints,
    justificativa: value.rationale,
  }),
}));
vi.mock("@/lib/auth", () => ({
  requireViewer: vi.fn().mockResolvedValue({ id: "u", agencyId: "a", role: "developer", name: "Dev" }),
  requireDeveloper: vi.fn(),
}));

import { POST } from "@/app/api/classify/route";

describe("POST /api/classify", () => {
  beforeEach(() => mocks.classifyTask.mockReset());

  it("valida, classifica e responde com o contrato público", async () => {
    mocks.classifyTask.mockResolvedValue({ complexityLevel: 3, basePoints: 25, efficiencyAdjustment: 8, finalPoints: 33, rationale: "Implementação com integrações entregue com eficiência.", model: "gemini-3.8-flash" });
    const response = await POST(new Request("http://localhost/api/classify", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tarefa: "Criar nova landing page", prazo_estimado_segundos: 28800, tempo_real_gasto_segundos: 8000 }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ nivel_complexidade: 3, pontos_base: 25, bonus_ou_penalidade: "+8", pontuacao_final: 33, justificativa: "Implementação com integrações entregue com eficiência." });
    expect(mocks.classifyTask).toHaveBeenCalledWith({ title: "Criar nova landing page", estimatedDurationSeconds: 28800, actualDurationSeconds: 8000 });
  });

  it("retorna 400 sem chamar IA para entrada inválida", async () => {
    const response = await POST(new Request("http://localhost/api/classify", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tarefa: "x", prazo_estimado_segundos: 0 }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.classifyTask).not.toHaveBeenCalled();
  });
});
