import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { Area, Task } from "../domain/task";
import {
  isScheduledOpenTaskValue,
  isTaskDueBefore,
  ownerToday,
  taskDate,
} from "../domain/task-date";
import type { BootstrapResponse, MoveTaskRequest } from "../shared/api-schema";
import * as api from "./api-client";
import { useBootstrap } from "./bootstrap-state";
import { useNotifications } from "./notification-center";
import { useAppSettings } from "./settings-store";

type TaskStore = {
  tasks: Task[];
  areaTaskOrders: Record<string, string[]>;
  inboxOrder: string[];
  todayOrder: string[];
  completeTask: (id: string, cascadeDescendants?: boolean) => void;
  reopenTask: (id: string) => void;
  trashTask: (id: string) => Promise<boolean>;
  reorderToday: (ids: string[]) => void;
  moveTask: (input: MoveTaskRequest) => void;
  restoreTask: (id: string) => void;
};

const TaskStoreContext = createContext<TaskStore | null>(null);

export function TaskStoreProvider({ children }: PropsWithChildren) {
  const { snapshot, replaceSnapshot, isInitialSnapshot } = useBootstrap();
  const { ownerTimeZone } = useAppSettings();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>(snapshot.tasks);
  const [areaTaskOrders, setAreaTaskOrders] = useState<
    Record<string, string[]>
  >(snapshot.areaTaskOrders);
  const [inboxOrder, setInboxOrder] = useState<string[]>(snapshot.inboxOrder);
  const [todayOrders, setTodayOrders] = useState<Record<string, string[]>>(
    snapshot.todayOrders,
  );
  const [syncedSnapshot, setSyncedSnapshot] = useState(snapshot);
  if (syncedSnapshot !== snapshot) {
    setSyncedSnapshot(snapshot);
    setTasks(snapshot.tasks);
    setAreaTaskOrders(snapshot.areaTaskOrders);
    setInboxOrder(snapshot.inboxOrder);
    setTodayOrders(snapshot.todayOrders);
  }
  const today = ownerToday(ownerTimeZone);
  const todayOrder = todayOrders[today] ?? [];

  const completeTask = useCallback((id: string, cascadeDescendants = false) => {
    setTasks((current) => {
      if (!cascadeDescendants && !canCompleteTask(current, id)) {
        return current;
      }

      const completedIds = cascadeDescendants
        ? new Set(
            [...descendantTaskIds(current, id)].filter((candidateId) => {
              const candidate = current.find((task) => task.id === candidateId);
              return (
                candidateId === id ||
                (candidate?.status === "OPEN" && !candidate.trashedAt)
              );
            }),
          )
        : new Set([id]);
      const completedAt = new Date().toISOString();

      return current.map((task) =>
        completedIds.has(task.id)
          ? {
              ...task,
              status: "COMPLETED",
              completedAt,
            }
          : task,
      );
    });
  }, []);

  const reopenTask = useCallback(
    (id: string) => {
      setTodayOrders((current) => {
        const today = ownerToday(ownerTimeZone);
        const order = current[today];
        if (!order) return current;
        return { ...current, [today]: order.filter((taskId) => taskId !== id) };
      });
      setTasks((current) => {
        return reopenTaskAndCompletedAncestors(current, id);
      });
    },
    [ownerTimeZone],
  );

  const trashTask = useCallback(
    (id: string) => {
      const task = snapshot.tasks.find((candidate) => candidate.id === id);
      const optimisticSnapshot = {
        ...snapshot,
        tasks: trashTaskAndDescendants(
          snapshot.tasks,
          id,
          new Date().toISOString(),
          crypto.randomUUID(),
        ),
      };
      const changedTaskIds = changedTrashStateTaskIds(
        snapshot.tasks,
        optimisticSnapshot.tasks,
      );
      if (!isInitialSnapshot && !task?.version) {
        return Promise.resolve(false);
      }
      replaceSnapshot(optimisticSnapshot);
      if (isInitialSnapshot) {
        return Promise.resolve(true);
      }
      if (!task?.version) {
        replaceSnapshot(snapshot);
        return Promise.resolve(false);
      }
      return api.trashTask(id, { version: task.version }).then(
        (serverSnapshot) => {
          replaceSnapshot(serverSnapshot);
          return true;
        },
        async (error) => {
          if (error instanceof api.ApiRequestError && error.status === 409) {
            try {
              replaceSnapshot(await api.loadBootstrap());
              addNotification({
                type: "warning",
                message: t("taskReview.errors.trashConflict", {
                  title: task.title,
                }),
              });
            } catch {
              replaceSnapshot((current) =>
                rollbackTaskTrashState(
                  current,
                  snapshot,
                  optimisticSnapshot,
                  changedTaskIds,
                ),
              );
              addNotification({
                type: "error",
                message: t("taskReview.errors.trashRefresh", {
                  title: task.title,
                }),
              });
            }
            return false;
          }

          replaceSnapshot((current) =>
            rollbackTaskTrashState(
              current,
              snapshot,
              optimisticSnapshot,
              changedTaskIds,
            ),
          );
          const rejected = isDomainMutationRejection(error);
          addNotification({
            type: rejected ? "warning" : "error",
            message: rejected
              ? t("taskReview.errors.trashRejected", { title: task.title })
              : t("taskReview.errors.trashFailed", { title: task.title }),
          });
          return false;
        },
      );
    },
    [addNotification, isInitialSnapshot, replaceSnapshot, snapshot, t],
  );

  const reorderToday = useCallback(
    (ids: string[]) => {
      const today = ownerToday(ownerTimeZone);
      const optimisticSnapshot = {
        ...snapshot,
        todayOrders: { ...snapshot.todayOrders, [today]: ids },
      };
      replaceSnapshot(optimisticSnapshot);
      if (isInitialSnapshot) return;

      void api.reorderToday({ ids }).then(replaceSnapshot, (error) => {
        replaceSnapshot((current) =>
          rollbackTodayOrder(current, snapshot, today, ids),
        );
        const rejected = isDomainMutationRejection(error);
        addNotification({
          type: rejected ? "warning" : "error",
          message: rejected
            ? t("taskReview.errors.todayOrderRejected")
            : t("taskReview.errors.todayOrderFailed"),
        });
      });
    },
    [
      addNotification,
      isInitialSnapshot,
      ownerTimeZone,
      replaceSnapshot,
      snapshot,
      t,
    ],
  );

  const restoreTask = useCallback(
    (id: string) => {
      const task = snapshot.tasks.find((candidate) => candidate.id === id);
      const optimisticSnapshot = {
        ...snapshot,
        tasks: restoreTaskAndDescendants(snapshot.tasks, id),
      };
      const changedTaskIds = changedTrashStateTaskIds(
        snapshot.tasks,
        optimisticSnapshot.tasks,
      );
      if (!isInitialSnapshot && !task?.version) {
        return;
      }
      replaceSnapshot(optimisticSnapshot);
      if (isInitialSnapshot) {
        return;
      }
      if (!task?.version) {
        replaceSnapshot(snapshot);
        return;
      }
      void api
        .restoreTask(id, { version: task.version })
        .then(replaceSnapshot, async (error) => {
          if (error instanceof api.ApiRequestError && error.status === 409) {
            try {
              replaceSnapshot(await api.loadBootstrap());
              addNotification({
                type: "warning",
                message: t("taskReview.errors.restoreConflict", {
                  title: task.title,
                }),
              });
            } catch {
              replaceSnapshot((current) =>
                rollbackTaskTrashState(
                  current,
                  snapshot,
                  optimisticSnapshot,
                  changedTaskIds,
                ),
              );
              addNotification({
                type: "error",
                message: t("taskReview.errors.restoreRefresh", {
                  title: task.title,
                }),
              });
            }
            return;
          }

          replaceSnapshot((current) =>
            rollbackTaskTrashState(
              current,
              snapshot,
              optimisticSnapshot,
              changedTaskIds,
            ),
          );
          const rejected = isDomainMutationRejection(error);
          addNotification({
            type: rejected ? "warning" : "error",
            message: rejected
              ? t("taskReview.errors.restoreRejected", { title: task.title })
              : t("taskReview.errors.restoreFailed", { title: task.title }),
          });
        });
    },
    [addNotification, isInitialSnapshot, replaceSnapshot, snapshot, t],
  );

  const moveTask = useCallback(
    (input: MoveTaskRequest) => {
      const source = snapshot.tasks.find((task) => task.id === input.taskId);
      const target = snapshot.tasks.find(
        (task) => task.id === input.targetTaskId,
      );
      if (
        !source ||
        !target ||
        source.trashedAt ||
        target.trashedAt ||
        (source.version ?? 1) !== input.taskVersion ||
        (target.version ?? 1) !== input.targetTaskVersion
      ) {
        return;
      }

      const optimistic = applyOptimisticTaskMove(snapshot, input);
      if (!optimistic) return;
      replaceSnapshot(optimistic.snapshot);
      if (isInitialSnapshot) return;

      void api.moveTask(input).then(replaceSnapshot, async (error) => {
        if (error instanceof api.ApiRequestError && error.status === 409) {
          try {
            replaceSnapshot(await api.loadBootstrap());
            addNotification({
              type: "warning",
              message: t("taskReview.errors.moveConflict", {
                title: source.title,
              }),
            });
          } catch {
            replaceSnapshot((current) =>
              rollbackTaskMove(
                current,
                snapshot,
                optimistic.snapshot,
                optimistic.changedTaskIds,
                optimistic.changedOrderGroups,
              ),
            );
            addNotification({
              type: "error",
              message: t("taskReview.errors.moveRefresh", {
                title: source.title,
              }),
            });
          }
          return;
        }

        replaceSnapshot((current) =>
          rollbackTaskMove(
            current,
            snapshot,
            optimistic.snapshot,
            optimistic.changedTaskIds,
            optimistic.changedOrderGroups,
          ),
        );
        const rejected = isDomainMutationRejection(error);
        addNotification({
          type: rejected ? "warning" : "error",
          message: rejected
            ? t("taskReview.errors.moveRejected", { title: source.title })
            : t("taskReview.errors.moveFailed", { title: source.title }),
        });
      });
    },
    [addNotification, isInitialSnapshot, replaceSnapshot, snapshot, t],
  );

  const value = useMemo(
    () => ({
      tasks,
      areaTaskOrders,
      inboxOrder,
      todayOrder,
      completeTask,
      reopenTask,
      trashTask,
      reorderToday,
      moveTask,
      restoreTask,
    }),
    [
      tasks,
      areaTaskOrders,
      inboxOrder,
      todayOrder,
      completeTask,
      reopenTask,
      trashTask,
      reorderToday,
      moveTask,
      restoreTask,
    ],
  );

  return (
    <TaskStoreContext.Provider value={value}>
      {children}
    </TaskStoreContext.Provider>
  );
}

