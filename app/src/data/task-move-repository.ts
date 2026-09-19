import { MAX_TASK_DEPTH, type TaskStatus } from "../domain/task";
import type { MoveTaskRequest } from "../shared/api-schema";
import {
  RecurrenceRuleError,
  TaskConflictError,
  TaskNotFoundError,
  TaskTreeError,
} from "./task-repository";

type TaskMoveRow = {
  id: string;
  version: number;
  status: TaskStatus;
  area_id: number;
  parent_task_id: string | null;
  recurrence_rule: string | null;
  trashed_at: string | null;
  created_at: string;
  is_system_managed: number;
};

type TaskOrderRow = {
  group_key: string;
  task_id: string;
  position: number;
};

type VersionGuard = {
  id: string;
  version: number;
};

const TASK_NOT_FOUND_MESSAGE = "Task was not found";
const ANCHOR_INVALID_MESSAGE = "The Task move anchor is no longer valid.";

export async function moveTask(database: D1Database, input: MoveTaskRequest) {
  const [taskResult, orderResult] = await Promise.all([
    database
      .prepare(
        `SELECT tasks.id, tasks.version, tasks.status, tasks.area_id,
                tasks.parent_task_id, tasks.recurrence_rule, tasks.trashed_at,
                tasks.created_at, areas.is_system_managed
         FROM tasks
         INNER JOIN areas ON areas.id = tasks.area_id`,
      )
      .all<TaskMoveRow>(),
    database
      .prepare(
        `SELECT group_key, task_id, position
         FROM task_manual_orders
         ORDER BY group_key, position`,
      )
      .all<TaskOrderRow>(),
  ]);
  const tasks = taskResult.results;
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const source = tasksById.get(input.taskId);
  const target = tasksById.get(input.targetTaskId);

  if (!source || source.trashed_at) {
    throw new TaskNotFoundError(TASK_NOT_FOUND_MESSAGE);
  }
  if (source.version !== input.taskVersion) {
    throw new TaskConflictError("Task version does not match");
  }
  if (!target || target.trashed_at) {
    throw new TaskNotFoundError(TASK_NOT_FOUND_MESSAGE);
  }
  if (target.version !== input.targetTaskVersion) {
    throw new TaskConflictError("Task version does not match");
  }
  if (source.area_id !== target.area_id) {
    throw new TaskTreeError("A Task subtree must stay within the same Area.");
  }

  const descendantIds = descendantTaskIds(tasks, source.id);
  if (target.id === source.id || descendantIds.has(target.id)) {
    throw new TaskTreeError(
      "A Task cannot be moved below itself or one of its Subtasks.",
    );
  }
  const movingSubtreeDepth = subtreeDepth(tasks, source.id);
  const destinationParentId =
    input.position === "as-last-child" ? target.id : target.parent_task_id;
  validateDestinationParent(
    tasksById,
    source,
    destinationParentId,
    descendantIds,
    movingSubtreeDepth,
  );
  const destinationParent = destinationParentId
    ? tasksById.get(destinationParentId)
    : undefined;

  const sourceGroupKey = taskGroupKey(source);
  const destinationGroupKey = destinationParentId
    ? `parent:${destinationParentId}`
    : taskGroupKey(source, true);
  const orders = buildOrders(tasks, orderResult.results);
  const anchor = resolveAnchor({
    input,
    source,
    target,
    destinationGroupKey,
    tasksById,
    descendantIds,
  });
  const nextOrders = moveInOrders({
    orders,
    source,
    sourceGroupKey,
    destinationGroupKey,
    anchor,
  });
  const parentChanged = source.parent_task_id !== destinationParentId;
  const guardedVersions: VersionGuard[] = [
    { id: source.id, version: input.taskVersion },
    { id: target.id, version: input.targetTaskVersion },
  ];
  if (destinationParent && destinationParent.id !== target.id) {
    guardedVersions.push({
      id: destinationParent.id,
      version: destinationParent.version,
    });
  }
  if (anchor?.version !== undefined) {
    guardedVersions.push({ id: anchor.id, version: anchor.version });
  }
  const now = new Date().toISOString();
  const guardSql = versionGuardSql(guardedVersions);
  const guardBindings = versionGuardBindings(guardedVersions);
  const statements = [
    database
      .prepare(`SELECT 1 AS valid WHERE ${guardSql}`)
      .bind(...guardBindings),
  ];

  if (parentChanged) {
    statements.push(
      database
        .prepare(
          `UPDATE tasks
           SET parent_task_id = ?, updated_at = ?, version = version + 1
           WHERE id = ? AND version = ? AND trashed_at IS NULL
             AND ${guardSql}`,
        )
        .bind(
          destinationParentId,
          now,
          source.id,
          input.taskVersion,
          ...guardBindings,
        ),
    );
  }

  const effectiveSourceVersion = parentChanged
    ? input.taskVersion + 1
    : input.taskVersion;
  const orderGuardBindings = versionGuardBindings([
    { id: source.id, version: effectiveSourceVersion },
    { id: target.id, version: input.targetTaskVersion },
    ...(destinationParent && destinationParent.id !== target.id
      ? [{ id: destinationParent.id, version: destinationParent.version }]
      : []),
    ...(anchor?.version !== undefined
      ? [{ id: anchor.id, version: anchor.version }]
      : []),
  ]);
  const orderGuardSql = versionGuardSql([
    { id: source.id, version: effectiveSourceVersion },
    { id: target.id, version: input.targetTaskVersion },
    ...(destinationParent && destinationParent.id !== target.id
      ? [{ id: destinationParent.id, version: destinationParent.version }]
      : []),
    ...(anchor?.version !== undefined
      ? [{ id: anchor.id, version: anchor.version }]
      : []),
  ]);
  for (const groupKey of new Set([sourceGroupKey, destinationGroupKey])) {
    statements.push(
      database
        .prepare(
          `DELETE FROM task_manual_orders
           WHERE group_key = ? AND ${orderGuardSql}`,
        )
        .bind(groupKey, ...orderGuardBindings),
    );
    for (const [position, taskId] of (
      nextOrders.get(groupKey) ?? []
    ).entries()) {
      statements.push(
        database
          .prepare(
            `INSERT INTO task_manual_orders (group_key, task_id, position)
             SELECT ?, ?, ? WHERE ${orderGuardSql}`,
          )
          .bind(groupKey, taskId, position, ...orderGuardBindings),
      );
    }
  }

  const results = await database.batch(statements);
  if ((results[0]?.results?.length ?? 0) === 0) {
    throw new TaskConflictError("Task version does not match");
  }
  if (parentChanged) {
    const updateResult = results[1];
    if (!updateResult || updateResult.meta.changes === 0) {
      throw new TaskConflictError("Task version does not match");
    }
  }
}

