import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { getServerEnv } from "@/lib/env";

export interface StructuredGenerationRequest {
  model: string;
  systemInstruction: string;
  prompt: string;
  responseJsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface StructuredGenerationClient {
  generateStructured(input: StructuredGenerationRequest): Promise<unknown>;
}

function retryableStatus(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = Number(error.status);
  return status === 408 || status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createGeminiStructuredClient(): StructuredGenerationClient {
  const env = getServerEnv();
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada.");
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  return {
    async generateStructured(input) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await ai.models.generateContent({
            model: input.model,
            contents: input.prompt,
            config: {
              systemInstruction: input.systemInstruction,
              temperature: 0,
              maxOutputTokens: input.maxOutputTokens ?? 700,
              responseMimeType: "application/json",
              responseJsonSchema: input.responseJsonSchema,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              httpOptions: { timeout: input.timeoutMs ?? 15_000 },
            },
          });
          const text = response.text?.trim();
          if (!text) throw new Error("Gemini não retornou conteúdo estruturado.");
          return JSON.parse(text) as unknown;
        } catch (error) {
          lastError = error;
          if (!retryableStatus(error) || attempt === 2) throw error;
          await delay(250 * 2 ** attempt);
        }
      }
      throw lastError;
    },
  };
}
