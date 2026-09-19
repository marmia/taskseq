import { TZDate } from "@date-fns/tz";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { format } from "date-fns";
import { enUS, ja } from "date-fns/locale";
import { CheckCircle2 } from "lucide-react";
import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import type { Task } from "../domain/task";
import { SortableTaskRow, TaskRow } from "./components/task-row";
import { useAppSettings } from "./settings-store";
import { useTaskStore } from "./task-store";

type TodayViewProps = {
  openTasks: Task[];
  completedTasks: Task[];
};

function TodayDnd({ tasks, children }: PropsWithChildren<{ tasks: Task[] }>) {
  const { reorderToday } = useTaskStore();
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((task) => task.id === active.id);
    const newIndex = tasks.findIndex((task) => task.id === over.id);
    reorderToday(arrayMove(tasks, oldIndex, newIndex).map((task) => task.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        screenReaderInstructions: {
          draggable: t("taskReview.today.dragHint"),
        },
      }}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="divide-y divide-slate-100">{children}</div>
      </SortableContext>
    </DndContext>
  );
}

export function TodayView({ openTasks, completedTasks }: TodayViewProps) {
  const { completeTask, reopenTask } = useTaskStore();
  const { ownerTimeZone } = useAppSettings();
  const { i18n, t } = useTranslation();
  const openTaskCountKey = openTasks.length === 1 ? "one" : "other";
  const openTaskCount = t(
    `taskReview.today.openTaskCount.${openTaskCountKey}`,
    {
      count: openTasks.length,
    },
  );
  const dateLocale = i18n.resolvedLanguage === "ja" ? ja : enUS;

  return (
    <div className="page-frame max-w-5xl">
      <header>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              lang="en"
              className="text-3xl font-black tracking-[-0.04em] min-[560px]:text-2xl"
            >
              Today
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {format(
                new TZDate(Date.now(), ownerTimeZone),
                i18n.resolvedLanguage === "ja" ? "M月d日 EEEE" : "MMMM d, EEEE",
                { locale: dateLocale },
              )}
            </p>
          </div>
          <p className="max-w-xs text-right text-xs leading-5 text-slate-400">
            {t("taskReview.today.dragHint")}
          </p>
        </div>
      </header>

      <div className="mt-8 min-[560px]:mt-5">
        <section className="overflow-visible rounded-3xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 min-[560px]:py-3">
            <div>
              <h2 className="text-sm font-bold">
                {t("taskReview.today.sectionHeading")}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">{openTaskCount}</p>
            </div>
            <span
              lang="en"
              className="rounded-full bg-lime-100 px-2.5 py-1 text-xs font-semibold text-lime-800"
            >
              {t("taskReview.today.orderBadge")}
            </span>
          </div>

          <TodayDnd tasks={openTasks}>
            {openTasks.length > 0 ? (
              openTasks.map((task) => (
                <SortableTaskRow
                  key={task.id}
                  task={task}
                  onComplete={completeTask}
                  compact
                  taskListLayout
                />
              ))
            ) : (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                {t("taskReview.today.empty")}
              </p>
            )}
          </TodayDnd>
        </section>
      </div>

      <section className="mt-8 min-[560px]:mt-5">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle2 size={17} className="text-emerald-600" />
          <h2 className="text-sm font-bold">
            {t("taskReview.today.completedHeading")}
          </h2>
          <span className="text-xs text-slate-400">
            {completedTasks.length}
          </span>
        </div>
        <div className="overflow-visible rounded-2xl border border-slate-200">
          {completedTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onReopen={reopenTask}
              compact
              taskListLayout
            />
          ))}
        </div>
      </section>
    </div>
  );
}
