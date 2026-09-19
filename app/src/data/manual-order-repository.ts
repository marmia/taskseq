import { isScheduledOpenTaskValue, ownerToday } from "../domain/task-date";
import type { ReorderTodayRequest } from "../shared/api-schema";

type TaskOrderRow = {
  id: string;
  area_id: number | null;
  is_system_managed: number;
  parent_task_id: string | null;
  status: "OPEN" | "COMPLETED";
  start: string | null;
  due: string | null;
};

type OwnerSettingsRow = {
  time_zone: string;
};

export class ManualOrderError extends Error {}

export async function reorderToday(
  database: D1Database,
  input: ReorderTodayRequest,
) {
  const [settings, tasks] = await Promise.all([
    database
      .prepare("SELECT time_zone FROM owner_settings WHERE id = 1")
      .first<OwnerSettingsRow>(),
    database
      .prepare(
        `SELECT tasks.id, tasks.area_id, areas.is_system_managed,
                tasks.parent_task_id, tasks.status, tasks.start, tasks.due
         FROM tasks
         INNER JOIN areas ON areas.id = tasks.area_id
         WHERE tasks.trashed_at IS NULL`,
      )
      .all<TaskOrderRow>(),
  ]);
  if (!settings) throw new Error("Owner settings are not initialized");

  const date = ownerToday(settings.time_zone);
  const expectedIds = tasks.results
    .filter((task) => isTodayEligible(task, settings.time_zone, date))
    .map((task) => task.id);
  validateOrder(input.ids, expectedIds);

  await replaceOrder(
    database,
    "DELETE FROM today_task_orders WHERE owner_date = ?",
    date,
    "INSERT INTO today_task_orders (owner_date, task_id, position) VALUES (?, ?, ?)",
    input.ids,
  );
}

function isTodayEligible(
  task: TaskOrderRow,
  ownerTimeZone: string,
  today: string,
) {
  return isScheduledOpenTaskValue(
    {
      status: task.status,
      start: task.start,
      due: task.due,
    },
    ownerTimeZone,
    today,
  );
}

function validateOrder(ids: string[], expectedIds: string[]) {
  const requestedIds = new Set(ids);
  const expectedIdSet = new Set(expectedIds);
  if (
    requestedIds.size !== ids.length ||
    requestedIds.size !== expectedIdSet.size ||
    ids.some((id) => !expectedIdSet.has(id))
  ) {
    throw new ManualOrderError(
      "The Task order must contain every Task in the selected group exactly once.",
    );
  }
}

async function replaceOrder(
  database: D1Database,
  deleteSql: string,
  key: string,
  insertSql: string,
  ids: string[],
) {
  await database.batch([
    database.prepare(deleteSql).bind(key),
    ...ids.map((id, position) =>
      database.prepare(insertSql).bind(key, id, position),
    ),
  ]);
}
