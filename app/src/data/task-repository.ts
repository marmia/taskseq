import {
  nextOccurrenceDate,
  normalizeRecurrenceRule,
  recurrenceRuleMatchesDate,
} from "../domain/recurrence";
import type { TaskStatus } from "../domain/task";
import { ownerToday } from "../domain/task-date";
import type {
  CreateTaskRequest,
  TaskVersionRequest,
  UpdateTaskRequest,
  UpdateTaskStatusRequest,
} from "../shared/api-schema";

type TaskRow = {
  id: string;
  version: number;
  status: TaskStatus;
  area_id: number | null;
  parent_task_id: string | null;
  start?: string | null;
  recurrence_rule?: string | null;
  generated_from_task_id?: string | null;
  trashed_at?: string | null;
};

export class TaskNotFoundError extends Error {}

export class TaskConflictError extends Error {}

export class TaskTreeError extends Error {}
export class TaskTagNotFoundError extends Error {}

export class TaskHasOpenDescendantsError extends Error {}
export class TaskHasOpenRecurringDescendantsError extends Error {
  constructor(readonly taskIds: string[]) {
    super("A Task with an Open Recurring descendant cannot be completed.");
  }
}
export class RecurrenceRuleError extends Error {}
export class RecurrenceReopenConflictError extends Error {}

