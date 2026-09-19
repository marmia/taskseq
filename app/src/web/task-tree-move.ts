import { MAX_TASK_DEPTH, type Task } from "../domain/task";
import type {
  MoveTaskRequest,
  TaskMoveAnchorPosition,
  TaskMovePosition,
} from "../shared/api-schema";

export type TaskTreeMoveContext = {
  rootGroupKey: string;
  tasks: Task[];
  allTasks: Task[];
  rootOrder?: string[];
  siblingOrders: Record<string, string[]>;
};

export type TaskMovePreview = {
  taskId: string;
  targetTaskId: string;
  position: TaskMovePosition;
  destinationParentId: string | null;
  anchorTaskId: string | null;
  anchorPosition: TaskMoveAnchorPosition;
  newDepth: number;
  valid: boolean;
  reason?: string;
  input?: MoveTaskRequest;
};

type ResolvedAnchor = {
  taskId: string | null;
  version?: number;
  position: TaskMoveAnchorPosition;
  reason?: string;
};

export function previewTaskMove(
  context: TaskTreeMoveContext,
  taskId: string,
  targetTaskId: string,
  position: TaskMovePosition,
): TaskMovePreview {
  const fallback: TaskMovePreview = {
    taskId,
    targetTaskId,
    position,
    destinationParentId: null,
    anchorTaskId: null,
    anchorPosition: position === "before" ? "before" : "after",
    newDepth: 0,
    valid: false,
  };
  const allTaskIds = new Set(context.allTasks.map((task) => task.id));
  const source = context.allTasks.find((task) => task.id === taskId);
  const target = context.allTasks.find((task) => task.id === targetTaskId);
  if (!source || source.trashedAt) {
    return { ...fallback, reason: "Task was not found." };
  }
  if (!target || target.trashedAt) {
    return { ...fallback, reason: "Drop target Task was not found." };
  }

  const destinationParentId =
    position === "as-last-child" ? target.id : (target.parentId ?? null);
  const descendants = descendantTaskIds(context.allTasks, source.id);
  const movingSubtreeDepth = subtreeDepth(context.allTasks, source.id);
  const invalidReason = validateDestination(
    context.allTasks,
    source,
    target,
    destinationParentId,
    descendants,
    movingSubtreeDepth,
  );
  const destinationParent = destinationParentId
    ? context.allTasks.find((task) => task.id === destinationParentId)
    : undefined;
  const newDepth = destinationParent
    ? taskDepth(context.allTasks, destinationParent.id) + 1
    : 1;
  if (invalidReason) {
    return {
      ...fallback,
      destinationParentId,
      newDepth,
      reason: invalidReason,
    };
  }

  const destinationGroupKey = destinationParentId
    ? `parent:${destinationParentId}`
    : context.rootGroupKey;
  const allSiblingIdsByGroup = groupTaskIds(
    context.allTasks,
    allTaskIds,
    context.rootGroupKey,
    context.rootOrder,
    context.siblingOrders,
  );
  const visibleSiblingIdsByGroup = groupTaskIds(
    context.tasks,
    allTaskIds,
    context.rootGroupKey,
    context.rootOrder,
    context.siblingOrders,
  );
  const anchor = resolveAnchor(
    context,
    source,
    target,
    position,
    destinationGroupKey,
    descendants,
    allSiblingIdsByGroup,
    visibleSiblingIdsByGroup,
  );
  if (anchor.reason) {
    return {
      ...fallback,
      destinationParentId,
      newDepth,
      reason: anchor.reason,
    };
  }

  const input: MoveTaskRequest = {
    taskId: source.id,
    taskVersion: source.version ?? 1,
    targetTaskId: target.id,
    targetTaskVersion: target.version ?? 1,
    position,
    ...(position === "as-last-child" && anchor.taskId
      ? {
          anchorTaskId: anchor.taskId,
          anchorTaskVersion: anchor.version,
          anchorPosition: anchor.position,
        }
      : {}),
  };
  return {
    taskId,
    targetTaskId,
    position,
    destinationParentId,
    anchorTaskId: anchor.taskId,
    anchorPosition: anchor.position,
    newDepth,
    valid: true,
    input,
  };
}