function validateDestinationParent(
  tasksById: Map<string, TaskMoveRow>,
  source: TaskMoveRow,
  destinationParentId: string | null,
  descendantIds: Set<string>,
  movingSubtreeDepth: number,
) {
  if (!destinationParentId) return;
  if (
    destinationParentId === source.id ||
    descendantIds.has(destinationParentId)
  ) {
    throw new TaskTreeError(
      "A Task cannot be moved below itself or one of its Subtasks.",
    );
  }

  const parent = tasksById.get(destinationParentId);
  if (!parent || parent.trashed_at) {
    throw new TaskTreeError("Parent Task was not found.");
  }
  if (parent.area_id !== source.area_id) {
    throw new TaskTreeError("A Subtask must use the same Area as its parent.");
  }
  if (parent.status === "COMPLETED") {
    throw new TaskTreeError("A Completed Task cannot have a new Open Subtask.");
  }
  if (parent.recurrence_rule) {
    throw new RecurrenceRuleError("A Recurring Task cannot have Subtasks.");
  }

  let parentDepth = 0;
  let ancestor: TaskMoveRow | undefined = parent;
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
  if (parentDepth + movingSubtreeDepth > MAX_TASK_DEPTH) {
    throw new TaskTreeError("A Task cannot have more than five levels.");
  }
}

function resolveAnchor({
  input,
  source,
  target,
  destinationGroupKey,
  tasksById,
  descendantIds,
}: {
  input: MoveTaskRequest;
  source: TaskMoveRow;
  target: TaskMoveRow;
  destinationGroupKey: string;
  tasksById: Map<string, TaskMoveRow>;
  descendantIds: Set<string>;
}) {
  const isChildMove = input.position === "as-last-child";
  if (!isChildMove && input.anchorTaskId && input.anchorTaskId !== target.id) {
    throw new TaskTreeError(ANCHOR_INVALID_MESSAGE);
  }
  if (!input.anchorTaskId && input.anchorTaskVersion !== undefined) {
    throw new TaskTreeError(ANCHOR_INVALID_MESSAGE);
  }
  if (
    !isChildMove &&
    input.anchorPosition !== undefined &&
    input.anchorPosition !== input.position
  ) {
    throw new TaskTreeError(ANCHOR_INVALID_MESSAGE);
  }
  if (
    isChildMove &&
    input.anchorTaskId &&
    (input.anchorPosition === "append" ||
      input.anchorTaskVersion === undefined ||
      input.anchorPosition === undefined)
  ) {
    throw new TaskTreeError(ANCHOR_INVALID_MESSAGE);
  }
  if (
    isChildMove &&
    !input.anchorTaskId &&
    input.anchorPosition !== undefined &&
    input.anchorPosition !== "append"
  ) {
    throw new TaskTreeError(ANCHOR_INVALID_MESSAGE);
  }

  const anchorId = isChildMove ? input.anchorTaskId : target.id;
  if (!anchorId) return null;
  const anchor = tasksById.get(anchorId);
  if (
    !anchor ||
    anchor.trashed_at ||
    anchor.area_id !== source.area_id ||
    anchor.id === source.id ||
    descendantIds.has(anchor.id) ||
    taskGroupKey(anchor) !== destinationGroupKey
  ) {
    throw new TaskTreeError(ANCHOR_INVALID_MESSAGE);
  }
  if (
    input.anchorTaskVersion !== undefined &&
    anchor.version !== input.anchorTaskVersion
  ) {
    throw new TaskConflictError("Task version does not match");
  }
  return {
    id: anchor.id,
    version:
      isChildMove && input.anchorTaskVersion !== undefined
        ? input.anchorTaskVersion
        : undefined,
    position: isChildMove
      ? (input.anchorPosition ?? "after")
      : input.position === "before"
        ? "before"
        : "after",
  };
}

