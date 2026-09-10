// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAiErrorDiagnostic, formatAiErrorLog, readAiErrorDiagnostic } from "@/lib/ai/error-diagnostics";

function apiError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { name: "ApiError", status });
}

describe("diagnósticos da IA", () => {
  const now = new Date("2026-09-10T19:30:00.000Z");

  it("diferencia cota esgotada de limite momentâneo", () => {
    const quota = createAiErrorDiagnostic(apiError(429, '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"You exceeded your daily quota limit"}}'), now);
    const rate = createAiErrorDiagnostic(apiError(429, '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Too many requests"}}'), now);

    expect(quota).toMatchObject({ category: "quota_exhausted", status: 429, code: "RESOURCE_EXHAUSTED" });
    expect(rate).toMatchObject({ category: "rate_limited", status: 429, code: "RESOURCE_EXHAUSTED" });
  });

  it("identifica chave inválida, timeout e resposta estruturada inválida", () => {
    expect(createAiErrorDiagnostic(apiError(403, "PERMISSION_DENIED: API key invalid"), now).category).toBe("authentication");
    expect(createAiErrorDiagnostic(apiError(504, "DEADLINE_EXCEEDED"), now).category).toBe("timeout");
    expect(createAiErrorDiagnostic(new z.ZodError([]), now).category).toBe("invalid_response");
  });

  it("remove segredos e gera um log seguro para copiar", () => {
    const diagnostic = createAiErrorDiagnostic(apiError(403, "API_KEY_INVALID key=AIza123456789012345678901234567890"), now);
    const log = formatAiErrorLog(diagnostic);

    expect(diagnostic.technicalDetail).toContain("[CHAVE_REDACTED]");
    expect(diagnostic.technicalDetail).not.toContain("AIza123");
    expect(log).toContain(`Referência: ${diagnostic.referenceId}`);
    expect(log).toContain("Código: API_KEY_INVALID");
    expect(readAiErrorDiagnostic(diagnostic)).toEqual(diagnostic);
    expect(readAiErrorDiagnostic({ category: "inventada" })).toBeNull();
  });
});
