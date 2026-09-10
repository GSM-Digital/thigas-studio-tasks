import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
  ThinkingLevel: { LOW: "LOW" },
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
    mocks.generateContent.mockResolvedValue({ text: '{"nivel_complexidade":2}' });
    const client = createGeminiStructuredClient();

    await expect(client.generateStructured({
      model: "gemini-2.5-flash",
      systemInstruction: "Responda somente JSON.",
      prompt: "Configurar GA4",
      responseJsonSchema: {
        type: "object",
        properties: { nivel_complexidade: { type: "integer" } },
      },
    })).resolves.toEqual({ nivel_complexidade: 2 });

    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: "gemini-2.5-flash",
      contents: "Configurar GA4",
      config: expect.objectContaining({
        responseMimeType: "application/json",
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      }),
    }));
  });

  it("falha de forma explícita quando o modelo não retorna conteúdo", async () => {
    mocks.generateContent.mockResolvedValue({ text: "" });
    const client = createGeminiStructuredClient();

    await expect(client.generateStructured({
      model: "gemini-2.5-flash",
      systemInstruction: "Responda somente JSON.",
      prompt: "Teste",
      responseJsonSchema: { type: "object" },
    })).rejects.toThrow("não retornou conteúdo estruturado");
  });
});
