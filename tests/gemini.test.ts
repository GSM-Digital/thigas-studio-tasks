import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
  ThinkingLevel: { MINIMAL: "MINIMAL" },
}));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    GEMINI_API_KEY: "test-gemini-api-key-with-safe-length",
    GEMINI_CLASSIFICATION_MODEL: "gemini-3.6-flash",
    GEMINI_FALLBACK_MODEL: "gemini-3.5-flash",
    GEMINI_FALLBACK_COOLDOWN_HOURS: 24,
  }),
}));

import { createGeminiStructuredClient } from "@/lib/ai/gemini";
import type { AiModelFailoverStore } from "@/lib/ai/model-failover";

const request = {
  operation: "task_classification" as const,
  model: "gemini-3.6-flash",
  systemInstruction: "Responda somente JSON.",
  prompt: "Configurar GA4",
  responseJsonSchema: { type: "object" },
};

function failoverStore(state: Awaited<ReturnType<AiModelFailoverStore["read"]>> = null) {
  return {
    read: vi.fn().mockResolvedValue(state),
    activate: vi.fn().mockResolvedValue(undefined),
    markRecovered: vi.fn().mockResolvedValue(undefined),
  } satisfies AiModelFailoverStore;
}

describe("cliente estruturado do Gemini", () => {
  beforeEach(() => {
    mocks.generateContent.mockReset();
  });

  it("solicita JSON estruturado e converte a resposta", async () => {
    mocks.generateContent.mockResolvedValue({
      text: '{"nivel_complexidade":2}',
      usageMetadata: {
        promptTokenCount: 180,
        candidatesTokenCount: 32,
        thoughtsTokenCount: 8,
        cachedContentTokenCount: 0,
        totalTokenCount: 220,
      },
    });
    const usageLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const client = createGeminiStructuredClient();

    await expect(client.generateStructured({
      operation: "task_classification",
      model: "gemini-3.6-flash",
      systemInstruction: "Responda somente JSON.",
      prompt: "Configurar GA4",
      responseJsonSchema: {
        type: "object",
        properties: { nivel_complexidade: { type: "integer" } },
      },
    })).resolves.toEqual({ nivel_complexidade: 2 });

    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-3.6-flash",
      contents: "Configurar GA4",
      config: expect.objectContaining({
        responseMimeType: "application/json",
        temperature: 0,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
      }),
    }));
    expect(usageLog).toHaveBeenCalledWith("Jarvis AI usage", {
      operation: "task_classification",
      model: "gemini-3.6-flash",
      promptTokens: 180,
      outputTokens: 32,
      thoughtTokens: 8,
      cachedTokens: 0,
      totalTokens: 220,
    });
    usageLog.mockRestore();
  });

  it("falha de forma explícita quando o modelo não retorna conteúdo", async () => {
    mocks.generateContent.mockResolvedValue({ text: "" });
    const client = createGeminiStructuredClient();

    await expect(client.generateStructured({
      operation: "task_classification",
      model: "gemini-3.6-flash",
      systemInstruction: "Responda somente JSON.",
      prompt: "Teste",
      responseJsonSchema: { type: "object" },
    })).rejects.toThrow("não retornou conteúdo estruturado");
  });

  it("troca imediatamente para o modelo reserva quando a cota do principal acaba", async () => {
    mocks.generateContent
      .mockRejectedValueOnce(Object.assign(new Error("RESOURCE_EXHAUSTED: daily quota exceeded"), { status: 429 }))
      .mockResolvedValueOnce({ text: '{"ok":true}' });
    const store = failoverStore();
    const onModelUsed = vi.fn();
    const now = new Date("2026-09-11T15:00:00.000Z");
    const client = createGeminiStructuredClient({ failoverStore: store, now: () => now });

    await expect(client.generateStructured({ ...request, onModelUsed })).resolves.toEqual({ ok: true });

    expect(mocks.generateContent.mock.calls.map(([input]) => input.model)).toEqual([
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]);
    expect(onModelUsed).toHaveBeenLastCalledWith("gemini-3.5-flash");
    expect(store.activate).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gemini",
      primaryModel: "gemini-3.6-flash",
      fallbackModel: "gemini-3.5-flash",
      fallbackUntil: "2026-09-12T15:00:00.000Z",
      errorCode: "RESOURCE_EXHAUSTED",
    }));
  });

  it("usa diretamente o modelo reserva durante as 24 horas de espera", async () => {
    mocks.generateContent.mockResolvedValue({ text: '{"ok":true}' });
    const store = failoverStore({
      primaryModel: "gemini-3.6-flash",
      fallbackModel: "gemini-3.5-flash",
      fallbackUntil: "2026-09-12T15:00:00.000Z",
    });
    const client = createGeminiStructuredClient({
      failoverStore: store,
      now: () => new Date("2026-09-11T18:00:00.000Z"),
    });

    await client.generateStructured(request);

    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.5-flash" }));
    expect(store.activate).not.toHaveBeenCalled();
  });

  it("testa o principal novamente após 24 horas e registra a recuperação", async () => {
    mocks.generateContent.mockResolvedValue({ text: '{"ok":true}' });
    const store = failoverStore({
      primaryModel: "gemini-3.6-flash",
      fallbackModel: "gemini-3.5-flash",
      fallbackUntil: "2026-09-12T15:00:00.000Z",
    });
    const client = createGeminiStructuredClient({
      failoverStore: store,
      now: () => new Date("2026-09-12T15:00:01.000Z"),
    });

    await client.generateStructured(request);

    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.6-flash" }));
    expect(store.markRecovered).toHaveBeenCalledWith({
      provider: "gemini",
      recoveredAt: "2026-09-12T15:00:01.000Z",
    });
  });

  it("não troca de modelo quando a falha não é de cota", async () => {
    mocks.generateContent.mockRejectedValue(new Error("JSON inválido"));
    const store = failoverStore();
    const client = createGeminiStructuredClient({ failoverStore: store });

    await expect(client.generateStructured(request)).rejects.toThrow("JSON inválido");

    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(store.activate).not.toHaveBeenCalled();
  });
});
