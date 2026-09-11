import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { getServerEnv } from "@/lib/env";
import {
  createAiModelFailoverStore,
  type AiModelFailoverStore,
} from "@/lib/ai/model-failover";

export interface StructuredGenerationRequest {
  operation: "task_classification" | "jarvis_chat" | "completion_evaluation" | "task_suggestions";
  model: string;
  systemInstruction: string;
  prompt: string;
  responseJsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
  onModelUsed?: (model: string) => void;
}

export interface StructuredGenerationClient {
  generateStructured(input: StructuredGenerationRequest): Promise<unknown>;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = Number(error.status);
  return Number.isInteger(status) ? status : null;
}

function retryableStatus(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 408 || (status !== null && status >= 500);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

export function isGeminiQuotaError(error: unknown): boolean {
  const status = errorStatus(error);
  const message = errorText(error);
  return status === 429 || /RESOURCE_EXHAUSTED|quota[_\s-]*(?:exceeded|exhausted)|rate[_\s-]*limit/i.test(message);
}

function quotaErrorCode(error: unknown): string {
  return errorText(error).match(/\b(RESOURCE_EXHAUSTED|quota_exceeded|rate_limit_exceeded)\b/i)?.[1]?.toUpperCase()
    ?? (errorStatus(error) === 429 ? "HTTP_429" : "QUOTA_EXHAUSTED");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function thinkingConfigFor(model: string) {
  return model.startsWith("gemini-2.5-")
    ? { thinkingBudget: 0 }
    : { thinkingLevel: ThinkingLevel.MINIMAL };
}

export function createGeminiStructuredClient(options: {
  failoverStore?: AiModelFailoverStore;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
} = {}): StructuredGenerationClient {
  const env = getServerEnv();
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY não configurada.");
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const primaryModel = env.GEMINI_CLASSIFICATION_MODEL ?? "gemini-3.6-flash";
  const fallbackModel = env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash";
  const cooldownHours = env.GEMINI_FALLBACK_COOLDOWN_HOURS ?? 24;
  const store = options.failoverStore ?? createAiModelFailoverStore();
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? delay;

  async function generateWithModel(input: StructuredGenerationRequest, selectedModel: string) {
    input.onModelUsed?.(selectedModel);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: input.prompt,
          config: {
            systemInstruction: input.systemInstruction,
            temperature: 0,
            maxOutputTokens: input.maxOutputTokens ?? 700,
            responseMimeType: "application/json",
            responseJsonSchema: input.responseJsonSchema,
            thinkingConfig: thinkingConfigFor(selectedModel),
            httpOptions: { timeout: input.timeoutMs ?? 15_000 },
          },
        });
        const usage = response.usageMetadata;
        if (usage) {
          console.info("Jarvis AI usage", {
            operation: input.operation,
            model: selectedModel,
            promptTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
            thoughtTokens: usage.thoughtsTokenCount ?? 0,
            cachedTokens: usage.cachedContentTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          });
        }
        const text = response.text?.trim();
        if (!text) throw new Error("Gemini não retornou conteúdo estruturado.");
        return JSON.parse(text) as unknown;
      } catch (error) {
        lastError = error;
        if (isGeminiQuotaError(error) || !retryableStatus(error) || attempt === 2) throw error;
        await sleep(250 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  return {
    async generateStructured(input) {
      const failoverEnabled = input.model === primaryModel && fallbackModel !== primaryModel;
      if (!failoverEnabled) return generateWithModel(input, input.model);

      const currentTime = now();
      const state = await store.read("gemini");
      const fallbackActive = state?.primaryModel === primaryModel
        && state.fallbackModel === fallbackModel
        && state.fallbackUntil !== null
        && new Date(state.fallbackUntil).getTime() > currentTime.getTime();

      if (fallbackActive) return generateWithModel(input, fallbackModel);

      try {
        const output = await generateWithModel(input, primaryModel);
        if (state?.fallbackUntil) {
          await store.markRecovered({ provider: "gemini", recoveredAt: currentTime.toISOString() });
          console.info("Jarvis primary model recovered", { model: primaryModel });
        }
        return output;
      } catch (error) {
        if (!isGeminiQuotaError(error)) throw error;
        const fallbackUntil = new Date(currentTime.getTime() + cooldownHours * 60 * 60 * 1000).toISOString();
        await store.activate({
          provider: "gemini",
          primaryModel,
          fallbackModel,
          fallbackUntil,
          errorCode: quotaErrorCode(error),
        });
        console.warn("Jarvis model failover activated", {
          primaryModel,
          fallbackModel,
          fallbackUntil,
          reason: quotaErrorCode(error),
        });
        return generateWithModel(input, fallbackModel);
      }
    },
  };
}