export function useTaskStore() {
  const store = useContext(TaskStoreContext);
  if (!store) {
    throw new Error("useTaskStore must be used inside TaskStoreProvider");
  }
  return store;
}

export function orderTasksByIds<T extends { id: string }>(
  tasks: T[],
  orderedIds: string[] | undefined,
) {
  if (!orderedIds) return tasks;

  const positions = new Map(orderedIds.map((id, index) => [id, index]));
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
    .map(({ task }) => task);
}

function changedTrashStateTaskIds(before: Task[], optimistic: Task[]) {
  const optimisticById = new Map(optimistic.map((task) => [task.id, task]));
  return new Set(
    before
      .filter((task) => {
        const next = optimisticById.get(task.id);
        return (
          next &&
          (next.trashedAt !== task.trashedAt ||
            next.trashOperationId !== task.trashOperationId)
        );
      })
      .map((task) => task.id),
  );
}

function rollbackTaskTrashState(
  current: BootstrapResponse,
  before: BootstrapResponse,
  optimistic: BootstrapResponse,
  changedTaskIds: Set<string>,
) {
  const beforeById = new Map(before.tasks.map((task) => [task.id, task]));
  const optimisticById = new Map(
    optimistic.tasks.map((task) => [task.id, task]),
  );
  return {
    ...current,
    tasks: current.tasks.map((task) => {
      if (!changedTaskIds.has(task.id)) return task;
      const previous = beforeById.get(task.id);
      const expected = optimisticById.get(task.id);
      if (
        !previous ||
        !expected ||
        task.trashedAt !== expected.trashedAt ||
        task.trashOperationId !== expected.trashOperationId
      ) {
        return task;
      }
      return {
        ...task,
        trashedAt: previous.trashedAt,
        trashOperationId: previous.trashOperationId,
      };
    }),
  };
}

