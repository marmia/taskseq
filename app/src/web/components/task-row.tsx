import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useFloating,
} from "@floating-ui/react-dom";
import {
  Calendar,
  ChevronDown,
  CornerDownRight,
  GripVertical,
  Repeat2,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Task } from "../../domain/task";
import {
  formatTaskDate,
  formatTaskDateTime,
  taskListDateRangeParts,
} from "../../domain/task-date";
import { useAppSettings } from "../settings-store";
import {
  isOverdue,
  taskDescendantSummary,
  taskDirectSubtaskSummary,
  useTaskStore,
} from "../task-store";
import { areaBorderColors } from "./area-color";
import { EditTaskDialog } from "./edit-task-dialog";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskContextMenu } from "./task-context-menu";
import {
  TaskPath,
  type TaskPathPart,
  TaskStatusControl,
  taskDisplayPath,
  taskPathParts,
} from "./task-status-control";

const taskListMetadataTone = "text-slate-400";
const taskListOverdueTone = "text-[#b05a48]";
const taskListTooltipCloseDelay = 120;
const taskListTooltipMiddleware = [
  offset(8),
  flip({ padding: 8, flipAlignment: false }),
  shift({ padding: 8 }),
  size({
    padding: 8,
    apply({ availableHeight, elements }) {
      elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
    },
  }),
];

type TaskRowProps = {
  task: Task;
  onComplete?: (id: string, cascadeDescendants?: boolean) => void;
  onReopen?: (id: string) => void;
  dragHandleProps?: Record<string, unknown>;
  dragHandlePlacement?: "start" | "end";
  dragging?: boolean;
  compact?: boolean;
  leadingControl?: ReactNode;
  editButtonRef?: Ref<HTMLButtonElement>;
  largeControls?: boolean;
  neutral?: boolean;
  detailsPresentation?: "inline" | "tooltip";
  taskListLayout?: boolean;
  taskListVariant?: "today" | "week";
};

type TaskTreeRowProps = {
  task: Task;
  depth: number;
  folder: boolean;
  expanded: boolean;
  onToggle: () => void;
  onComplete?: (id: string, cascadeDescendants?: boolean) => void;
  onReopen?: (id: string) => void;
  onSubtaskCreated?: () => void;
  dragHandleProps?: Record<string, unknown>;
  dragging?: boolean;
  editButtonRef?: Ref<HTMLButtonElement>;
  showPath?: boolean;
};

