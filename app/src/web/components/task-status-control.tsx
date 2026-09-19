import * as Dialog from "@radix-ui/react-dialog";
import { Check, Circle, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Area, Task } from "../../domain/task";
import {
  ApiRequestError,
  loadBootstrap,
  updateTaskStatus,
} from "../api-client";
import { useBootstrap } from "../bootstrap-state";
import { useNotifications } from "../notification-center";
import { useAppSettings } from "../settings-store";
import {
  descendantTaskIds,
  taskDescendantSummary,
  useTaskStore,
} from "../task-store";

export function TaskStatusControl({
  task,
  largeControls = false,
  compactListControls = false,
  treeControls = false,
  dataSlot,
  onComplete,
  onReopen,
  onSuccess,
}: {
  task: Task;
  largeControls?: boolean;
  compactListControls?: boolean;
  treeControls?: boolean;
  dataSlot?: string;
  onComplete?: (id: string, cascadeDescendants?: boolean) => void;
  onReopen?: (id: string) => void;
  onSuccess?: () => void;
}) {
  const { areas } = useAppSettings();
  const { tasks } = useTaskStore();
  const { replaceSnapshot } = useBootstrap();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const completed = task.status === "COMPLETED";
  const [cascadeDialogOpen, setCascadeDialogOpen] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const descendantIds = descendantTaskIds(tasks, task.id);
  const descendantSummary = taskDescendantSummary(tasks, task.id);
  const openRecurringDescendantTasks = descendantSummary.openRecurringTasks;
  const openDescendantTasks = tasks.filter(
    (candidate) =>
      candidate.id !== task.id &&
      descendantIds.has(candidate.id) &&
      candidate.status === "OPEN" &&
      !candidate.trashedAt,
  );
  const hasUnavailableCascadeVersion = openDescendantTasks.some(
    (candidate) => !candidate.version,
  );
  const ancestorVersions = taskAncestorVersions(tasks, task);
  const statusAction = completed
    ? t("taskReview.status.reopenVerb")
    : t("taskReview.status.completeVerb");
  const controlStyle: CSSProperties | undefined = treeControls
    ? { width: "30px", height: "30px", minHeight: "30px", minWidth: "30px" }
    : compactListControls
      ? { width: "30px", height: "44px", minHeight: "44px", minWidth: "30px" }
      : largeControls
        ? { minHeight: "44px", minWidth: "44px" }
        : undefined;

  const submitStatus = async (cascadeDescendants = false) => {
    if (!task.version) {
      if (completed) onReopen?.(task.id);
      else onComplete?.(task.id, cascadeDescendants);
      onSuccess?.();
      return;
    }

    setStatusPending(true);
    try {
      replaceSnapshot(
        await updateTaskStatus(task.id, {
          status: completed ? "OPEN" : "COMPLETED",
          version: task.version,
          cascadeDescendants,
          descendantVersions: cascadeDescendants
            ? Object.fromEntries(
                openDescendantTasks.map((candidate) => [
                  candidate.id,
                  candidate.version as number,
                ]),
              )
            : {},
          ancestorVersions,
        }),
      );
      onSuccess?.();
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === "TASK_VERSION_CONFLICT"
      ) {
        try {
          replaceSnapshot(await loadBootstrap());
          addNotification({
            type: "warning",
            message: t("taskReview.status.changedElsewhere", {
              title: task.title,
              action: statusAction,
            }),
          });
        } catch {
          addNotification({
            type: "error",
            message: t("taskReview.status.refreshFailed", {
              title: task.title,
              action: statusAction,
            }),
          });
        }
      } else if (
        error instanceof ApiRequestError &&
        error.code === "TASK_HAS_OPEN_DESCENDANTS"
      ) {
        addNotification({
          type: "warning",
          message: t("taskReview.status.openSubtasks", { title: task.title }),
        });
      } else if (
        error instanceof ApiRequestError &&
        error.code === "TASK_HAS_OPEN_RECURRING_DESCENDANTS"
      ) {
        addNotification({
          type: "warning",
          message: t("taskReview.status.openRecurring", {
            title: task.title,
          }),
        });
      } else if (
        error instanceof ApiRequestError &&
        error.code === "RECURRING_TASK_REOPEN_CONFLICT"
      ) {
        addNotification({
          type: "warning",
          message: t("taskReview.status.reopenRecurring", {
            title: task.title,
          }),
        });
      } else {
        addNotification({
          type: "error",
          message: t("taskReview.status.failed", {
            action: statusAction,
            title: task.title,
          }),
        });
      }
    } finally {
      setStatusPending(false);
    }
  };

  const changeStatus = () => {
    if (!completed && openDescendantTasks.length > 0) {
      setCascadeDialogOpen(true);
      return;
    }
    void submitStatus();
  };

  return (
    <div className="shrink-0">
      <button
        type="button"
        data-slot={dataSlot}
        className={
          treeControls
            ? "grid size-[30px] shrink-0 place-items-center rounded-lg transition hover:bg-slate-50"
            : compactListControls
              ? "grid h-11 w-[30px] shrink-0 place-items-center rounded-lg transition hover:bg-slate-50"
              : largeControls
                ? "grid size-11 shrink-0 place-items-center rounded-lg transition hover:bg-slate-50"
                : [
                    "grid size-9 min-[560px]:size-7 shrink-0 place-items-center rounded-full border transition",
                    completed
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-300 text-transparent hover:border-slate-900 hover:text-slate-700",
                  ].join(" ")
        }
        aria-label={
          completed
            ? t("taskReview.status.reopen", { title: task.title })
            : t("taskReview.status.complete", { title: task.title })
        }
        onClick={changeStatus}
        disabled={statusPending}
        style={controlStyle}
      >
        {largeControls || compactListControls || treeControls ? (
          <span
            aria-hidden="true"
            data-slot={
              compactListControls ? "task-list-status-visual" : undefined
            }
            className={[
              "grid place-items-center rounded-full border transition",
              treeControls
                ? "size-[18px]"
                : compactListControls
                  ? "size-[18px]"
                  : "size-6",
              completed
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-slate-300",
            ].join(" ")}
            style={
              compactListControls
                ? { width: "18px", height: "18px" }
                : undefined
            }
          >
            {completed ? <Check size={13} strokeWidth={3} /> : null}
          </span>
        ) : completed ? (
          <Check size={13} strokeWidth={3} />
        ) : (
          <Circle size={10} />
        )}
      </button>
      <CascadeCompletionDialog
        open={cascadeDialogOpen}
        taskTitle={task.title}
        targetTasks={[task, ...openDescendantTasks]}
        blockingRecurringTasks={openRecurringDescendantTasks}
        hasUnavailableVersion={hasUnavailableCascadeVersion}
        areas={areas}
        pending={statusPending}
        onOpenChange={setCascadeDialogOpen}
        onConfirm={() => void submitStatus(true)}
      />
    </div>
  );
}

