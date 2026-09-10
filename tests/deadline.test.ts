import { describe, expect, it } from "vitest";
import {
  createDefaultDeadline,
  deadlineInputToIso,
  isFutureDeadline,
  toDateTimeLocalValue,
} from "@/lib/domain/deadline";

describe("prazos de tarefas", () => {
  it("converte o valor local do formulário para um instante ISO", () => {
    const now = new Date(2030, 0, 2, 9, 0, 0);
    const input = toDateTimeLocalValue(new Date(2030, 0, 2, 18, 30, 0));
    const parsed = deadlineInputToIso(input, now);

    expect(new Date(parsed).getTime()).toBe(new Date(2030, 0, 2, 18, 30, 0).getTime());
    expect(isFutureDeadline(input, now)).toBe(true);
  });

  it("recusa prazo inválido ou no passado", () => {
    const now = new Date(2030, 0, 2, 9, 0, 0);

    expect(() => deadlineInputToIso("", now)).toThrow("data e hora válidas");
    expect(() => deadlineInputToIso("2030-01-02T08:59", now)).toThrow("futuro");
    expect(isFutureDeadline("2030-01-02T08:59", now)).toBe(false);
  });

  it("sugere 18h do dia seguinte como prazo inicial", () => {
    const deadline = createDefaultDeadline(new Date(2030, 0, 2, 9, 15, 0));

    expect(deadline).toBe("2030-01-03T18:00");
  });
});