export function TaskRow({
  task,
  onComplete,
  onReopen,
  dragHandleProps,
  dragHandlePlacement = "start",
  dragging,
  compact,
  leadingControl,
  editButtonRef,
  largeControls,
  neutral,
  detailsPresentation,
  taskListLayout,
  taskListVariant,
}: TaskRowProps) {
  const { areas, ownerTimeZone } = useAppSettings();
  const { tasks, trashTask } = useTaskStore();
  const { t } = useTranslation();
  const completed = task.status === "COMPLETED";
  const [editOpen, setEditOpen] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const area = areas.find((candidate) => candidate.id === task.areaId);
  const displayPathParts = taskPathParts(task, areas);
  const listDisplayPathParts = taskPathParts(task, areas, {
    includeTaskTitle: false,
  });
  const displayPath = taskDisplayPath(task, areas);
  const listDisplayPath = listDisplayPathParts
    .map((part) => part.value)
    .join(" / ");
  const descendantSummary = taskDescendantSummary(tasks, task.id);
  const directSubtaskSummary = taskDirectSubtaskSummary(tasks, task.id);
  const hasDetails = Boolean(task.description || task.workNotes);
  const resolvedDetailsPresentation =
    detailsPresentation ?? (taskListLayout ? "tooltip" : "inline");
  const showDetailsTooltip =
    taskListLayout || (resolvedDetailsPresentation === "tooltip" && hasDetails);
  const largeTaskControls = Boolean(largeControls);
  const controlSizeClass = largeTaskControls
    ? "size-11"
    : "size-9 min-[560px]:size-7";
  const largeControlStyle: CSSProperties | undefined = largeTaskControls
    ? { minHeight: "44px", minWidth: "44px" }
    : undefined;
  const listDragControlStyle: CSSProperties | undefined = taskListLayout
    ? {
        width: "28px",
        height: "44px",
        minWidth: "28px",
        minHeight: "44px",
      }
    : undefined;
  const titleDescriptionIds = showDetailsTooltip ? detailsId : undefined;
  const tagBadges =
    task.tags.length > 0 ? (
      <div
        className={
          taskListLayout
            ? "flex shrink-0 flex-wrap gap-1.5"
            : "mt-2 flex flex-wrap gap-1.5"
        }
      >
        {task.tags.map((tag) => (
          <span
            key={tag.id}
            className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium leading-tight text-slate-500"
          >
            {tag.name}
          </span>
        ))}
      </div>
    ) : null;

  return (
    <article
      data-slot={taskListLayout ? "task-list-row" : undefined}
      style={
        neutral && !taskListLayout
          ? undefined
          : {
              borderLeftColor:
                area && !area.isSystemManaged
                  ? areaBorderColors[area.color]
                  : "rgb(203 213 225)",
            }
      }
      className={[
        "group relative flex min-w-0 items-start border-b border-b-slate-100 bg-white transition last:border-b-0",
        taskListLayout
          ? "min-h-[60px] gap-0 border-l-[3px]"
          : neutral
            ? "gap-3 border-l-0"
            : "gap-3 border-l-[3px]",
        taskListLayout
          ? ""
          : compact
            ? "px-3 py-3 min-[560px]:py-2.5"
            : "px-4 py-4 min-[560px]:py-3",
        taskListLayout && taskListVariant === "week" ? "pl-1" : "",
        dragging
          ? "relative z-20 rounded-xl shadow-xl ring-1 ring-slate-200"
          : "",
      ].join(" ")}
    >
      {leadingControl}

      {dragHandlePlacement === "start" && dragHandleProps ? (
        <button
          type="button"
          className={[
            taskListLayout
              ? "grid h-11 w-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
              : "grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing min-[560px]:size-7",
          ].join(" ")}
          aria-label={t("taskReview.task.reorder", { title: task.title })}
          {...dragHandleProps}
          style={taskListLayout ? listDragControlStyle : largeControlStyle}
        >
          <GripVertical
            width={taskListLayout ? 18 : largeTaskControls ? 24 : 16}
            height={taskListLayout ? 22 : largeTaskControls ? 24 : 16}
          />
        </button>
      ) : null}

      <TaskStatusControl
        task={task}
        largeControls={largeTaskControls}
        compactListControls={taskListLayout}
        onComplete={onComplete}
        onReopen={onReopen}
      />

      {taskListLayout ? (
        <TaskListContent
          task={task}
          completed={completed}
          overdue={isOverdue(task, ownerTimeZone)}
          displayPath={listDisplayPath}
          displayPathParts={listDisplayPathParts}
          directSubtaskSummary={directSubtaskSummary}
          ownerTimeZone={ownerTimeZone}
          detailsId={detailsId}
          detailsOpen={detailsOpen}
          onEdit={() => setEditOpen(true)}
          onDetailsOpen={() => setDetailsOpen(true)}
          onDetailsClose={() => setDetailsOpen(false)}
          editButtonRef={editButtonRef}
        />
      ) : (
        <div className="min-w-0 flex-1">
          <div className={showDetailsTooltip ? "relative min-w-0 flex-1" : ""}>
            <h3>
              <button
                type="button"
                ref={editButtonRef}
                aria-describedby={titleDescriptionIds}
                aria-label={t("taskReview.task.edit", { title: task.title })}
                onClick={() => setEditOpen(true)}
                onBlur={
                  showDetailsTooltip ? () => setDetailsOpen(false) : undefined
                }
                onFocus={
                  showDetailsTooltip ? () => setDetailsOpen(true) : undefined
                }
                onMouseEnter={
                  showDetailsTooltip ? () => setDetailsOpen(true) : undefined
                }
                onMouseLeave={
                  showDetailsTooltip ? () => setDetailsOpen(false) : undefined
                }
                className={[
                  "text-left text-sm font-semibold leading-5 hover:underline",
                  completed ? "text-slate-400 line-through" : "text-slate-900",
                ].join(" ")}
              >
                {task.title}
              </button>
            </h3>
            {showDetailsTooltip ? (
              <TaskDetailsTooltip
                id={detailsId}
                open={detailsOpen}
                taskListLayout={false}
                task={task}
                ownerTimeZone={ownerTimeZone}
              />
            ) : null}
          </div>
          <p
            className={[
              "mt-1 truncate text-xs",
              isOverdue(task, ownerTimeZone)
                ? "font-medium text-rose-600"
                : "text-slate-400",
            ].join(" ")}
            title={displayPath}
          >
            <TaskPath parts={displayPathParts} />
          </p>
          {descendantSummary.total > 0 ||
          descendantSummary.openRecurringTasks.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-slate-500">
              {descendantSummary.total > 0 ? (
                <span>
                  {t("taskReview.task.completedProgress", {
                    completed: descendantSummary.completed,
                    total: descendantSummary.total,
                  })}
                </span>
              ) : null}
              {descendantSummary.openRecurringTasks.length > 0 ? (
                <span>
                  {t(
                    descendantSummary.openRecurringTasks.length === 1
                      ? "taskReview.task.openRecurringCount.one"
                      : "taskReview.task.openRecurringCount.other",
                    { count: descendantSummary.openRecurringTasks.length },
                  )}
                </span>
              ) : null}
            </div>
          ) : null}
          {resolvedDetailsPresentation === "inline" ? (
            <InlineTaskDetails task={task} />
          ) : null}
          {tagBadges}
        </div>
      )}

      {!taskListLayout && task.due ? (
        <time
          className={[
            "shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold",
            isOverdue(task, ownerTimeZone)
              ? "bg-rose-50 text-rose-600"
              : "bg-slate-50 text-slate-500",
          ].join(" ")}
          dateTime={task.due}
        >
          {formatTaskDate(task.due, ownerTimeZone)}
        </time>
      ) : null}

      {dragHandlePlacement === "end" && dragHandleProps ? (
        <button
          type="button"
          className={`grid ${controlSizeClass} shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-300 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing`}
          aria-label={t("taskReview.task.reorder", { title: task.title })}
          {...dragHandleProps}
          style={largeControlStyle}
        >
          <GripVertical size={largeTaskControls ? 24 : 16} />
        </button>
      ) : null}

      <TaskContextMenu
        task={task}
        tasks={tasks}
        largeControls={largeControls}
        compactListControls={taskListLayout}
        onAddSubtask={() => setSubtaskOpen(true)}
        onMoveToTrash={() => trashTask(task.id)}
      />

      <EditTaskDialog task={task} open={editOpen} onOpenChange={setEditOpen} />
      <NewTaskDialog
        open={subtaskOpen}
        onOpenChange={setSubtaskOpen}
        parentTask={task}
      />
    </article>
  );
}