function moveInOrders({
  orders,
  source,
  sourceGroupKey,
  destinationGroupKey,
  anchor,
}: {
  orders: Map<string, string[]>;
  source: TaskMoveRow;
  sourceGroupKey: string;
  destinationGroupKey: string;
  anchor: {
    id: string;
    version?: number;
    position: "before" | "after" | "append";
  } | null;
}) {
  const nextOrders = new Map(orders);
  const destinationIds = [...(orders.get(destinationGroupKey) ?? [])].filter(
    (taskId) => taskId !== source.id,
  );
  if (anchor && anchor.position !== "append") {
    const anchorIndex = destinationIds.indexOf(anchor.id);
    if (anchorIndex < 0) throw new TaskTreeError(ANCHOR_INVALID_MESSAGE);
    destinationIds.splice(
      anchor.position === "before" ? anchorIndex : anchorIndex + 1,
      0,
      source.id,
    );
  } else {
    destinationIds.push(source.id);
  }

  if (sourceGroupKey === destinationGroupKey) {
    nextOrders.set(destinationGroupKey, destinationIds);
    return nextOrders;
  }

  nextOrders.set(
    sourceGroupKey,
    (orders.get(sourceGroupKey) ?? []).filter((taskId) => taskId !== source.id),
  );
  nextOrders.set(destinationGroupKey, destinationIds);
  return nextOrders;
}

function buildOrders(tasks: TaskMoveRow[], rows: TaskOrderRow[]) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const tasksByGroup = new Map<string, TaskMoveRow[]>();
  for (const task of tasks) {
    const groupKey = taskGroupKey(task);
    const group = tasksByGroup.get(groupKey) ?? [];
    group.push(task);
    tasksByGroup.set(groupKey, group);
  }

  const savedIdsByGroup = new Map<string, string[]>();
  for (const row of rows) {
    const task = tasksById.get(row.task_id);
    if (!task || taskGroupKey(task) !== row.group_key) continue;
    const ids = savedIdsByGroup.get(row.group_key) ?? [];
    if (!ids.includes(row.task_id)) ids.push(row.task_id);
    savedIdsByGroup.set(row.group_key, ids);
  }

  return new Map(
    [...tasksByGroup.entries()].map(([groupKey, groupTasks]) => {
      const savedIds = savedIdsByGroup.get(groupKey) ?? [];
      const savedSet = new Set(savedIds);
      const missing = groupTasks
        .filter((task) => !savedSet.has(task.id))
        .sort((left, right) =>
          `${left.created_at}\u0000${left.id}`.localeCompare(
            `${right.created_at}\u0000${right.id}`,
          ),
        )
        .map((task) => task.id);
      return [groupKey, [...savedIds, ...missing]] as [string, string[]];
    }),
  );
}

function taskGroupKey(task: TaskMoveRow, root = false) {
  if (!root && task.parent_task_id) return `parent:${task.parent_task_id}`;
  return task.is_system_managed === 1 ? "inbox" : `area:${task.area_id}`;
}

function versionGuardSql(guards: VersionGuard[]) {
  return guards
    .map(
      () =>
        "EXISTS (SELECT 1 FROM tasks WHERE id = ? AND version = ? AND trashed_at IS NULL)",
    )
    .join(" AND ");
}

function versionGuardBindings(guards: VersionGuard[]) {
  return guards.flatMap((guard) => [guard.id, guard.version]);
}

function descendantTaskIds(tasks: TaskMoveRow[], rootId: string) {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (
        task.parent_task_id &&
        (task.parent_task_id === rootId ||
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

function subtreeDepth(tasks: TaskMoveRow[], rootId: string) {
  const childrenByParent = new Map<string, TaskMoveRow[]>();
  for (const task of tasks) {
    if (!task.parent_task_id) continue;
    const children = childrenByParent.get(task.parent_task_id) ?? [];
    children.push(task);
    childrenByParent.set(task.parent_task_id, children);
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
    for (const child of childrenByParent.get(current.id) ?? []) {
      pending.push({ id: child.id, depth: current.depth + 1 });
    }
  }
  return maximumDepth;
}