function validateDestination(
  tasks: Task[],
  source: Task,
  target: Task,
  destinationParentId: string | null,
  descendants: Set<string>,
  movingSubtreeDepth: number,
) {
  if (source.areaId !== target.areaId) {
    return "A Task subtree must stay within the same Area.";
  }
  if (target.id === source.id || descendants.has(target.id)) {
    return "A Task cannot be moved below itself or one of its Subtasks.";
  }
  if (!destinationParentId) return undefined;
  if (
    destinationParentId === source.id ||
    descendants.has(destinationParentId)
  ) {
    return "A Task cannot be moved below itself or one of its Subtasks.";
  }

  const parent = tasks.find((task) => task.id === destinationParentId);
  if (!parent || parent.trashedAt) return "Parent Task was not found.";
  if (parent.areaId !== source.areaId) {
    return "A Subtask must use the same Area as its parent.";
  }
  if (parent.status === "COMPLETED") {
    return "A Completed Task cannot have a new Open Subtask.";
  }
  if (parent.recurrenceRule) {
    return "A Recurring Task cannot have Subtasks.";
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  let parentDepth = 0;
  let ancestor: Task | undefined = parent;
  const visited = new Set<string>();
  while (ancestor) {
    if (visited.has(ancestor.id)) return "Task tree contains a cycle.";
    visited.add(ancestor.id);
    parentDepth += 1;
    ancestor = ancestor.parentId ? tasksById.get(ancestor.parentId) : undefined;
  }
  if (parentDepth + movingSubtreeDepth > MAX_TASK_DEPTH) {
    return "A Task cannot have more than five levels.";
  }
  return undefined;
}

function resolveAnchor(
  context: TaskTreeMoveContext,
  source: Task,
  target: Task,
  position: TaskMovePosition,
  destinationGroupKey: string,
  descendants: Set<string>,
  allSiblingIdsByGroup: Map<string, string[]>,
  visibleSiblingIdsByGroup: Map<string, string[]>,
): ResolvedAnchor {
  if (position === "before" || position === "after") {
    return {
      taskId: target.id,
      version: undefined,
      position,
    } as const;
  }

  const allSiblings = allSiblingIdsByGroup.get(destinationGroupKey) ?? [];
  const visibleSiblings =
    visibleSiblingIdsByGroup.get(destinationGroupKey) ?? [];
  const visibleSet = new Set(visibleSiblings);
  const activeTask = new Map(context.allTasks.map((task) => [task.id, task]));
  const visibleCandidates = visibleSiblings.filter(
    (taskId) =>
      taskId !== source.id &&
      !descendants.has(taskId) &&
      !activeTask.get(taskId)?.trashedAt,
  );
  const lastVisibleTaskId = visibleCandidates.at(-1);
  if (lastVisibleTaskId) {
    const lastVisibleTask = activeTask.get(lastVisibleTaskId);
    if (!lastVisibleTask) {
      return { taskId: null, position: "append" as const };
    }
    return {
      taskId: lastVisibleTask.id,
      version: lastVisibleTask.version ?? 1,
      position: "after" as const,
    };
  }

  const firstHiddenTaskId = allSiblings.find(
    (taskId) =>
      !visibleSet.has(taskId) &&
      taskId !== source.id &&
      !descendants.has(taskId) &&
      !activeTask.get(taskId)?.trashedAt,
  );
  if (firstHiddenTaskId) {
    const hiddenTask = activeTask.get(firstHiddenTaskId);
    if (!hiddenTask) {
      return { taskId: null, position: "append" as const };
    }
    return {
      taskId: hiddenTask.id,
      version: hiddenTask.version ?? 1,
      position: "before" as const,
    };
  }

  return { taskId: null, position: "append" as const };
}

function groupTaskIds(
  tasks: Task[],
  parentIds: Set<string>,
  rootGroupKey: string,
  rootOrder: string[] | undefined,
  siblingOrders: Record<string, string[]>,
) {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const groupKey = getGroupKey(task, parentIds, rootGroupKey);
    const group = groups.get(groupKey) ?? [];
    group.push(task);
    groups.set(groupKey, group);
  }
  return new Map(
    [...groups.entries()].map(([groupKey, groupTasks]) => {
      const savedOrder =
        groupKey === rootGroupKey ? rootOrder : siblingOrders[groupKey];
      return [groupKey, orderIdsBySavedOrder(groupTasks, savedOrder)] as [
        string,
        string[],
      ];
    }),
  );
}

function orderIdsBySavedOrder(tasks: Task[], savedOrder: string[] | undefined) {
  if (!savedOrder) return tasks.map((task) => task.id);
  const positions = new Map(savedOrder.map((id, index) => [id, index]));
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const leftPosition = positions.get(left.task.id);
      const rightPosition = positions.get(right.task.id);
      if (leftPosition === undefined && rightPosition === undefined) {
        return left.index - right.index;
      }
      if (leftPosition === undefined) return 1;
      if (rightPosition === undefined) return -1;
      return leftPosition - rightPosition;
    })
    .map(({ task }) => task.id);
}

function getGroupKey(task: Task, parentIds: Set<string>, rootGroupKey: string) {
  return task.parentId && parentIds.has(task.parentId)
    ? `parent:${task.parentId}`
    : rootGroupKey;
}

function descendantTaskIds(tasks: Task[], rootId: string) {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (
        task.parentId &&
        (task.parentId === rootId || descendants.has(task.parentId)) &&
        !descendants.has(task.id)
      ) {
        descendants.add(task.id);
        changed = true;
      }
    }
  }
  return descendants;
}

function subtreeDepth(tasks: Task[], rootId: string) {
  const childrenByParentId = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const children = childrenByParentId.get(task.parentId) ?? [];
    children.push(task);
    childrenByParentId.set(task.parentId, children);
  }

  const pending = [{ id: rootId, depth: 1 }];
  const visited = new Set<string>();
  let maximumDepth = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (visited.has(current.id)) return MAX_TASK_DEPTH + 1;
    visited.add(current.id);
    maximumDepth = Math.max(maximumDepth, current.depth);
    for (const child of childrenByParentId.get(current.id) ?? []) {
      pending.push({ id: child.id, depth: current.depth + 1 });
    }
  }
  return maximumDepth;
}

function taskDepth(tasks: Task[], taskId: string) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  let depth = 0;
  let current = tasksById.get(taskId);
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) return MAX_TASK_DEPTH + 1;
    visited.add(current.id);
    depth += 1;
    current = current.parentId ? tasksById.get(current.parentId) : undefined;
  }
  return depth;
}
