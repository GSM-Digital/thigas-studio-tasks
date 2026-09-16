import { describe, expect, it } from "vitest";
import { billingPeriod, currentBillingMonth, shiftBillingMonth } from "@/lib/domain/billing-periods";

describe("períodos de faturamento", () => {
  it("usa a meia-noite do dia 15 no fuso da agência", () => {
    const period = billingPeriod("2026-09");
    expect(period.start.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-15T03:00:00.000Z");
    expect(currentBillingMonth(new Date("2026-09-15T02:59:59Z"))).toBe("2026-08");
    expect(currentBillingMonth(new Date("2026-09-15T03:00:00Z"))).toBe("2026-09");
  });
  it("navega entre anos e fevereiro sem pular ciclos", () => {
    expect(shiftBillingMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftBillingMonth("2026-12", 1)).toBe("2027-01");
    expect(billingPeriod("2028-02", "UTC").end.toISOString()).toBe("2028-03-15T00:00:00.000Z");
    expect(() => billingPeriod("2026-13")).toThrow("Mês inválido.");
  });
});
