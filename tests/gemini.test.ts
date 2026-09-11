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
  getServerEnv: () => ({ GEMINI_API_KEY: "test-gemini-api-key-with-safe-length" }),
}));

import { createGeminiStructuredClient } from "@/lib/ai/gemini";

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
});
