function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toDateTimeLocalValue(date: Date): string {
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

export function createDefaultDeadline(now = new Date()): string {
  const deadline = new Date(now);
  deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(18, 0, 0, 0);
  return toDateTimeLocalValue(deadline);
}

export function deadlineInputToIso(value: string, now = new Date()): string {
  const deadline = new Date(value);
  if (!value || Number.isNaN(deadline.getTime())) {
    throw new Error("Informe uma data e hora válidas para o prazo.");
  }
  if (deadline.getTime() <= now.getTime()) {
    throw new Error("O prazo deve estar no futuro.");
  }
  return deadline.toISOString();
}

export function isFutureDeadline(value: string, now = new Date()): boolean {
  try {
    deadlineInputToIso(value, now);
    return true;
  } catch {
    return false;
  }
}

export function dateKeyAtTimeZone(
  value: Date | string,
  timeZone = "America/Sao_Paulo",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatDeadline(
  value: string,
  timeZone = "America/Sao_Paulo",
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