export async function createTask(
  database: D1Database,
  input: CreateTaskRequest,
) {
  const areaId = await activeAreaId(database, input.areaId);
  const recurrenceRule = validateRecurringTask(
    input.recurrenceRule ?? null,
    input.start,
    input.due,
  );
  await validateParentTask(database, areaId, input.parentId ?? null);

  const tagIds = normalizedTagIds(input.tagIds);
  const newTagNames = normalizedTagNames(input.newTagNames);
  await validateTagIds(database, tagIds);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const createStatement = input.parentId
    ? database
        .prepare(
          `INSERT INTO tasks (
            id, title, description, work_notes, status, area_id, parent_task_id,
            start, due, completed_at, trashed_at, recurrence_rule, created_at, updated_at
          )
          SELECT ?, ?, ?, '', 'OPEN', ?, ?, ?, ?, NULL, NULL, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM tasks
            WHERE id = ? AND area_id = ? AND status = 'OPEN' AND trashed_at IS NULL
          )`,
        )
        .bind(
          id,
          input.title.trim(),
          input.description,
          areaId,
          input.parentId,
          input.start,
          input.due,
          recurrenceRule,
          now,
          now,
          input.parentId,
          areaId,
        )
    : database
        .prepare(
          `INSERT INTO tasks (
            id, title, description, work_notes, status, area_id, parent_task_id,
            start, due, completed_at, trashed_at, recurrence_rule, created_at, updated_at
          )
          SELECT ?, ?, ?, '', 'OPEN', ?, NULL, ?, ?, NULL, NULL, ?, ?, ?
          WHERE ? IS NULL OR EXISTS (
            SELECT 1 FROM areas WHERE id = ? AND trashed_at IS NULL
          )`,
        )
        .bind(
          id,
          input.title.trim(),
          input.description,
          areaId,
          input.start,
          input.due,
          recurrenceRule,
          now,
          now,
          areaId,
          areaId,
        );
  const createResult = await createStatement.run();
  if (createResult.meta.changes === 0) {
    if (input.parentId) {
      throw new TaskTreeError(
        "Parent Task changed before the Subtask was created.",
      );
    }
    throw new TaskNotFoundError("Area was not found");
  }

  const statements = [
    ...newTagNames.flatMap((name) => [
      database
        .prepare("INSERT INTO tags (name) VALUES (?) ON CONFLICT DO NOTHING")
        .bind(name),
      database
        .prepare(
          `INSERT INTO task_tags (task_id, tag_id)
           SELECT ?, id FROM tags WHERE name = ?
           ON CONFLICT DO NOTHING`,
        )
        .bind(id, name),
    ]),
    ...tagIds.map((tagId) =>
      database
        .prepare(
          "INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(id, tagId),
    ),
  ];

  if (statements.length > 0) await database.batch(statements);
}

async function activeAreaId(database: D1Database, areaId: number | null) {
  const area = await database
    .prepare(
      `SELECT id FROM areas
       WHERE id = COALESCE(
         ?,
         (SELECT id FROM areas WHERE is_system_managed = 1 AND trashed_at IS NULL)
       )
       AND trashed_at IS NULL`,
    )
    .bind(areaId)
    .first<{ id: number }>();
  if (!area) throw new TaskNotFoundError("Area was not found");
  return area.id;
}

export async function updateTask(
  database: D1Database,
  id: string,
  input: UpdateTaskRequest,
) {
  const existing = await database
    .prepare(
      `SELECT id, version, area_id, parent_task_id
       FROM tasks WHERE id = ? AND trashed_at IS NULL`,
    )
    .bind(id)
    .first<TaskRow>();
  if (!existing) throw new TaskNotFoundError("Task was not found");
  if (existing.version !== input.version) {
    throw new TaskConflictError("Task version does not match");
  }
  const destinationAreaId = input.areaId ?? existing.area_id;
  const isAreaMove =
    input.areaId !== undefined && input.areaId !== existing.area_id;
  const destinationParentId =
    input.parentId !== undefined
      ? input.parentId
      : isAreaMove
        ? null
        : existing.parent_task_id;
  const isTaskPathChange = destinationParentId !== existing.parent_task_id;
  const hasLocationChange = isAreaMove || isTaskPathChange;
  let destinationIsSystemManaged = false;
  if (hasLocationChange) {
    const destinationArea = await database
      .prepare(
        "SELECT id, is_system_managed FROM areas WHERE id = ? AND trashed_at IS NULL",
      )
      .bind(destinationAreaId)
      .first<{ id: number; is_system_managed: number }>();
    if (!destinationArea) throw new TaskNotFoundError("Area was not found");
    destinationIsSystemManaged = destinationArea.is_system_managed === 1;
  }
  if (hasLocationChange) {
    await validateParentTask(
      database,
      destinationAreaId,
      destinationParentId,
      id,
    );
  }
  const recurrenceRule = validateRecurringTask(
    input.recurrenceRule ?? null,
    input.start,
    input.due,
  );
  if (recurrenceRule) {
    const child = await database
      .prepare(
        "SELECT id FROM tasks WHERE parent_task_id = ? AND trashed_at IS NULL LIMIT 1",
      )
      .bind(id)
      .first();
    if (child)
      throw new RecurrenceRuleError("A Recurring Task cannot have Subtasks.");
  }

  const tagIds = normalizedTagIds(input.tagIds);
  const newTagNames = normalizedTagNames(input.newTagNames);
  await validateTagIds(database, tagIds);
  const now = new Date().toISOString();
  const destinationGroupKey = destinationParentId
    ? `parent:${destinationParentId}`
    : destinationIsSystemManaged
      ? "inbox"
      : `area:${destinationAreaId}`;
  const taskUpdateStatement = database
    .prepare(
      `UPDATE tasks
       SET title = ?, description = ?, work_notes = ?, area_id = ?,
           parent_task_id = ?,
           start = ?, due = ?, recurrence_rule = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    )
    .bind(
      input.title.trim(),
      input.description,
      input.workNotes,
      destinationAreaId,
      destinationParentId,
      input.start,
      input.due,
      recurrenceRule,
      now,
      id,
      input.version,
    );
  const locationChangeStatements = [
    ...(isAreaMove
      ? [
          database
            .prepare(
              `WITH RECURSIVE descendants(id, path) AS (
               SELECT id, '/' || id || '/'
               FROM tasks
               WHERE parent_task_id = ?
               UNION ALL
               SELECT tasks.id, descendants.path || tasks.id || '/'
               FROM tasks
               INNER JOIN descendants ON tasks.parent_task_id = descendants.id
               WHERE instr(descendants.path, '/' || tasks.id || '/') = 0
             )
             UPDATE tasks
             SET area_id = ?, updated_at = ?, version = version + 1
             WHERE id IN (SELECT id FROM descendants)
               AND EXISTS (
                 SELECT 1 FROM tasks WHERE id = ? AND version = ?
               )`,
            )
            .bind(id, destinationAreaId, now, id, input.version),
        ]
      : []),
    ...(hasLocationChange
      ? [
          database
            .prepare(
              `DELETE FROM task_manual_orders
             WHERE task_id = ?
               AND EXISTS (
                 SELECT 1 FROM tasks WHERE id = ? AND version = ?
               )`,
            )
            .bind(id, id, input.version),
          database
            .prepare(
              `INSERT INTO task_manual_orders (group_key, task_id, position)
               SELECT ?, ?, COALESCE(
                 (SELECT MAX(position) + 1
                  FROM task_manual_orders
                  WHERE group_key = ?),
                 0
               )
               WHERE EXISTS (
                 SELECT 1 FROM tasks WHERE id = ? AND version = ?
               )`,
            )
            .bind(
              destinationGroupKey,
              id,
              destinationGroupKey,
              id,
              input.version,
            ),
        ]
      : []),
  ];
  const statements = [
    database
      .prepare(
        `DELETE FROM task_tags
         WHERE task_id = ?
           AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND version = ?)`,
      )
      .bind(id, id, input.version),
    ...newTagNames.flatMap((name) => [
      database
        .prepare(
          `INSERT INTO tags (name)
           SELECT ? WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND version = ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(name, id, input.version),
      database
        .prepare(
          `INSERT INTO task_tags (task_id, tag_id)
           SELECT ?, id FROM tags
           WHERE name = ?
             AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND version = ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(id, name, id, input.version),
    ]),
    ...tagIds.map((tagId) =>
      database
        .prepare(
          `INSERT INTO task_tags (task_id, tag_id)
           SELECT ?, ?
           WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND version = ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(id, tagId, id, input.version),
    ),
    ...locationChangeStatements,
    taskUpdateStatement,
  ];

  const results = await database.batch(statements);
  const taskUpdateStatementIndex =
    newTagNames.length * 2 +
    tagIds.length +
    1 +
    locationChangeStatements.length;
  const updateResult = results[taskUpdateStatementIndex];
  if (!updateResult || updateResult.meta.changes === 0) {
    throw new TaskConflictError("Task version does not match");
  }
}

