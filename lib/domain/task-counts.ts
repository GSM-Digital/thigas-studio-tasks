import type { TaskView } from "@/lib/types";

export function countOpenTasks(tasks: TaskView[], clientId?: string): number {
  return tasks.filter((task) => (
    (task.status === "open" || task.status === "in_progress")
    && (clientId === undefined || task.clientId === clientId)
  )).length;
}
