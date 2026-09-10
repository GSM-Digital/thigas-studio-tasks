import { describe, expect, it } from "vitest";
import { calculateAmountCents, calculateEfficiencyScore, isValidPointsForLevel } from "@/lib/domain/points";

describe("regras de pontuação", () => {
  it.each([
    [1, 1], [1, 4], [2, 5], [2, 15], [3, 20], [3, 35], [4, 50], [4, 100],
  ])("aceita nível %i com %i pontos", (level, points) => {
    expect(isValidPointsForLevel(level, points)).toBe(true);
  });

  it.each([[1, 5], [2, 4], [2, 16], [3, 36], [4, 49]])(
    "rejeita pontuação fora da faixa",
    (level, points) => expect(isValidPointsForLevel(level, points)).toBe(false),
  );

  it("calcula moeda em centavos sem erro de ponto flutuante", () => {
    expect(calculateAmountCents(25, 400)).toBe(10_000);
  });

  it("rejeita valores negativos", () => {
    expect(() => calculateAmountCents(-1, 400)).toThrow(RangeError);
  });

  it.each([
    [1200, "super_efficient", 40, 4, 14],
    [2700, "super_efficient", 30, 3, 13],
    [5400, "expected", 0, 0, 10],
    [8100, "late", -20, -2, 8],
    [10800, "late", -35, -3, 7],
    [14400, "late", -50, -5, 5],
  ] as const)("pontua eficiência para %i segundos", (actual, band, percentage, adjustment, finalPoints) => {
    expect(calculateEfficiencyScore(10, 7200, actual)).toEqual({
      band,
      ratio: actual / 7200,
      percentage,
      adjustment,
      finalPoints,
    });
  });
});
