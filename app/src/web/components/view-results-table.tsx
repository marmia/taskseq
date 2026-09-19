import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Area, Task } from "../../domain/task";
import type { TaskResultColumn } from "../../shared/api-schema";
import { useTaskStore } from "../task-store";
import { EditTaskDialog } from "./edit-task-dialog";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskContextMenu } from "./task-context-menu";
import { TaskResultCell } from "./task-result-cell";
import { TaskStatusControl } from "./task-status-control";

export function ViewResultsTable({
  tasks,
  allTasks,
  areas,
  ownerTimeZone,
  columns,
  onMutationSuccess,
}: {
  tasks: Task[];
  allTasks: Task[];
  areas: Area[];
  ownerTimeZone: string;
  columns: TaskResultColumn[];
  onMutationSuccess: () => void;
}) {
  const { trashTask } = useTaskStore();
  const { t } = useTranslation();

  async function moveToTrash(taskId: string) {
    if (await trashTask(taskId)) onMutationSuccess();
  }

  return (
    <div className="overflow-x-auto">
      <table
        aria-label={t("viewResults.table.label")}
        className="min-w-full border-separate border-spacing-0 text-left text-sm"
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                aria-label={t(`viewResults.table.column.${column}`)}
                className={[
                  "border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-500",
                  column === "title"
                    ? "min-w-52 bg-slate-50 lg:sticky lg:left-0 lg:z-20"
                    : "min-w-32",
                ].join(" ")}
              >
                {t(`viewResults.table.column.${column}`)}
              </th>
            ))}
            <td
              role="presentation"
              aria-label={t("viewResults.table.actionsLabel")}
              className="border-b border-slate-200 bg-slate-50 px-2 py-2.5 lg:sticky lg:right-0 lg:z-20"
            />
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <ViewResultRow
              key={task.id}
              task={task}
              allTasks={allTasks}
              areas={areas}
              ownerTimeZone={ownerTimeZone}
              columns={columns}
              onMutationSuccess={onMutationSuccess}
              onMoveToTrash={() => void moveToTrash(task.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewResultRow({
  task,
  allTasks,
  areas,
  ownerTimeZone,
  columns,
  onMutationSuccess,
  onMoveToTrash,
}: {
  task: Task;
  allTasks: Task[];
  areas: Area[];
  ownerTimeZone: string;
  columns: TaskResultColumn[];
  onMutationSuccess: () => void;
  onMoveToTrash: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(false);

  return (
    <tr>
      {columns.map((column) => {
        const resultCell = (
          <TaskResultCell
            column={column}
            task={task}
            areas={areas}
            ownerTimeZone={ownerTimeZone}
            onEdit={() => setEditOpen(true)}
          />
        );

        return (
          <td
            key={column}
            className={[
              "border-b border-slate-100 px-3 py-3 align-top text-slate-700",
              column === "title"
                ? "min-w-52 bg-white lg:sticky lg:left-0 lg:z-10"
                : "min-w-32",
            ].join(" ")}
          >
            {column === "title" ? (
              <div className="flex items-start gap-2">
                <TaskStatusControl
                  task={task}
                  compactListControls
                  onSuccess={onMutationSuccess}
                />
                <div className="min-w-0 flex-1 pt-1">{resultCell}</div>
              </div>
            ) : (
              resultCell
            )}
          </td>
        );
      })}
      <td className="border-b border-slate-100 bg-white px-2 py-2 align-top lg:sticky lg:right-0 lg:z-10">
        <TaskContextMenu
          task={task}
          tasks={allTasks}
          largeControls
          onAddSubtask={() => setSubtaskOpen(true)}
          onMoveToTrash={onMoveToTrash}
        />
        <EditTaskDialog
          task={task}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={onMutationSuccess}
        />
        <NewTaskDialog
          open={subtaskOpen}
          onOpenChange={setSubtaskOpen}
          parentTask={task}
          onCreated={onMutationSuccess}
        />
      </td>
    </tr>
  );
}