export async function updateTaskStatus(
  database: D1Database,
  id: string,
  input: UpdateTaskStatusRequest,
) {
  const task = await database
    .prepare(
      `SELECT id, version, status, area_id, parent_task_id, recurrence_rule,
              generated_from_task_id, start
       FROM tasks WHERE id = ? AND trashed_at IS NULL`,
    )
    .bind(id)
    .first<TaskRow>();
  if (!task) throw new TaskNotFoundError("Task was not found");
  if (task.version !== input.version) {
    throw new TaskConflictError("Task version does not match");
  }

  const allTasks = await database
    .prepare(
      `SELECT id, version, status, area_id, parent_task_id, recurrence_rule
       FROM tasks WHERE trashed_at IS NULL`,
    )
    .all<TaskRow>();
  const tasks = allTasks.results;

  if (input.status === "COMPLETED") {
    if (task.status === "COMPLETED") return;
    const descendantIds = descendantTaskIds(tasks, id);
    const openDescendants = tasks.filter(
      (candidate) =>
        descendantIds.has(candidate.id) && candidate.status === "OPEN",
    );
    if (
      input.cascadeDescendants &&
      Object.keys(input.descendantVersions).length !== openDescendants.length
    ) {
      throw new TaskConflictError("Cascade descendant versions do not match.");
    }
    if (input.cascadeDescendants && openDescendants.length > 0) {
      if (openDescendants.some((candidate) => candidate.recurrence_rule)) {
        throw new TaskHasOpenRecurringDescendantsError(
          openDescendants
            .filter((candidate) => candidate.recurrence_rule)
            .map((candidate) => candidate.id),
        );
      }
      if (
        openDescendants.some(
          (candidate) =>
            input.descendantVersions[candidate.id] !== candidate.version,
        )
      ) {
        throw new TaskConflictError(
          "Cascade descendant versions do not match.",
        );
      }

      await completeTaskCascade(
        database,
        id,
        [task, ...openDescendants],
        new Date().toISOString(),
      );
      return;
    }
    const now = new Date().toISOString();
    const completeStatement = database
      .prepare(
        `WITH RECURSIVE descendants(id, path) AS (
           SELECT id, '/' || id || '/'
           FROM tasks
           WHERE parent_task_id = ? AND trashed_at IS NULL
           UNION ALL
           SELECT tasks.id, descendants.path || tasks.id || '/'
           FROM tasks
           INNER JOIN descendants ON tasks.parent_task_id = descendants.id
           WHERE tasks.trashed_at IS NULL
             AND instr(descendants.path, '/' || tasks.id || '/') = 0
         )
         UPDATE tasks
         SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
             version = version + 1
         WHERE id = ? AND version = ?
           AND NOT EXISTS (
             SELECT 1
             FROM descendants
             INNER JOIN tasks AS descendant ON descendant.id = descendants.id
             WHERE descendant.status = 'OPEN'
           )`,
      )
      .bind(id, now, now, id, input.version);
    const result = task.recurrence_rule
      ? await completeRecurringTask(
          database,
          completeStatement,
          id,
          task.recurrence_rule,
          task.start ?? null,
          now,
          input.version + 1,
        )
      : await completeStatement.run();
    if (result.meta.changes === 0) {
      const latestTasks = await database
        .prepare(
          `SELECT id, version, status, area_id, parent_task_id
           FROM tasks WHERE trashed_at IS NULL`,
        )
        .all<TaskRow>();
      const latest = latestTasks.results.find(
        (candidate) => candidate.id === id,
      );
      if (latest?.version === input.version) {
        const descendantIds = descendantTaskIds(latestTasks.results, id);
        if (
          latestTasks.results.some(
            (candidate) =>
              descendantIds.has(candidate.id) && candidate.status === "OPEN",
          )
        ) {
          throw new TaskHasOpenDescendantsError(
            "A Task with Open descendants cannot be completed.",
          );
        }
      }
      throw new TaskConflictError("Task version does not match");
    }
    return;
  }

  const reopenIds = completedAncestorIds(tasks, task);
  if (task.status === "COMPLETED") reopenIds.add(id);
  if (reopenIds.size === 0) return;

  const generatedNext = await database
    .prepare(
      `SELECT id, version, status, area_id, parent_task_id, recurrence_rule,
              generated_from_task_id, trashed_at
       FROM tasks WHERE generated_from_task_id = ?`,
    )
    .bind(id)
    .all<TaskRow>();
  if (
    generatedNext.results.some(
      (next) =>
        next.trashed_at !== null ||
        next.status !== "OPEN" ||
        next.version !== 1,
    )
  ) {
    throw new RecurrenceReopenConflictError(
      "The next occurrence has changed and cannot be removed.",
    );
  }

  for (const taskId of reopenIds) {
    const expectedVersion =
      taskId === id ? input.version : input.ancestorVersions[taskId];
    const currentTask = tasks.find((candidate) => candidate.id === taskId);
    if (!currentTask || expectedVersion !== currentTask.version) {
      throw new TaskConflictError("Task version does not match");
    }
  }

  const now = new Date().toISOString();
  const reopenStatements = [...reopenIds].map((taskId) => {
    const expectedVersion =
      taskId === id ? input.version : input.ancestorVersions[taskId];
    return database
      .prepare(
        `UPDATE tasks
           SET status = 'OPEN', completed_at = NULL, updated_at = ?,
               version = version + 1
           WHERE id = ? AND version = ? AND status = 'COMPLETED'
             AND (
               id != ?
               OR NOT EXISTS (
                 SELECT 1 FROM tasks
                 WHERE generated_from_task_id = ?
               )
             )`,
      )
      .bind(now, taskId, expectedVersion, id, id);
  });
  const results = await database.batch([
    database
      .prepare(
        `DELETE FROM tasks
         WHERE generated_from_task_id = ?
           AND trashed_at IS NULL
           AND status = 'OPEN'
           AND version = 1
           AND EXISTS (
             SELECT 1 FROM tasks AS source
             WHERE source.id = ?
               AND source.version = ?
               AND source.status = 'COMPLETED'
           )`,
      )
      .bind(id, id, input.version),
    ...[...reopenIds].map((taskId) =>
      database
        .prepare("DELETE FROM today_task_orders WHERE task_id = ?")
        .bind(taskId),
    ),
    ...reopenStatements,
  ]);
  const taskResults = results.slice(reopenIds.size + 1);
  if (taskResults.some((result) => result.meta.changes === 0)) {
    throw new TaskConflictError("Task version does not match");
  }
}

