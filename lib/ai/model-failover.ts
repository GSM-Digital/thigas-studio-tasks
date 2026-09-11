import { createAdminClient } from "@/lib/supabase/admin";

export interface AiModelFailoverState {
  primaryModel: string;
  fallbackModel: string;
  fallbackUntil: string | null;
}

export interface AiModelFailoverStore {
  read(provider: "gemini"): Promise<AiModelFailoverState | null>;
  activate(input: {
    provider: "gemini";
    primaryModel: string;
    fallbackModel: string;
    fallbackUntil: string;
    errorCode: string;
  }): Promise<void>;
  markRecovered(input: { provider: "gemini"; recoveredAt: string }): Promise<void>;
}

const memoryState = new Map<string, AiModelFailoverState>();

function logPersistenceFailure(operation: string, error: unknown) {
  console.error("Jarvis model failover persistence failed", {
    operation,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function createAiModelFailoverStore(): AiModelFailoverStore {
  return {
    async read(provider) {
      const admin = createAdminClient();
      if (!admin) return memoryState.get(provider) ?? null;
      const { data, error } = await admin
        .from("ai_model_failover_state")
        .select("primary_model, fallback_model, fallback_until")
        .eq("provider", provider)
        .maybeSingle();
      if (error) {
        logPersistenceFailure("read", error);
        return memoryState.get(provider) ?? null;
      }
      if (!data) return memoryState.get(provider) ?? null;
      const state = {
        primaryModel: data.primary_model,
        fallbackModel: data.fallback_model,
        fallbackUntil: data.fallback_until,
      };
      memoryState.set(provider, state);
      return state;
    },

    async activate(input) {
      const state = {
        primaryModel: input.primaryModel,
        fallbackModel: input.fallbackModel,
        fallbackUntil: input.fallbackUntil,
      };
      memoryState.set(input.provider, state);
      const admin = createAdminClient();
      if (!admin) return;
      const now = new Date().toISOString();
      const { error } = await admin.from("ai_model_failover_state").upsert({
        provider: input.provider,
        primary_model: input.primaryModel,
        fallback_model: input.fallbackModel,
        fallback_until: input.fallbackUntil,
        last_quota_error_at: now,
        last_quota_error_code: input.errorCode,
        updated_at: now,
      }, { onConflict: "provider" });
      if (error) logPersistenceFailure("activate", error);
    },

    async markRecovered(input) {
      memoryState.delete(input.provider);
      const admin = createAdminClient();
      if (!admin) return;
      const { error } = await admin
        .from("ai_model_failover_state")
        .update({
          fallback_until: null,
          last_recovered_at: input.recoveredAt,
          updated_at: input.recoveredAt,
        })
        .eq("provider", input.provider)
        .lte("fallback_until", input.recoveredAt);
      if (error) logPersistenceFailure("mark_recovered", error);
    },
  };
}