function rollbackTodayOrder(
  current: BootstrapResponse,
  before: BootstrapResponse,
  today: string,
  optimisticOrder: string[],
) {
  if (!sameTaskOrder(current.todayOrders[today] ?? [], optimisticOrder)) {
    return current;
  }
  const todayOrders = { ...current.todayOrders };
  if (Object.hasOwn(before.todayOrders, today)) {
    todayOrders[today] = before.todayOrders[today];
  } else {
    delete todayOrders[today];
  }
  return { ...current, todayOrders };
}

type OptimisticTaskMove = {
  snapshot: BootstrapResponse;
  changedTaskIds: Set<string>;
  changedOrderGroups: Set<string>;
};

function applyOptimisticTaskMove(
  snapshot: BootstrapResponse,
  input: MoveTaskRequest,
): OptimisticTaskMove | null {
  const source = snapshot.tasks.find((task) => task.id === input.taskId);
  const target = snapshot.tasks.find((task) => task.id === input.targetTaskId);
  if (!source || !target) return null;

  const destinationParentId =
    input.position === "as-last-child" ? target.id : (target.parentId ?? null);
  const sourceGroupKey = taskSnapshotGroupKey(snapshot, source);
  const destinationGroupKey = destinationParentId
    ? `parent:${destinationParentId}`
    : taskSnapshotRootGroupKey(snapshot, source.areaId);
  const sourceOrder = taskSnapshotGroupIds(snapshot, sourceGroupKey);
  const destinationOrder =
    sourceGroupKey === destinationGroupKey
      ? sourceOrder
      : taskSnapshotGroupIds(snapshot, destinationGroupKey);
  const destinationWithoutSource = destinationOrder.filter(
    (taskId) => taskId !== source.id,
  );
  const anchorId =
    input.position === "as-last-child" ? input.anchorTaskId : target.id;
  const anchorPosition =
    input.position === "as-last-child"
      ? (input.anchorPosition ?? "append")
      : input.position;
  if (anchorId && !destinationWithoutSource.includes(anchorId)) return null;
  if (anchorPosition === "append" && anchorId) return null;
  if (anchorPosition !== "append" && !anchorId) return null;

  const nextDestinationOrder = [...destinationWithoutSource];
  if (anchorPosition === "append") {
    nextDestinationOrder.push(source.id);
  } else {
    if (!anchorId) return null;
    const anchorIndex = nextDestinationOrder.indexOf(anchorId);
    if (anchorIndex < 0) return null;
    nextDestinationOrder.splice(
      anchorPosition === "before" ? anchorIndex : anchorIndex + 1,
      0,
      source.id,
    );
  }
  const changedOrderGroups = new Set([sourceGroupKey, destinationGroupKey]);
  const nextAreaTaskOrders = { ...snapshot.areaTaskOrders };
  let nextInboxOrder = snapshot.inboxOrder;
  if (sourceGroupKey !== destinationGroupKey) {
    setTaskSnapshotGroupIds(
      nextAreaTaskOrders,
      (value) => {
        nextInboxOrder = value;
      },
      sourceGroupKey,
      sourceOrder.filter((taskId) => taskId !== source.id),
    );
  }
  setTaskSnapshotGroupIds(
    nextAreaTaskOrders,
    (value) => {
      nextInboxOrder = value;
    },
    destinationGroupKey,
    nextDestinationOrder,
  );

  const changedTaskIds = new Set<string>();
  let nextTasks = snapshot.tasks;
  if (source.parentId !== destinationParentId) {
    const subtreeIds = descendantTaskIds(snapshot.tasks, source.id);
    const area = snapshot.areas.find(
      (candidate) => candidate.id === source.areaId,
    );
    const areaName = area?.isSystemManaged
      ? "Inbox"
      : (area?.name ?? source.path[0]);
    const destinationParent = destinationParentId
      ? snapshot.tasks.find((task) => task.id === destinationParentId)
      : undefined;
    if (destinationParentId && !destinationParent) return null;
    const nextSourcePath = [
      ...(destinationParent?.path ?? [areaName]),
      source.title,
    ];
    nextTasks = snapshot.tasks.map((task) => {
      if (!subtreeIds.has(task.id)) return task;
      changedTaskIds.add(task.id);
      const suffix = task.path.slice(source.path.length);
      if (task.id === source.id) {
        const nextTask = { ...task, path: [...nextSourcePath] };
        if (destinationParentId) nextTask.parentId = destinationParentId;
        else delete nextTask.parentId;
        return nextTask;
      }
      return { ...task, path: [...nextSourcePath, ...suffix] };
    });
  }

  return {
    snapshot: {
      ...snapshot,
      tasks: nextTasks,
      areaTaskOrders: nextAreaTaskOrders,
      inboxOrder: nextInboxOrder,
    },
    changedTaskIds,
    changedOrderGroups,
  };
}