function CascadeCompletionDialog({
  open,
  taskTitle,
  targetTasks,
  blockingRecurringTasks,
  hasUnavailableVersion,
  areas,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  taskTitle: string;
  targetTasks: Task[];
  blockingRecurringTasks: Task[];
  hasUnavailableVersion: boolean;
  areas: Area[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const hasRecurringBlocker = blockingRecurringTasks.length > 0;
  const hasBlocker = hasRecurringBlocker || hasUnavailableVersion;
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] max-h-[84vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-bold">
                {hasBlocker
                  ? t("taskReview.status.cascade.cannotCompleteParent")
                  : t("taskReview.status.cascade.completeParentAndDescendants")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">
                {hasRecurringBlocker
                  ? t("taskReview.status.cascade.recurringDescription", {
                      title: taskTitle,
                    })
                  : hasUnavailableVersion
                    ? t("taskReview.status.cascade.unavailableDescription")
                    : t("taskReview.status.cascade.targetDescription", {
                        title: taskTitle,
                        count: targetTasks.length - 1,
                      })}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              aria-label={t("taskReview.status.cascade.close")}
              disabled={pending}
            >
              <X size={16} />
            </Dialog.Close>
          </div>
          <ul
            aria-label={
              hasRecurringBlocker
                ? t("taskReview.status.cascade.recurringPaths")
                : t("taskReview.status.cascade.targetPaths")
            }
            className="mt-4 max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700"
          >
            {(hasRecurringBlocker ? blockingRecurringTasks : targetTasks).map(
              (target) => (
                <li key={target.id} className="break-words leading-6">
                  <TaskPath parts={taskPathParts(target, areas)} />
                </li>
              ),
            )}
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              disabled={pending}
            >
              {t("taskReview.status.cascade.cancel")}
            </Dialog.Close>
            {!hasBlocker ? (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onConfirm();
                }}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pending}
              >
                {t("taskReview.status.cascade.completeTasks", {
                  count: targetTasks.length,
                })}
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function taskAncestorVersions(tasks: Task[], task: Task) {
  const versions: Record<string, number> = {};
  const tasksById = new Map(
    tasks.map((candidate) => [candidate.id, candidate]),
  );
  let ancestorId = task.parentId;
  while (ancestorId) {
    const ancestor = tasksById.get(ancestorId);
    if (!ancestor) break;
    if (ancestor.version) versions[ancestor.id] = ancestor.version;
    ancestorId = ancestor.parentId;
  }
  return versions;
}

export function taskDisplayPath(task: Task, areas: Area[]) {
  return taskPathParts(task, areas)
    .map((part) => part.value)
    .join("/");
}

export type TaskPathPart = {
  value: string;
  language?: "en";
};

export function taskPathParts(
  task: Task,
  areas: Area[],
  { includeTaskTitle = true }: { includeTaskTitle?: boolean } = {},
): TaskPathPart[] {
  const area = areas.find((candidate) => candidate.id === task.areaId);
  const areaPart = area?.isSystemManaged
    ? { value: "Inbox", language: "en" as const }
    : { value: area?.name ?? task.path[0] };
  const taskPath = includeTaskTitle
    ? task.path.slice(1)
    : task.path.slice(1, -1);
  return [areaPart, ...taskPath.map((value) => ({ value }))];
}

export function TaskPath({
  parts,
  separator = "/",
}: {
  parts: TaskPathPart[];
  separator?: string;
}) {
  let pathKey = "";
  return parts.map((part, index) => {
    pathKey = pathKey
      ? `${pathKey}/${part.language ?? "user"}:${part.value}`
      : `${part.language ?? "user"}:${part.value}`;
    return (
      <span key={pathKey}>
        {index > 0 ? separator : null}
        <span lang={part.language}>{part.value}</span>
      </span>
    );
  });
}