async function completeTaskCascade(
  database: D1Database,
  rootId: string,
  tasks: Array<Pick<TaskRow, "id" | "version">>,
  completedAt: string,
) {
  const values = tasks.map(() => "(?, ?)").join(", ");
  const expected = tasks.flatMap((task) => [task.id, task.version]);
  const result = await database
    .prepare(
      `WITH RECURSIVE expected(id, expected_version) AS (VALUES ${values}),
       descendants(id, path) AS (
         SELECT id, '/' || id || '/'
         FROM tasks
         WHERE parent_task_id = ? AND trashed_at IS NULL
         UNION ALL
         SELECT tasks.id, descendants.path || tasks.id || '/'
         FROM tasks
         INNER JOIN descendants ON tasks.parent_task_id = descendants.id
         WHERE tasks.trashed_at IS NULL
           AND instr(descendants.path, '/' || tasks.id || '/') = 0
       ),
       current_open_descendants AS (
         SELECT tasks.id, tasks.version
         FROM tasks
         INNER JOIN descendants ON descendants.id = tasks.id
         WHERE tasks.status = 'OPEN' AND tasks.trashed_at IS NULL
       ),
       valid AS (
         SELECT EXISTS (
           SELECT 1
           FROM tasks
           INNER JOIN expected ON expected.id = tasks.id
           WHERE tasks.id = ?
             AND tasks.version = expected.expected_version
             AND tasks.status = 'OPEN'
             AND tasks.trashed_at IS NULL
         )
         AND (SELECT COUNT(*) FROM current_open_descendants) = ?
         AND NOT EXISTS (
           SELECT 1
           FROM expected
           WHERE expected.id <> ?
             AND NOT EXISTS (
               SELECT 1
               FROM current_open_descendants
               WHERE current_open_descendants.id = expected.id
                 AND current_open_descendants.version = expected.expected_version
             )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM current_open_descendants
           WHERE NOT EXISTS (
             SELECT 1 FROM expected
             WHERE expected.id = current_open_descendants.id
           )
         ) AS ok
       )
       UPDATE tasks
       SET status = 'COMPLETED', completed_at = ?, updated_at = ?,
           version = version + 1
       WHERE (SELECT ok FROM valid)
         AND status = 'OPEN'
         AND trashed_at IS NULL
         AND id IN (SELECT id FROM expected)
         AND version = (
           SELECT expected_version FROM expected WHERE expected.id = tasks.id
         )`,
    )
    .bind(
      ...expected,
      rootId,
      rootId,
      tasks.length - 1,
      rootId,
      completedAt,
      completedAt,
    )
    .run();
  if (result.meta.changes !== tasks.length) {
    throw new TaskConflictError("Task version does not match");
  }
}