function rollbackTaskMove(
  current: BootstrapResponse,
  before: BootstrapResponse,
  optimistic: BootstrapResponse,
  changedTaskIds: Set<string>,
  changedOrderGroups: Set<string>,
) {
  const beforeById = new Map(before.tasks.map((task) => [task.id, task]));
  const optimisticById = new Map(
    optimistic.tasks.map((task) => [task.id, task]),
  );
  const tasks = current.tasks.map((task) => {
    if (!changedTaskIds.has(task.id)) return task;
    const previous = beforeById.get(task.id);
    const expected = optimisticById.get(task.id);
    if (
      !previous ||
      !expected ||
      task.parentId !== expected.parentId ||
      !sameIds(task.path, expected.path)
    ) {
      return task;
    }
    const restored = { ...task, path: previous.path };
    if (previous.parentId) restored.parentId = previous.parentId;
    else delete restored.parentId;
    return restored;
  });
  const areaTaskOrders = { ...current.areaTaskOrders };
  let inboxOrder = current.inboxOrder;
  for (const groupKey of changedOrderGroups) {
    const currentOrder = taskSnapshotGroupIds(current, groupKey);
    const optimisticOrder = taskSnapshotGroupIds(optimistic, groupKey);
    if (!sameTaskOrder(currentOrder, optimisticOrder)) continue;
    const beforeOrder = taskSnapshotGroupIds(before, groupKey);
    setTaskSnapshotGroupIds(
      areaTaskOrders,
      (value) => {
        inboxOrder = value;
      },
      groupKey,
      beforeOrder,
    );
  }
  return { ...current, tasks, areaTaskOrders, inboxOrder };
}

