import type { Area, Tag, Task } from "../domain/task";
import type { DisplayLanguage } from "../shared/api-schema";
import { readViews } from "./view-repository";

export type OwnerSettings = {
  displayLanguage: DisplayLanguage;
  timeZone: string;
  weekStartsOn: number;
  trashRetentionDays: number;
  version: number;
};

export type BootstrapSnapshot = {
  areas: Area[];
  ownerSettings: OwnerSettings;
  tags: Tag[];
  tasks: Task[];
  areaTaskOrders: Record<string, string[]>;
  inboxOrder: string[];
  todayOrders: Record<string, string[]>;
  views: Awaited<ReturnType<typeof readViews>>;
};

type AreaRow = {
  id: number;
  name: string;
  color: Area["color"];
  position: number;
  is_system_managed: number;
  trashed_at: string | null;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  work_notes: string;
  status: Task["status"];
  area_id: number | null;
  parent_task_id: string | null;
  start: string | null;
  due: string | null;
  completed_at: string | null;
  updated_at: string;
  trashed_at: string | null;
  trash_operation_id: string | null;
  recurrence_rule: string | null;
  version: number;
};

type TaskTagRow = {
  task_id: string;
  id: number;
  name: string;
};

type OwnerSettingsRow = {
  display_language: DisplayLanguage;
  time_zone: string;
  week_starts_on: number;
  trash_retention_days: number;
  version: number;
};

type TaskManualOrderRow = {
  group_key: string;
  task_id: string;
};

type TodayTaskOrderRow = {
  owner_date: string;
  task_id: string;
};

export async function readBootstrapSnapshot(
  database: D1Database,
): Promise<BootstrapSnapshot> {
  const [
    areaResult,
    taskResult,
    taskTagResult,
    tagResult,
    ownerSettings,
    taskManualOrderResult,
    todayTaskOrderResult,
    views,
  ] = await Promise.all([
    database
      .prepare(
        `SELECT id, name, color, position, is_system_managed, trashed_at
         FROM areas
         ORDER BY is_system_managed, position`,
      )
      .all<AreaRow>(),
    database
      .prepare(
        `SELECT id, title, description, work_notes, status, area_id, parent_task_id,
                start, due, completed_at, updated_at, trashed_at, trash_operation_id, recurrence_rule, version
         FROM tasks`,
      )
      .all<TaskRow>(),
    database
      .prepare(
        `SELECT task_tags.task_id, tags.id, tags.name
         FROM task_tags
         INNER JOIN tags ON tags.id = task_tags.tag_id
         ORDER BY tags.name`,
      )
      .all<TaskTagRow>(),
    database.prepare("SELECT id, name FROM tags ORDER BY name").all<Tag>(),
    database
      .prepare(
        `SELECT display_language, time_zone, week_starts_on, trash_retention_days, version
         FROM owner_settings WHERE id = 1`,
      )
      .first<OwnerSettingsRow>(),
    database
      .prepare(
        "SELECT group_key, task_id FROM task_manual_orders ORDER BY group_key, position",
      )
      .all<TaskManualOrderRow>(),
    database
      .prepare(
        "SELECT owner_date, task_id FROM today_task_orders ORDER BY owner_date, position",
      )
      .all<TodayTaskOrderRow>(),
    readViews(database),
  ]);

  if (!ownerSettings) {
    throw new Error("Owner settings are not initialized");
  }

  const areas = areaResult.results.map((area) => ({
    id: area.id,
    name: area.name,
    color: area.color,
    position: area.position,
    isSystemManaged: area.is_system_managed === 1,
    trashedAt: area.trashed_at,
  }));
  const areaNames = new Map(
    areas.map((area) => [area.id, area.isSystemManaged ? "Inbox" : area.name]),
  );
  const tasksById = new Map(taskResult.results.map((task) => [task.id, task]));
  const tagsByTaskId = new Map<string, Tag[]>();
  for (const tag of taskTagResult.results) {
    const tags = tagsByTaskId.get(tag.task_id) ?? [];
    tags.push({ id: tag.id, name: tag.name });
    tagsByTaskId.set(tag.task_id, tags);
  }

  const taskOrdersByGroup = groupedOrder(
    taskManualOrderResult.results,
    (row) => row.group_key,
  );
  const inboxOrder = taskOrdersByGroup.inbox ?? [];
  delete taskOrdersByGroup.inbox;

  return {
    areas,
    ownerSettings: {
      displayLanguage: ownerSettings.display_language,
      timeZone: ownerSettings.time_zone,
      weekStartsOn: ownerSettings.week_starts_on,
      trashRetentionDays: ownerSettings.trash_retention_days,
      version: ownerSettings.version,
    },
    tags: tagResult.results,
    tasks: taskResult.results.map((task) =>
      serializeTask(
        task,
        tasksById,
        areaNames,
        tagsByTaskId.get(task.id) ?? [],
      ),
    ),
    areaTaskOrders: taskOrdersByGroup,
    inboxOrder,
    todayOrders: groupedOrder(
      todayTaskOrderResult.results,
      (row) => row.owner_date,
    ),
    views,
  };
}

function groupedOrder<T extends { task_id: string }>(
  rows: T[],
  key: (row: T) => string,
) {
  const orders: Record<string, string[]> = {};
  for (const row of rows) {
    const group = key(row);
    const taskIds = orders[group] ?? [];
    taskIds.push(row.task_id);
    orders[group] = taskIds;
  }
  return orders;
}

export function serializeTask(
  task: TaskRow,
  tasksById: Map<string, TaskRow>,
  areaNames: Map<number, string>,
  tags: Tag[],
): Task {
  if (task.area_id === null) {
    throw new Error("Task is not assigned to an Area");
  }

  return {
    id: task.id,
    title: task.title,
    path: taskPath(task, tasksById, areaNames),
    areaId: task.area_id,
    ...(task.parent_task_id ? { parentId: task.parent_task_id } : {}),
    status: task.status,
    start: task.start,
    due: task.due,
    completedAt: task.completed_at,
    updatedAt: task.updated_at,
    tags,
    description: task.description,
    workNotes: task.work_notes,
    trashedAt: task.trashed_at,
    trashOperationId: task.trash_operation_id,
    recurrenceRule: task.recurrence_rule,
    version: task.version,
  };
}

function taskPath(
  task: TaskRow,
  tasksById: Map<string, TaskRow>,
  areaNames: Map<number, string>,
) {
  if (task.area_id === null) {
    throw new Error("Task is not assigned to an Area");
  }

  const titles = [task.title];
  const visited = new Set([task.id]);
  let ancestorId = task.parent_task_id;

  while (ancestorId) {
    const ancestor = tasksById.get(ancestorId);
    if (!ancestor || visited.has(ancestor.id)) break;

    titles.unshift(ancestor.title);
    visited.add(ancestor.id);
    ancestorId = ancestor.parent_task_id;
  }

  return [areaNames.get(task.area_id) ?? "", ...titles];
}