export async function trashTask(
  database: D1Database,
  id: string,
  input: TaskVersionRequest,
) {
  const trashedAt = new Date().toISOString();
  const operationId = crypto.randomUUID();
  const result = await database
    .prepare(
      `WITH RECURSIVE descendants(id, path) AS (
         SELECT id, '/' || id || '/'
         FROM tasks
         WHERE id = ? AND trashed_at IS NULL AND version = ?
         UNION ALL
         SELECT tasks.id, descendants.path || tasks.id || '/'
         FROM tasks
         INNER JOIN descendants ON tasks.parent_task_id = descendants.id
         WHERE tasks.trashed_at IS NULL
           AND instr(descendants.path, '/' || tasks.id || '/') = 0
       )
       UPDATE tasks
       SET trashed_at = ?, trash_operation_id = ?, updated_at = ?, version = version + 1
       WHERE id IN (SELECT id FROM descendants) AND trashed_at IS NULL`,
    )
    .bind(id, input.version, trashedAt, operationId, trashedAt)
    .run();
  if (result.meta.changes === 0) {
    const current = await database
      .prepare("SELECT id FROM tasks WHERE id = ? AND trashed_at IS NULL")
      .bind(id)
      .first();
    if (!current) throw new TaskNotFoundError("Task was not found");
    throw new TaskConflictError("Task version does not match");
  }
}