function taskSnapshotGroupIds(snapshot: BootstrapResponse, groupKey: string) {
  const groupTasks = snapshot.tasks.filter(
    (task) => taskSnapshotGroupKey(snapshot, task) === groupKey,
  );
  const savedOrder =
    groupKey === "inbox"
      ? snapshot.inboxOrder
      : snapshot.areaTaskOrders[groupKey];
  if (!savedOrder) return groupTasks.map((task) => task.id);
  const taskIds = new Set(groupTasks.map((task) => task.id));
  return [
    ...savedOrder.filter((taskId) => taskIds.has(taskId)),
    ...groupTasks
      .map((task) => task.id)
      .filter((taskId) => !savedOrder.includes(taskId)),
  ];
}

function taskSnapshotGroupKey(snapshot: BootstrapResponse, task: Task) {
  return task.parentId
    ? `parent:${task.parentId}`
    : taskSnapshotRootGroupKey(snapshot, task.areaId);
}

function taskSnapshotRootGroupKey(snapshot: BootstrapResponse, areaId: number) {
  return snapshot.areas.find((area) => area.id === areaId)?.isSystemManaged
    ? "inbox"
    : `area:${areaId}`;
}

function setTaskSnapshotGroupIds(
  areaTaskOrders: Record<string, string[]>,
  setInboxOrder: (value: string[]) => void,
  groupKey: string,
  ids: string[],
) {
  if (groupKey === "inbox") {
    setInboxOrder(ids);
  } else {
    areaTaskOrders[groupKey] = ids;
  }
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function sameTaskOrder(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((taskId, index) => taskId === right[index])
  );
}

