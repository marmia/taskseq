import type { Area, Task } from "../domain/task";
import { formatTaskDate } from "../domain/task-date";
import type { TaskResultColumn } from "../shared/api-schema";

export type PlainTaskResultColumn = Exclude<TaskResultColumn, "title">;

export function taskResultValue(
  column: PlainTaskResultColumn,
  task: Task,
  areas: Area[],
  ownerTimeZone: string,
) {
  switch (column) {
    case "area": {
      const area = areas.find((candidate) => candidate.id === task.areaId);
      return area?.isSystemManaged
        ? "Inbox"
        : (area?.name ?? task.path[0] ?? "—");
    }
    case "path":
      return task.path.slice(1).join(" / ") || "—";
    case "start":
      return task.start ? formatTaskDate(task.start, ownerTimeZone) : "—";
    case "due":
      return task.due ? formatTaskDate(task.due, ownerTimeZone) : "—";
    case "updated":
      return task.updatedAt
        ? formatTaskDate(task.updatedAt, ownerTimeZone)
        : "—";
    case "tags":
      return task.tags.length > 0
        ? task.tags.map((tag) => tag.name).join(", ")
        : "—";
    case "repeat":
      return task.recurrenceRule || "—";
    case "description":
      return task.description || "—";
    case "workNotes":
      return task.workNotes || "—";
  }
}
