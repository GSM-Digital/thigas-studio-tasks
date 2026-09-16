import { dateKeyAtTimeZone } from "@/lib/domain/deadline";

// Convert midnight in the agency's timezone, not the browser/server timezone.
function localMidnight(year: number, month: number, timeZone: string): Date {
  const target = Date.UTC(year, month, 15);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    instant += target - wall;
  }
  return new Date(instant);
}

export function shiftBillingMonth(month: string, offset: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError("Mês inválido.");
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, number! - 1 + offset, 15));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentBillingMonth(now = new Date(), timeZone = "America/Sao_Paulo"): string {
  const key = dateKeyAtTimeZone(now, timeZone);
  return Number(key.slice(8)) >= 15 ? key.slice(0, 7) : shiftBillingMonth(key.slice(0, 7), -1);
}

export function billingPeriod(month: string, timeZone = "America/Sao_Paulo"): { start: Date; end: Date } {
  shiftBillingMonth(month, 0); // Validate before parsing.
  const [year, number] = month.split("-").map(Number);
  return { start: localMidnight(year!, number! - 1, timeZone), end: localMidnight(year!, number!, timeZone) };
}