function isDomainMutationRejection(error: unknown) {
  return (
    error instanceof api.ApiRequestError &&
    error.status !== 401 &&
    error.status >= 400 &&
    error.status < 500
  );
}

export function orderTodayTasks(
  tasks: Task[],
  orderedIds: string[],
  areas: Area[] = [],
) {
  const positions = new Map(orderedIds.map((id, index) => [id, index]));
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));
  return [...tasks].sort((left, right) => {
    const leftPosition = positions.get(left.id);
    const rightPosition = positions.get(right.id);
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return currentTaskPath(left, areaNames).localeCompare(
      currentTaskPath(right, areaNames),
    );
  });
}

export function restoreTaskAndDescendants(tasks: Task[], taskId: string) {
  const root = tasks.find((task) => task.id === taskId);
  if (!root) return tasks;

  const rootsToRestore = new Set([taskId]);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  let ancestor = root;
  while (ancestor.parentId) {
    const parent = tasksById.get(ancestor.parentId);
    if (!parent) break;
    if (parent.trashedAt) rootsToRestore.add(parent.id);
    ancestor = parent;
  }

  const restoredIds = new Set<string>();
  for (const rootId of rootsToRestore) {
    const restoreRoot = tasksById.get(rootId);
    if (!restoreRoot) continue;

    restoredIds.add(rootId);
    const descendantIds = descendantTaskIds(tasks, rootId);
    for (const task of tasks) {
      if (
        descendantIds.has(task.id) &&
        task.trashedAt &&
        restoreRoot.trashOperationId &&
        task.trashOperationId === restoreRoot.trashOperationId
      ) {
        restoredIds.add(task.id);
      }
    }
  }

  return tasks.map((task) => {
    if (!restoredIds.has(task.id)) return task;

    return { ...task, trashedAt: null, trashOperationId: null };
  });
}

export function reopenTaskAndCompletedAncestors(tasks: Task[], taskId: string) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return tasks;

  const reopenIds = new Set([taskId]);
  const tasksById = new Map(
    tasks.map((candidate) => [candidate.id, candidate]),
  );
  let ancestor = task;
  while (ancestor.parentId) {
    const parent = tasksById.get(ancestor.parentId);
    if (!parent) break;
    if (parent.status === "COMPLETED") reopenIds.add(parent.id);
    ancestor = parent;
  }

  return tasks.map((candidate) =>
    reopenIds.has(candidate.id)
      ? { ...candidate, status: "OPEN" as const, completedAt: null }
      : candidate,
  );
}

export function trashTaskAndDescendants(
  tasks: Task[],
  taskId: string,
  trashedAt: string,
  trashOperationId: string,
) {
  const root = tasks.find((task) => task.id === taskId);
  if (!root || root.trashedAt) return tasks;

  const descendantIds = descendantTaskIds(tasks, taskId);

  return tasks.map((task) => {
    const trashDescendant =
      task.id !== taskId && descendantIds.has(task.id) && !task.trashedAt;
    if (task.id !== taskId && !trashDescendant) return task;

    return { ...task, trashedAt, trashOperationId };
  });
}

export function descendantTaskIds(tasks: Task[], rootId: string) {
  const descendantIds = new Set([rootId]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const task of tasks) {
      if (
        task.parentId &&
        descendantIds.has(task.parentId) &&
        !descendantIds.has(task.id)
      ) {
        descendantIds.add(task.id);
        foundDescendant = true;
      }
    }
  }
  return descendantIds;
}

