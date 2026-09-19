import * as Dialog from "@radix-ui/react-dialog";
import { MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { canHaveSubtask, type Task } from "../../domain/task";
import { descendantTaskIds } from "../task-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type TaskContextMenuProps = {
  task: Task;
  tasks: Task[];
  largeControls?: boolean;
  compactListControls?: boolean;
  treeControls?: boolean;
  dataSlot?: string;
  onAddSubtask: () => void;
  onMoveToTrash: () => void;
};

export function TaskContextMenu({
  task,
  tasks,
  largeControls = false,
  compactListControls = false,
  treeControls = false,
  dataSlot,
  onAddSubtask,
  onMoveToTrash,
}: TaskContextMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const descendantIds = descendantTaskIds(tasks, task.id);
  const cascadeCount = tasks.filter(
    (candidate) =>
      candidate.id !== task.id &&
      descendantIds.has(candidate.id) &&
      !candidate.trashedAt,
  ).length;
  const canAddSubtask =
    task.status === "OPEN" &&
    !task.trashedAt &&
    !task.recurrenceRule &&
    canHaveSubtask(task);

  const moveToTrash = () => {
    setOpen(false);
    if (cascadeCount > 0) {
      setConfirmationOpen(true);
      return;
    }
    onMoveToTrash();
  };

  return (
    <div
      className={[
        "relative shrink-0",
        compactListControls ? "self-center" : "",
        compactListControls ? "mx-1" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("taskReview.task.actions", { title: task.title })}
            data-slot={dataSlot}
            className={[
              "grid shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900",
              treeControls
                ? "size-[30px]"
                : compactListControls
                  ? "h-11 w-[30px]"
                  : largeControls
                    ? "size-11"
                    : "size-9 min-[560px]:size-7",
            ].join(" ")}
            style={
              treeControls
                ? {
                    width: "30px",
                    height: "30px",
                    minHeight: "30px",
                    minWidth: "30px",
                  }
                : compactListControls
                  ? {
                      width: "30px",
                      height: "44px",
                      minHeight: "44px",
                      minWidth: "30px",
                    }
                  : largeControls
                    ? { minHeight: "44px", minWidth: "44px" }
                    : undefined
            }
          >
            <MoreHorizontal
              size={
                treeControls || compactListControls
                  ? 18
                  : largeControls
                    ? 24
                    : 18
              }
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label={t("taskReview.task.actions", { title: task.title })}
        >
          {canAddSubtask ? (
            <DropdownMenuItem
              onSelect={() => {
                setOpen(false);
                onAddSubtask();
              }}
              className="text-slate-700 hover:bg-slate-100"
            >
              <Plus size={16} aria-hidden="true" />
              {t("taskReview.contextMenu.addSubtask")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={moveToTrash}
            className="text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
          >
            <Trash2 size={16} aria-hidden="true" />
            {t("taskReview.contextMenu.moveToTrash")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TrashConfirmationDialog
        open={confirmationOpen}
        taskTitle={task.title}
        cascadeCount={cascadeCount}
        onOpenChange={setConfirmationOpen}
        onConfirm={onMoveToTrash}
      />
    </div>
  );
}

function TrashConfirmationDialog({
  open,
  taskTitle,
  cascadeCount,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  taskTitle: string;
  cascadeCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-bold">
                {t("taskReview.contextMenu.confirmationTitle")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">
                {t("taskReview.contextMenu.confirmationDescription", {
                  title: taskTitle,
                  count: cascadeCount,
                })}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              aria-label={t("taskReview.contextMenu.close")}
            >
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              {t("taskReview.contextMenu.cancel")}
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
              className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700"
            >
              {t("taskReview.contextMenu.confirmationTitle")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
