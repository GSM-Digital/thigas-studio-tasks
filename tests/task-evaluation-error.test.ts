// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({ from: mocks.from })),
}));

import { persistTaskEvaluationFailure } from "@/lib/ai/task-evaluation-error";
import type { AiErrorDiagnostic } from "@/lib/ai/error-diagnostics";

describe("persistência do diagnóstico do Jarvis", () => {
  beforeEach(() => mocks.from.mockReset());

  it("preserva os metadados anteriores e associa a falha à tarefa e agência corretas", async () => {
    const read = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    read.select.mockReturnValue(read);
    read.eq.mockReturnValue(read);
    read.maybeSingle.mockResolvedValue({ data: { classification_metadata: { analyst: "Jarvis" } }, error: null });
    const update = { update: vi.fn(), eq: vi.fn() };
    update.update.mockReturnValue(update);
    update.eq.mockReturnValueOnce(update).mockResolvedValueOnce({ error: null });
    mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(update);
    const diagnostic: AiErrorDiagnostic = {
      referenceId: "JRV-AB12CD34",
      provider: "Gemini",
      category: "quota_exhausted",
      status: 429,
      code: "RESOURCE_EXHAUSTED",
      title: "Cota ou créditos da API esgotados",
      message: "A cota disponível foi consumida.",
      technicalDetail: "Daily quota exceeded",
      occurredAt: "2026-09-10T19:30:00.000Z",
    };

    await persistTaskEvaluationFailure("task-1", "agency-1", diagnostic);

    expect(update.update).toHaveBeenCalledWith({
      classification_status: "failed",
      classification_metadata: {
        analyst: "Jarvis",
        last_evaluation_error: diagnostic,
      },
    });
    expect(read.eq).toHaveBeenCalledWith("agency_id", "agency-1");
    expect(update.eq).toHaveBeenCalledWith("agency_id", "agency-1");
  });
});