export function taskDescendantSummary(tasks: Task[], rootId: string) {
  const descendantIds = descendantTaskIds(tasks, rootId);
  const descendants = tasks.filter(
    (task) => task.id !== rootId && descendantIds.has(task.id),
  );
  return summarizeTaskGroup(descendants);
}

export function taskDirectSubtaskSummary(tasks: Task[], rootId: string) {
  return summarizeTaskGroup(tasks.filter((task) => task.parentId === rootId));
}

function summarizeTaskGroup(tasks: Task[]) {
  const activeTasks = tasks.filter((task) => !task.trashedAt);
  const finiteTasks = activeTasks.filter((task) => !task.recurrenceRule);

  return {
    completed: finiteTasks.filter((task) => task.status === "COMPLETED").length,
    total: finiteTasks.length,
    openRecurringTasks: activeTasks.filter(
      (task) => task.status === "OPEN" && Boolean(task.recurrenceRule),
    ),
  };
}

function currentTaskPath(task: Task, areaNames: Map<number, string>) {
  const areaName =
    task.areaId === null ? undefined : areaNames.get(task.areaId);
  return [areaName ?? task.path[0], ...task.path.slice(1)].join("/");
}

function hasDescendant(
  tasks: Task[],
  taskId: string,
  predicate: (task: Task) => boolean,
) {
  const pending = [taskId];
  const visited = new Set([taskId]);

  while (pending.length > 0) {
    const parentId = pending.shift();
    if (!parentId) continue;

    for (const candidate of tasks) {
      if (
        candidate.parentId !== parentId ||
        candidate.trashedAt ||
        visited.has(candidate.id)
      ) {
        continue;
      }

      if (predicate(candidate)) {
        return true;
      }

      visited.add(candidate.id);
      pending.push(candidate.id);
    }
  }

  return false;
}

export function canCompleteTask(tasks: Task[], taskId: string) {
  return !hasDescendant(
    tasks,
    taskId,
    (candidate) => candidate.status === "OPEN",
  );
}

export function isInSystemManagedArea(task: Task, areas: Area[]) {
  return areas.some((area) => area.id === task.areaId && area.isSystemManaged);
}

export function isActionableOpenTask(
  task: Task,
  tasks: Task[],
  _areas: Area[],
) {
  return (
    task.status === "OPEN" &&
    !task.trashedAt &&
    !hasDescendant(tasks, task.id, () => true)
  );
}

export function isTodayOpenTask(
  task: Task,
  _tasks: Task[],
  _areas: Area[],
  ownerTimeZone: string,
  today = ownerToday(ownerTimeZone),
) {
  return isScheduledOpenTaskValue(
    toScheduledOpenTaskValue(task),
    ownerTimeZone,
    today,
  );
}

export function isScheduledOpenTask(
  task: Task,
  _areas: Area[],
  ownerTimeZone: string,
  periodEnd: string,
) {
  return isScheduledOpenTaskValue(
    toScheduledOpenTaskValue(task),
    ownerTimeZone,
    periodEnd,
  );
}

function toScheduledOpenTaskValue(
  task: Pick<Task, "status" | "start" | "due" | "trashedAt">,
) {
  return {
    status: task.status,
    start: task.start,
    due: task.due,
    trashedAt: task.trashedAt,
  };
}

export function isCompletedToday(
  task: Task,
  _areas: Area[],
  ownerTimeZone: string,
  today = ownerToday(ownerTimeZone),
) {
  return (
    task.status === "COMPLETED" &&
    (task.completedAt
      ? taskDate(task.completedAt, ownerTimeZone) === today
      : false) &&
    !task.trashedAt
  );
}

export function isOverdue(
  task: Task,
  ownerTimeZone: string,
  today = ownerToday(ownerTimeZone),
) {
  return (
    task.status === "OPEN" &&
    task.due !== null &&
    isTaskDueBefore(task.due, today)
  );
}