export async function restoreTask(
  database: D1Database,
  id: string,
  input: TaskVersionRequest,
) {
  const restoredAt = new Date().toISOString();
  const result = await database
    .prepare(
      `WITH RECURSIVE ancestors(id, parent_task_id, trash_operation_id, depth, path) AS (
         SELECT id, parent_task_id, trash_operation_id, 0, '/' || id || '/'
         FROM tasks
         WHERE id = ?
           AND trashed_at IS NOT NULL
           AND trash_operation_id IS NOT NULL
           AND version = ?
         UNION ALL
         SELECT parent.id, parent.parent_task_id, parent.trash_operation_id,
                ancestors.depth + 1, ancestors.path || parent.id || '/'
         FROM tasks AS parent
         INNER JOIN ancestors ON parent.id = ancestors.parent_task_id
         WHERE parent.trashed_at IS NOT NULL
           AND parent.trash_operation_id = ancestors.trash_operation_id
           AND instr(ancestors.path, '/' || parent.id || '/') = 0
       ),
       root AS (
         SELECT id, trash_operation_id
         FROM ancestors
         ORDER BY depth DESC
         LIMIT 1
       ),
       descendants(id, path) AS (
         SELECT id, '/' || id || '/'
         FROM root
         UNION ALL
         SELECT tasks.id, descendants.path || tasks.id || '/'
         FROM tasks
         INNER JOIN descendants ON tasks.parent_task_id = descendants.id
         INNER JOIN root ON root.trash_operation_id = tasks.trash_operation_id
         WHERE tasks.trashed_at IS NOT NULL
           AND instr(descendants.path, '/' || tasks.id || '/') = 0
       )
       UPDATE tasks
       SET trashed_at = NULL, trash_operation_id = NULL, updated_at = ?, version = version + 1
       WHERE id IN (SELECT id FROM descendants) AND trashed_at IS NOT NULL`,
    )
    .bind(id, input.version, restoredAt)
    .run();
  if (result.meta.changes === 0) {
    const current = await database
      .prepare("SELECT id FROM tasks WHERE id = ? AND trashed_at IS NOT NULL")
      .bind(id)
      .first();
    if (!current) throw new TaskNotFoundError("Task was not found");
    throw new TaskConflictError("Task version does not match");
  }
}

async function validateParentTask(
  database: D1Database,
  areaId: number | null,
  parentId: string | null,
  movingTaskId?: string,
) {
  if (!parentId) return;
  if (areaId === null) {
    throw new TaskTreeError("Inbox Tasks cannot have a parent.");
  }

  const result = await database
    .prepare(
      `SELECT id, version, status, area_id, parent_task_id, recurrence_rule
       FROM tasks WHERE trashed_at IS NULL`,
    )
    .all<TaskRow>();
  const tasksById = new Map(result.results.map((task) => [task.id, task]));
  const parent = tasksById.get(parentId);
  if (!parent) throw new TaskTreeError("Parent Task was not found.");
  if (parent.area_id !== areaId) {
    throw new TaskTreeError("A Subtask must use the same Area as its parent.");
  }
  if (parent.status === "COMPLETED") {
    throw new TaskTreeError("A Completed Task cannot have a new Open Subtask.");
  }
  if (parent.recurrence_rule) {
    throw new RecurrenceRuleError("A Recurring Task cannot have Subtasks.");
  }

  if (movingTaskId) {
    const descendants = descendantTaskIds(result.results, movingTaskId);
    if (parentId === movingTaskId || descendants.has(parentId)) {
      throw new TaskTreeError(
        "A Task cannot be moved below itself or one of its Subtasks.",
      );
    }
  }

  let parentDepth = 0;
  let ancestor: TaskRow | undefined = parent;
  const visited = new Set<string>();
  while (ancestor) {
    if (visited.has(ancestor.id)) {
      throw new TaskTreeError("Task tree contains a cycle.");
    }
    visited.add(ancestor.id);
    parentDepth += 1;
    ancestor = ancestor.parent_task_id
      ? tasksById.get(ancestor.parent_task_id)
      : undefined;
  }

  const movingSubtreeDepth = movingTaskId
    ? subtreeDepth(result.results, movingTaskId)
    : 1;
  if (parentDepth + movingSubtreeDepth > 5) {
    throw new TaskTreeError("A Task cannot have more than five levels.");
  }
}

function descendantTaskIds(tasks: TaskRow[], parentId: string) {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (
        task.parent_task_id &&
        (task.parent_task_id === parentId ||
          descendants.has(task.parent_task_id)) &&
        !descendants.has(task.id)
      ) {
        descendants.add(task.id);
        changed = true;
      }
    }
  }
  return descendants;
}

