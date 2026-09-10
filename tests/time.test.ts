import { describe, expect, it } from "vitest";
import { effectiveDuration, formatDuration, parseDuration } from "@/lib/domain/time";

describe("tempo", () => {
  it("converte HH:MM:SS nos dois sentidos", () => {
    expect(parseDuration("01:05:00")).toBe(3_900);
    expect(formatDuration(2_700)).toBe("00:45:00");
  });

  it("rejeita minutos e segundos inválidos", () => {
    expect(() => parseDuration("01:99:00")).toThrow("HH:MM:SS");
  });

  it("soma o trecho ativo ao tempo rastreado", () => {
    expect(effectiveDuration(100, null, "2026-09-09T12:00:00.000Z", Date.parse("2026-09-09T12:01:40.000Z"))).toBe(200);
  });

  it("prioriza o ajuste manual quando não há timer ativo", () => {
    expect(effectiveDuration(3_900, 2_700, null)).toBe(2_700);
  });
});