export function TaskTreeRow({
  task,
  depth,
  folder,
  expanded,
  onToggle,
  onComplete,
  onReopen,
  onSubtaskCreated,
  dragHandleProps,
  dragging,
  editButtonRef,
  showPath = true,
}: TaskTreeRowProps) {
  const { areas, ownerTimeZone } = useAppSettings();
  const { tasks, trashTask } = useTaskStore();
  const { t } = useTranslation();
  const completed = task.status === "COMPLETED";
  const overdue = isOverdue(task, ownerTimeZone);
  const displayPathParts = taskPathParts(task, areas, {
    includeTaskTitle: false,
  });
  const displayPath = displayPathParts.map((part) => part.value).join(" / ");
  const directSubtaskSummary = taskDirectSubtaskSummary(tasks, task.id);
  const [editOpen, setEditOpen] = useState(false);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  return (
    <article
      data-slot="task-tree-row"
      className={[
        "group relative flex min-w-0 border-b border-slate-100 bg-white transition",
        "min-h-[60px] items-start gap-0",
        dragging
          ? "relative z-20 rounded-lg shadow-xl ring-1 ring-slate-200"
          : "",
      ].join(" ")}
      style={{ minHeight: "60px" }}
    >
      <button
        type="button"
        data-slot="task-tree-drag-handle"
        className="grid h-11 w-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
        aria-label={t("taskReview.task.reorder", { title: task.title })}
        {...dragHandleProps}
        style={{
          width: "28px",
          height: "44px",
          minHeight: "44px",
          minWidth: "28px",
        }}
      >
        <GripVertical width={18} height={22} />
      </button>

      <span
        aria-hidden="true"
        data-slot="task-tree-depth-indent"
        className="h-11 shrink-0"
        style={{ width: `${depth * 16}px`, minHeight: "44px" }}
      />

      {folder ? (
        <button
          type="button"
          data-slot="task-tree-chevron"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("taskReview.task.collapse", { title: task.title })
              : t("taskReview.task.expand", { title: task.title })
          }
          className="grid h-11 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          style={{
            width: "24px",
            height: "44px",
            minHeight: "44px",
            minWidth: "24px",
          }}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <ChevronDown
            size={16}
            className={`transition ${expanded ? "" : "-rotate-90"}`}
          />
        </button>
      ) : (
        <span
          aria-hidden="true"
          data-slot="task-tree-chevron-placeholder"
          className="h-11 w-6 shrink-0"
          style={{
            width: "24px",
            height: "44px",
            minHeight: "44px",
            minWidth: "24px",
          }}
        />
      )}

      <TaskStatusControl
        task={task}
        compactListControls
        dataSlot="task-tree-status-control"
        onComplete={onComplete}
        onReopen={onReopen}
      />

      <TaskListContent
        task={task}
        completed={completed}
        overdue={overdue}
        displayPath={displayPath}
        displayPathParts={displayPathParts}
        directSubtaskSummary={directSubtaskSummary}
        ownerTimeZone={ownerTimeZone}
        detailsId={detailsId}
        detailsOpen={detailsOpen}
        onEdit={() => setEditOpen(true)}
        onDetailsOpen={() => setDetailsOpen(true)}
        onDetailsClose={() => setDetailsOpen(false)}
        editButtonRef={editButtonRef}
        showPath={showPath}
        slotPrefix="task-tree"
      />

      <TaskContextMenu
        task={task}
        tasks={tasks}
        compactListControls
        dataSlot="task-tree-context-menu"
        onAddSubtask={() => setSubtaskOpen(true)}
        onMoveToTrash={() => trashTask(task.id)}
      />
      <EditTaskDialog task={task} open={editOpen} onOpenChange={setEditOpen} />
      <NewTaskDialog
        open={subtaskOpen}
        onOpenChange={setSubtaskOpen}
        parentTask={task}
        onCreated={onSubtaskCreated}
      />
    </article>
  );
}

