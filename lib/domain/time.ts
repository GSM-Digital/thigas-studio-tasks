const TIME_PATTERN = /^(\d{1,4}):([0-5]\d):([0-5]\d)$/;

export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function parseDuration(value: string): number {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error("Use o formato HH:MM:SS.");
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total > 359_999_999) {
    throw new Error("A duração informada excede o limite permitido.");
  }
  return total;
}

export function effectiveDuration(
  trackedSeconds: number,
  manualDurationSeconds: number | null,
  activeTimerStartedAt: string | null,
  now = Date.now(),
): number {
  if (manualDurationSeconds !== null && !activeTimerStartedAt) {
    return manualDurationSeconds;
  }
  const activeSeconds = activeTimerStartedAt
    ? Math.max(0, Math.floor((now - Date.parse(activeTimerStartedAt)) / 1000))
    : 0;
  return trackedSeconds + activeSeconds;
}
