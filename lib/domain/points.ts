export const POINT_RANGES = {
  1: { min: 1, max: 4 },
  2: { min: 5, max: 15 },
  3: { min: 20, max: 35 },
  4: { min: 50, max: 100 },
} as const;

export type ComplexityLevel = keyof typeof POINT_RANGES;

export function isValidPointsForLevel(
  level: number,
  points: number,
): level is ComplexityLevel {
  const range = POINT_RANGES[level as ComplexityLevel];
  return Boolean(
    range && Number.isInteger(points) && points >= range.min && points <= range.max,
  );
}

export function calculateAmountCents(
  points: number,
  pointValueCents: number,
): number {
  if (!Number.isInteger(points) || points < 0) {
    throw new RangeError("Pontos devem ser um inteiro não negativo.");
  }
  if (!Number.isInteger(pointValueCents) || pointValueCents < 0) {
    throw new RangeError("Valor por ponto deve ser um inteiro não negativo.");
  }
  return points * pointValueCents;
}

export type EfficiencyBand = "pending" | "super_efficient" | "expected" | "late";

export interface EfficiencyScore {
  band: EfficiencyBand;
  ratio: number | null;
  percentage: number;
  adjustment: number;
  finalPoints: number;
}

export const EXECUTION_ADJUSTMENT_PERCENTAGES = [
  -100, -80, -70, -60, -50, -40, -30, -20, -10, 0, 5, 10, 15, 20,
] as const;
export type ExecutionAdjustmentPercentage = (typeof EXECUTION_ADJUSTMENT_PERCENTAGES)[number];

export function calculateExecutionAdjustment(
  basePoints: number,
  percentage: ExecutionAdjustmentPercentage,
): number {
  if (!Number.isInteger(basePoints) || basePoints < 1 || basePoints > 100) {
    throw new RangeError("Pontos base devem ser um inteiro entre 1 e 100.");
  }
  if (!EXECUTION_ADJUSTMENT_PERCENTAGES.includes(percentage)) {
    throw new RangeError("Percentual de execução inválido.");
  }
  return calculatePercentageAdjustment(basePoints, percentage);
}

export function calculatePercentageAdjustment(basePoints: number, percentage: number): number {
  if (!Number.isInteger(basePoints) || basePoints < 1 || basePoints > 100) {
    throw new RangeError("Pontos base devem ser um inteiro entre 1 e 100.");
  }
  if (!Number.isInteger(percentage) || percentage < -100 || percentage > 20) {
    throw new RangeError("Percentual de ajuste deve ser um inteiro entre -100 e 20.");
  }
  const magnitude = Math.round(basePoints * (Math.abs(percentage) / 100));
  return Math.sign(percentage) * magnitude;
}

/** Deterministic scoring keeps billing reproducible even if the model varies. */
export function calculateEfficiencyScore(
  basePoints: number,
  estimatedDurationSeconds: number,
  actualDurationSeconds: number | null,
): EfficiencyScore {
  if (!Number.isInteger(basePoints) || basePoints < 1 || basePoints > 100) {
    throw new RangeError("Pontos base devem ser um inteiro entre 1 e 100.");
  }
  if (!Number.isInteger(estimatedDurationSeconds) || estimatedDurationSeconds <= 0) {
    throw new RangeError("O prazo estimado deve ser um inteiro positivo em segundos.");
  }
  if (actualDurationSeconds === null || actualDurationSeconds === 0) {
    return { band: "pending", ratio: null, percentage: 0, adjustment: 0, finalPoints: basePoints };
  }
  if (!Number.isInteger(actualDurationSeconds) || actualDurationSeconds < 0) {
    throw new RangeError("O tempo real deve ser um inteiro não negativo em segundos.");
  }

  const ratio = actualDurationSeconds / estimatedDurationSeconds;
  let band: EfficiencyBand;
  let percentage: number;

  if (ratio < 0.5) {
    band = "super_efficient";
    percentage = ratio < 0.25 ? 40 : ratio < 0.4 ? 30 : 20;
  } else if (ratio <= 1) {
    band = "expected";
    percentage = 0;
  } else {
    band = "late";
    percentage = ratio <= 1.25 ? -20 : ratio <= 1.5 ? -35 : -50;
  }

  const adjustment = Math.round(basePoints * (percentage / 100));
  return { band, ratio, percentage, adjustment, finalPoints: basePoints + adjustment };
}

export function formatCurrency(cents: number, currencyCode = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode,
  }).format(cents / 100);
}
