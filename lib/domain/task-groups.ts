import { dateKeyAtTimeZone } from "@/lib/domain/deadline";
import { sortTasksByUrgency } from "@/lib/domain/priority";
import type { TaskView } from "@/lib/types";

const DAY_IN_MS = 86_400_000;

export type TaskDateGroupKind =
  | "overdue"
  | "today"
  | "tomorrow"
  | "day-after-tomorrow"
  | "future"
  | "no-deadline";

export interface TaskDateGroup<T extends TaskView = TaskView> {
  id: string;
  kind: TaskDateGroupKind;
  label: string;
  tasks: T[];
}

function dateKeyToEpoch(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Chave de data inválida: ${dateKey}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1) : value;
}

function futureDateLabel(dueAt: string, timeZone: string): string {
  return capitalize(new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(dueAt)));
}

function relativeGroup(
  dueAt: string | null,
  todayKey: string,
  timeZone: string,
): Omit<TaskDateGroup, "tasks"> & { order: number } {
  if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) {
    return { id: "no-deadline", kind: "no-deadline", label: "Sem prazo", order: Number.POSITIVE_INFINITY };
  }

  const dueKey = dateKeyAtTimeZone(dueAt, timeZone);
  const distanceInDays = Math.round((dateKeyToEpoch(dueKey) - dateKeyToEpoch(todayKey)) / DAY_IN_MS);

  if (distanceInDays < 0) {
    return { id: "overdue", kind: "overdue", label: "Atrasadas", order: -1 };
  }
  if (distanceInDays === 0) {
    return { id: dueKey, kind: "today", label: "Hoje", order: 0 };
  }
  if (distanceInDays === 1) {
    return { id: dueKey, kind: "tomorrow", label: "Amanhã", order: 1 };
  }
  if (distanceInDays === 2) {
    return { id: dueKey, kind: "day-after-tomorrow", label: "Depois de amanhã", order: 2 };
  }
  return {
    id: dueKey,
    kind: "future",
    label: futureDateLabel(dueAt, timeZone),
    order: dateKeyToEpoch(dueKey),
  };
}

/**
 * Creates Reminders-style calendar sections while retaining the intelligent
 * urgency order inside every section.
 */
export function groupTasksByDeadline<T extends TaskView>(
  tasks: readonly T[],
  now = new Date(),
  timeZone = "America/Sao_Paulo",
): TaskDateGroup<T>[] {
  const todayKey = dateKeyAtTimeZone(now, timeZone);
  const groups = new Map<string, TaskDateGroup<T> & { order: number }>();
  const prioritySortedTasks = sortTasksByUrgency(tasks, now.getTime());

  for (const task of prioritySortedTasks) {
    const definition = relativeGroup(task.dueAt, todayKey, timeZone);
    const existing = groups.get(definition.id);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }
    groups.set(definition.id, { ...definition, tasks: [task] });
  }

  return [...groups.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ id, kind, label, tasks: groupedTasks }) => ({ id, kind, label, tasks: groupedTasks }));
}
