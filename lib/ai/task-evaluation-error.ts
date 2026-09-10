import type { AiErrorDiagnostic } from "@/lib/ai/error-diagnostics";
import { createClient } from "@/lib/supabase/server";

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function persistTaskEvaluationFailure(
  taskId: string,
  agencyId: string,
  diagnostic: AiErrorDiagnostic,
): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("classification_metadata")
    .eq("id", taskId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  const { error } = await supabase
    .from("tasks")
    .update({
      classification_status: "failed",
      classification_metadata: {
        ...metadataRecord(data?.classification_metadata),
        last_evaluation_error: diagnostic,
      },
    })
    .eq("id", taskId)
    .eq("agency_id", agencyId);
  if (error) console.error("Jarvis diagnostic persistence failed", { referenceId: diagnostic.referenceId, message: error.message });
}

export function logAiError(context: string, diagnostic: AiErrorDiagnostic): void {
  console.error(context, {
    referenceId: diagnostic.referenceId,
    provider: diagnostic.provider,
    category: diagnostic.category,
    status: diagnostic.status,
    code: diagnostic.code,
    occurredAt: diagnostic.occurredAt,
    technicalDetail: diagnostic.technicalDetail,
  });
}
