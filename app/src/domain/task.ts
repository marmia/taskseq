export type TaskStatus = "OPEN" | "COMPLETED";
export const MAX_TASK_DEPTH = 5;

export type AreaColor =
  | "blue"
  | "purple"
  | "green"
  | "yellow"
  | "orange"
  | "pink"
  | "brown"
  | "gray";

export type Area = {
  id: number;
  name: string;
  color: AreaColor;
  position: number;
  isSystemManaged: boolean;
  trashedAt?: string | null;
};

export type Tag = {
  id: number;
  name: string;
};

export type Task = {
  id: string;
  title: string;
  path: string[];
  areaId: number;
  parentId?: string;
  status: TaskStatus;
  start: string | null;
  due: string | null;
  completedAt: string | null;
  updatedAt: string;
  tags: Tag[];
  description: string;
  workNotes: string;
  recurrenceRule?: string | null;
  trashedAt?: string | null;
  trashOperationId?: string | null;
  version?: number;
};

export function taskDepth(task: Pick<Task, "path">) {
  return Math.max(0, task.path.length - 1);
}

export function canHaveSubtask(task: Pick<Task, "path">) {
  return taskDepth(task) < MAX_TASK_DEPTH;
}

export type NewTaskInput = {
  title: string;
  areaId: number;
  parentId: string | null;
  pathPrefix: string[];
  start: string | null;
  due: string | null;
  tagIds: number[];
  newTagNames: string[];
  description: string;
};

export type TaskUpdateInput = {
  title: string;
  start: string | null;
  due: string | null;
  tagIds: number[];
  newTagNames: string[];
  description: string;
  workNotes: string;
};