function subtreeDepth(tasks: TaskRow[], rootId: string) {
  const childrenByParentId = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    const children = childrenByParentId.get(task.parent_task_id) ?? [];
    children.push(task);
    childrenByParentId.set(task.parent_task_id, children);
  }

  const pending = [{ id: rootId, depth: 1 }];
  const visited = new Set<string>();
  let maximumDepth = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (visited.has(current.id)) {
      throw new TaskTreeError("Task tree contains a cycle.");
    }
    visited.add(current.id);
    maximumDepth = Math.max(maximumDepth, current.depth);
    for (const child of childrenByParentId.get(current.id) ?? []) {
      pending.push({ id: child.id, depth: current.depth + 1 });
    }
  }
  return maximumDepth;
}

function completedAncestorIds(tasks: TaskRow[], task: TaskRow) {
  const tasksById = new Map(
    tasks.map((candidate) => [candidate.id, candidate]),
  );
  const completedIds = new Set<string>();
  const visited = new Set<string>([task.id]);
  let ancestorId = task.parent_task_id;
  while (ancestorId) {
    const ancestor = tasksById.get(ancestorId);
    if (!ancestor || visited.has(ancestor.id)) break;
    visited.add(ancestor.id);
    if (ancestor.status === "COMPLETED") completedIds.add(ancestor.id);
    ancestorId = ancestor.parent_task_id;
  }
  return completedIds;
}

function normalizedTagIds(tagIds: number[]) {
  return [...new Set(tagIds)];
}

async function validateTagIds(database: D1Database, tagIds: number[]) {
  if (tagIds.length === 0) return;

  const result = await database
    .prepare(
      `SELECT id FROM tags WHERE id IN (${tagIds.map(() => "?").join(", ")})`,
    )
    .bind(...tagIds)
    .all<{ id: number }>();
  if (result.results.length !== tagIds.length) {
    throw new TaskTagNotFoundError("One or more Tags were not found.");
  }
}

function normalizedTagNames(tags: string[]) {
  return [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ];
}

function validateRecurringTask(
  recurrenceRule: string | null,
  start: string | null,
  due: string | null,
) {
  if (!recurrenceRule) return null;
  let normalized: string;
  try {
    normalized = normalizeRecurrenceRule(recurrenceRule);
  } catch {
    throw new RecurrenceRuleError("Repeat syntax is invalid.");
  }
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new RecurrenceRuleError(
      "A Recurring Task requires a date-only Start.",
    );
  }
  if (due !== null && due !== start) {
    throw new RecurrenceRuleError("Recurring Task Due must equal Start.");
  }
  if (!recurrenceRuleMatchesDate(normalized, start)) {
    throw new RecurrenceRuleError("Start must match Repeat.");
  }
  return normalized;
}

async function completeRecurringTask(
  database: D1Database,
  completeStatement: D1PreparedStatement,
  sourceId: string,
  recurrenceRule: string,
  sourceStart: string | null,
  now: string,
  completedVersion: number,
) {
  const settings = await database
    .prepare("SELECT time_zone FROM owner_settings WHERE id = 1")
    .first<{ time_zone: string }>();
  if (!settings) throw new Error("Owner settings are not initialized");
  const completionDate = ownerToday(
    settings.time_zone,
    new Date(now).getTime(),
  );
  const nextStart = nextOccurrenceDate(
    recurrenceRule,
    sourceStart && sourceStart > completionDate ? sourceStart : completionDate,
  );
  const id = crypto.randomUUID();
  const results = await database.batch([
    completeStatement,
    database
      .prepare(
        `INSERT INTO tasks (
           id, title, description, work_notes, status, area_id, parent_task_id,
           start, due, completed_at, trashed_at, recurrence_rule,
           generated_from_task_id, created_at, updated_at
         )
         SELECT ?, title, description, '', 'OPEN', area_id, parent_task_id,
                ?, CASE WHEN due IS NULL THEN NULL ELSE ? END, NULL, NULL,
                recurrence_rule, ?, ?, ?
         FROM tasks
         WHERE id = ?
           AND status = 'COMPLETED'
           AND version = ?
           AND completed_at = ?
           AND updated_at = ?
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        id,
        nextStart,
        nextStart,
        sourceId,
        now,
        now,
        sourceId,
        completedVersion,
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO task_tags (task_id, tag_id)
         SELECT ?, tag_id FROM task_tags
         WHERE task_id = ?
           AND EXISTS (SELECT 1 FROM tasks WHERE id = ?)`,
      )
      .bind(id, sourceId, id),
  ]);
  return results[0];
}