function InlineTaskDetails({ task }: { task: Task }) {
  const { t } = useTranslation();

  return (
    <>
      {task.description ? (
        <section
          aria-label={t("taskReview.task.description")}
          className="mt-2 text-xs leading-5 text-slate-600 [&_a]:underline [&_p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {task.description}
          </ReactMarkdown>
        </section>
      ) : null}
      {task.workNotes ? (
        <section
          aria-label={t("taskReview.task.workNotes")}
          className="mt-2 border-l-2 border-slate-200 pl-2 text-xs leading-5 text-slate-500 [&_a]:underline [&_p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4"
        >
          <h4 className="font-semibold text-slate-600">
            {t("taskReview.task.workNotes")}
          </h4>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {task.workNotes}
          </ReactMarkdown>
        </section>
      ) : null}
    </>
  );
}

function TaskListContent({
  task,
  completed,
  overdue,
  displayPath,
  displayPathParts,
  directSubtaskSummary,
  ownerTimeZone,
  detailsId,
  detailsOpen,
  onEdit,
  onDetailsOpen,
  onDetailsClose,
  editButtonRef,
  showPath = true,
  slotPrefix = "task-list",
}: {
  task: Task;
  completed: boolean;
  overdue: boolean;
  displayPath: string;
  displayPathParts: TaskPathPart[];
  directSubtaskSummary: {
    completed: number;
    total: number;
    openRecurringTasks: Task[];
  };
  ownerTimeZone: string;
  detailsId: string;
  detailsOpen: boolean;
  onEdit: () => void;
  onDetailsOpen: () => void;
  onDetailsClose: () => void;
  editButtonRef?: Ref<HTMLButtonElement>;
  showPath?: boolean;
  slotPrefix?: "task-list" | "task-tree";
}) {
  const { t } = useTranslation();
  const metadataTone = completed ? "text-slate-300" : taskListMetadataTone;
  const slot = (name: string) => `${slotPrefix}-${name}`;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleFocused = useRef(false);
  const { refs, floatingStyles, placement } = useFloating({
    open: detailsOpen,
    placement: "bottom-start",
    strategy: "fixed",
    middleware: taskListTooltipMiddleware,
    whileElementsMounted: autoUpdate,
  });
  const cancelScheduledClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const openDetails = useCallback(() => {
    cancelScheduledClose();
    onDetailsOpen();
  }, [cancelScheduledClose, onDetailsOpen]);
  const scheduleDetailsClose = useCallback(() => {
    cancelScheduledClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (!titleFocused.current) onDetailsClose();
    }, taskListTooltipCloseDelay);
  }, [cancelScheduledClose, onDetailsClose]);
  const setTitleReference = useCallback(
    (node: HTMLButtonElement | null) => {
      refs.setReference(node);
      if (typeof editButtonRef === "function") editButtonRef(node);
      else if (editButtonRef) editButtonRef.current = node;
    },
    [editButtonRef, refs.setReference],
  );

  useEffect(
    () => () => {
      cancelScheduledClose();
    },
    [cancelScheduledClose],
  );

  return (
    <div
      data-slot={slot("content")}
      className="ml-1 min-w-0 flex-1 self-start pb-1.5 pt-3"
    >
      <div className="relative min-w-0">
        <h3 className="min-w-0">
          <button
            type="button"
            data-slot={slot("title")}
            ref={setTitleReference}
            aria-describedby={detailsId}
            aria-label={t("taskReview.task.edit", { title: task.title })}
            onClick={onEdit}
            onBlur={() => {
              titleFocused.current = false;
              cancelScheduledClose();
              onDetailsClose();
            }}
            onFocus={() => {
              titleFocused.current = true;
              openDetails();
            }}
            onMouseEnter={openDetails}
            onMouseLeave={scheduleDetailsClose}
            className={[
              "inline-block max-w-full truncate text-left text-[15px] font-normal leading-5 hover:underline focus-visible:underline",
              completed ? "text-slate-400 line-through" : "text-slate-900",
            ].join(" ")}
            style={{
              fontSize: "15px",
              lineHeight: "20px",
              fontWeight: 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.title}
          </button>
        </h3>
        <TaskDetailsTooltip
          id={detailsId}
          open={detailsOpen}
          taskListLayout
          task={task}
          ownerTimeZone={ownerTimeZone}
          slotPrefix={slotPrefix}
          floatingRef={refs.setFloating}
          floatingStyles={floatingStyles}
          resolvedPlacement={placement}
          onMouseEnter={openDetails}
          onMouseLeave={scheduleDetailsClose}
        />
      </div>

      <div
        data-slot={slot("meta-row")}
        className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal leading-4"
        style={{ fontSize: "12px", lineHeight: "16px", fontWeight: 400 }}
      >
        <div
          data-slot={slot("metadata")}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap ${metadataTone}`}
        >
          <div
            data-slot={
              slotPrefix === "task-tree" ? slot("progress") : undefined
            }
            className="contents"
            style={{ fontSize: "12px", lineHeight: "16px" }}
          >
            {directSubtaskSummary.total > 0 ? (
              <span
                data-slot={slot("subtask-progress")}
                className="inline-flex items-center gap-1"
                role="img"
                aria-label={t("taskReview.task.subtaskProgress", {
                  completed: directSubtaskSummary.completed,
                  total: directSubtaskSummary.total,
                })}
              >
                <CornerDownRight
                  data-slot={slot("subtask-progress-icon")}
                  data-icon="corner-down-right"
                  size={14}
                  aria-hidden="true"
                />
                <span>
                  {directSubtaskSummary.completed}/{directSubtaskSummary.total}
                </span>
              </span>
            ) : null}
            {directSubtaskSummary.openRecurringTasks.length > 0 ? (
              <span
                data-slot={slot("open-recurring")}
                role="img"
                aria-label={t("taskReview.task.openRecurringSubtasks", {
                  count: directSubtaskSummary.openRecurringTasks.length,
                })}
              >
                ↻{directSubtaskSummary.openRecurringTasks.length}
              </span>
            ) : null}
            <TaskListDateRange
              task={task}
              completed={completed}
              overdue={overdue}
              ownerTimeZone={ownerTimeZone}
              slotPrefix={slotPrefix}
            />
            {task.recurrenceRule ? (
              <span
                role="img"
                aria-label={t("taskReview.task.recurring")}
                data-slot={slot("recurring")}
                className="inline-flex shrink-0 text-violet-600"
              >
                <Repeat2 size={14} aria-hidden="true" />
              </span>
            ) : null}
          </div>
        </div>
        {showPath ? (
          <p
            data-slot={slot("path")}
            className={`ml-auto min-w-0 max-w-full shrink-0 truncate text-right text-xs leading-4 ${metadataTone}`}
            title={displayPath}
            style={{
              direction: "rtl",
              fontSize: "12px",
              lineHeight: "16px",
            }}
          >
            <TaskPath parts={displayPathParts} separator=" / " />
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TaskListDateRange({
  task,
  completed,
  overdue,
  ownerTimeZone,
  slotPrefix,
}: {
  task: Task;
  completed: boolean;
  overdue: boolean;
  ownerTimeZone: string;
  slotPrefix: "task-list" | "task-tree";
}) {
  if (!task.start && !task.due) return null;

  const dateParts = taskListDateRangeParts(task.start, task.due, ownerTimeZone);
  if (!dateParts) return null;

  const { startDate, dueDate, sameDate } = dateParts;
  const neutralTone = completed ? "text-slate-300" : taskListMetadataTone;
  const dueTone = !completed && overdue ? taskListOverdueTone : neutralTone;
  const slot = (name: string) => `${slotPrefix}-${name}`;

  return (
    <span
      data-slot={slot("dates")}
      className="inline-flex items-center gap-1 whitespace-nowrap"
    >
      <Calendar
        data-slot={slot("calendar")}
        data-icon="calendar"
        size={14}
        aria-hidden="true"
        className={[
          "shrink-0",
          !completed && overdue ? taskListOverdueTone : "",
        ].join(" ")}
      />
      {sameDate ? (
        <span
          data-slot={task.due ? slot("due") : slot("start")}
          className={dueTone}
        >
          {startDate}
        </span>
      ) : (
        <>
          {startDate ? <span className={neutralTone}>{startDate}</span> : null}
          {startDate ? " " : null}
          <span className={neutralTone}>→</span>
          {dueDate ? " " : null}
          {dueDate ? (
            <span data-slot={slot("due")} className={dueTone}>
              {dueDate}
            </span>
          ) : null}
        </>
      )}
    </span>
  );
}

function TaskDetailsTooltip({
  id,
  open,
  taskListLayout,
  task,
  ownerTimeZone,
  slotPrefix,
  floatingRef,
  floatingStyles,
  resolvedPlacement,
  onMouseEnter,
  onMouseLeave,
}: {
  id: string;
  open: boolean;
  taskListLayout: boolean;
  task: Task;
  ownerTimeZone: string;
  slotPrefix?: "task-list" | "task-tree";
  floatingRef?: (node: HTMLElement | null) => void;
  floatingStyles?: CSSProperties;
  resolvedPlacement?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const { t } = useTranslation();
  const tooltip = (
    <div
      id={id}
      data-slot={slotPrefix ? `${slotPrefix}-tooltip` : undefined}
      data-placement={taskListLayout ? resolvedPlacement : undefined}
      ref={taskListLayout && open ? floatingRef : undefined}
      role="tooltip"
      aria-hidden={!open}
      onMouseEnter={taskListLayout ? onMouseEnter : undefined}
      onMouseLeave={taskListLayout ? onMouseLeave : undefined}
      className={[
        "rounded-xl border border-slate-200 bg-white p-3 leading-5 text-slate-600 shadow-xl transition-opacity",
        taskListLayout
          ? "fixed z-40 overflow-y-auto overscroll-contain [&_a]:pointer-events-none"
          : "pointer-events-none absolute top-full z-30 mt-2",
        taskListLayout ? "text-[13px]" : "text-xs",
        taskListLayout
          ? "w-[min(24rem,calc(100vw-4rem))]"
          : "w-[min(24rem,calc(100vw-2rem))]",
        taskListLayout ? "" : "left-0",
        open
          ? taskListLayout
            ? "visible pointer-events-auto opacity-100"
            : "visible pointer-events-none opacity-100"
          : "invisible pointer-events-none opacity-0",
      ].join(" ")}
      style={
        taskListLayout ? { ...floatingStyles, fontSize: "13px" } : undefined
      }
    >
      {taskListLayout ? (
        <TaskListTooltipContent task={task} ownerTimeZone={ownerTimeZone} />
      ) : (
        <>
          {task.description ? (
            <section
              aria-label={t("taskReview.task.description")}
              className="[&_a]:underline [&_p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4"
            >
              <h4 className="font-semibold text-slate-900">
                {t("taskReview.task.description")}
              </h4>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {task.description}
              </ReactMarkdown>
            </section>
          ) : null}
          {task.workNotes ? (
            <section
              aria-label={t("taskReview.task.workNotes")}
              className={[
                task.description ? "mt-3 border-t border-slate-100 pt-3" : "",
                "[&_a]:underline [&_p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4",
              ].join(" ")}
            >
              <h4 className="font-semibold text-slate-900">
                {t("taskReview.task.workNotes")}
              </h4>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {task.workNotes}
              </ReactMarkdown>
            </section>
          ) : null}
        </>
      )}
    </div>
  );

  return taskListLayout && typeof document !== "undefined"
    ? createPortal(tooltip, document.body)
    : tooltip;
}

function TaskListTooltipContent({
  task,
  ownerTimeZone,
}: {
  task: Task;
  ownerTimeZone: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      <p>
        <span className="font-semibold text-slate-900">
          {t("taskReview.task.title")}
        </span>{" "}
        {task.title}
      </p>
      {task.start ? (
        <p className="mt-1">
          <span className="font-semibold text-slate-900">
            {t("taskReview.task.start")}
          </span>{" "}
          {formatTaskDateTime(task.start, ownerTimeZone)}
        </p>
      ) : null}
      {task.due ? (
        <p className="mt-1">
          <span className="font-semibold text-slate-900">
            {t("taskReview.task.due")}
          </span>{" "}
          {formatTaskDateTime(task.due, ownerTimeZone)}
        </p>
      ) : null}
      {task.recurrenceRule ? (
        <p className="mt-1">
          <span className="font-semibold text-slate-900">
            {t("taskReview.task.repeatRule")}
          </span>{" "}
          {task.recurrenceRule}
        </p>
      ) : null}
      {task.tags.length > 0 ? (
        <p className="mt-1">
          <span className="font-semibold text-slate-900">
            {t("taskReview.task.tags")}
          </span>{" "}
          {task.tags.map((tag) => tag.name).join(", ")}
        </p>
      ) : null}
      {task.description ? (
        <section
          aria-label={t("taskReview.task.description")}
          className="mt-2 border-t border-slate-100 pt-2 [&_a]:underline [&_p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4"
        >
          <h4 className="font-semibold text-slate-900">
            {t("taskReview.task.description")}
          </h4>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {task.description}
          </ReactMarkdown>
        </section>
      ) : null}
      {task.workNotes ? (
        <section
          aria-label={t("taskReview.task.workNotes")}
          className="mt-2 border-t border-slate-100 pt-2 [&_a]:underline [&_p]:mt-1 [&_ul]:list-disc [&_ul]:pl-4"
        >
          <h4 className="font-semibold text-slate-900">
            {t("taskReview.task.workNotes")}
          </h4>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {task.workNotes}
          </ReactMarkdown>
        </section>
      ) : null}
    </>
  );
}

export function SortableTaskRow(props: Omit<TaskRowProps, "dragHandleProps">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.task.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <TaskRow
        {...props}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
