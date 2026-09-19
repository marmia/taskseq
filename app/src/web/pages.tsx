import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import {
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  GripVertical,
  Inbox as InboxIcon,
  Languages,
  Layers3,
  Plus,
  Settings2,
  Tag,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Link,
  Navigate,
  useLoaderData,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { z } from "zod";
import type { Area, AreaColor, Task } from "../domain/task";
import { ownerWeekEndDate } from "../domain/task-date";
import type {
  DisplayLanguage,
  TaskResultColumn,
  TaskSearchSortCondition,
  View,
} from "../shared/api-schema";
import {
  areaColorSchema,
  displayLanguageSchema,
  supportedDisplayLanguages,
} from "../shared/api-schema";
import * as api from "./api-client";
import { type AreaColorTone, areaColorTones } from "./components/area-color";
import { AreaDeleteDialog } from "./components/area-delete-dialog";
import { HeadlessTaskTree } from "./components/headless-task-tree";
import { TagDeleteDialog } from "./components/tag-delete-dialog";
import { TaskRow } from "./components/task-row";
import { ViewColumnsDialog, ViewSortDialog } from "./components/view-controls";
import {
  DeleteViewDialog,
  ViewDefinitionDialog,
} from "./components/view-management";
import { sortViews } from "./components/view-navigation";
import { ViewResultsTable } from "./components/view-results-table";
import { i18n } from "./i18n";
import { displayLanguageLabels } from "./i18n-resources";
import { useNotifications } from "./notification-center";
import {
  OwnerSettingsConflictError,
  settingsMutationFailure,
} from "./settings-mutation-errors";
import {
  activeAreasInPositionOrder,
  ownerTimeZoneOptions,
  ownerTimeZoneSchema,
  systemManagedInbox,
  useAppSettings,
  type WeekStartsOn,
  weekDayOptions,
  weekStartsOnSchema,
} from "./settings-store";
import {
  isCompletedToday,
  isScheduledOpenTask,
  isTodayOpenTask,
  orderTodayTasks,
  useTaskStore,
} from "./task-store";
import { TodayView } from "./today-page";
import { viewMutationFailure } from "./view-mutation-errors";

function nextAreaName(areas: { name: string }[]) {
  const existingNames = new Set(areas.map((area) => area.name));
  if (!existingNames.has("New Area")) return "New Area";

  let suffix = 2;
  while (existingNames.has(`New Area ${suffix}`)) suffix += 1;
  return `New Area ${suffix}`;
}

function PageHeader({
  eyebrow,
  title,
  description,
  backTo,
  titleLanguage,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  backTo?: string;
  titleLanguage?: "en";
}) {
  const { t } = useTranslation();

  return (
    <header className="mb-8 min-[560px]:mb-5">
      {backTo ? (
        <Link
          to={backTo}
          className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-950"
        >
          <ArrowLeft size={14} />
          {t("common.navigation.back")}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1
          lang={titleLanguage}
          className="text-3xl font-black tracking-[-0.04em] min-[560px]:text-2xl"
        >
          {title}
        </h1>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {eyebrow}
          </p>
        ) : null}
      </div>
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </header>
  );
}

function AreaDetailHeader({
  areaName,
  tone,
}: {
  areaName: string;
  tone: AreaColorTone;
}) {
  const { t } = useTranslation();

  return (
    <header
      className="mb-5 border-b border-slate-200 px-1 pb-5 pt-1"
      style={{ backgroundColor: tone.tint }}
    >
      <Link
        to="/areas"
        className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-950"
      >
        <ArrowLeft size={18} />
        {t("taskReview.area.back")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <span
          role="img"
          aria-label={t("taskReview.area.color", { name: areaName })}
          className="size-8 shrink-0 rounded-md"
          style={{ backgroundColor: tone.solid }}
        />
        <h1 className="text-3xl font-black tracking-[-0.04em] min-[560px]:text-2xl">
          {areaName}
        </h1>
        <span className="rounded-full bg-white/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          {t("taskReview.area.eyebrow")}
        </span>
      </div>
    </header>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white/50 p-8 text-center">
      <div>
        <Icon className="mx-auto text-slate-300" size={30} />
        <h2 className="mt-4 text-base font-bold">{title}</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
          {description}
        </p>
      </div>
    </div>
  );
}

export function TodayPage() {
  const { tasks, todayOrder } = useTaskStore();
  const { areas, ownerTimeZone } = useAppSettings();
  const openTasks = orderTodayTasks(
    tasks.filter((task) => isTodayOpenTask(task, tasks, areas, ownerTimeZone)),
    todayOrder,
    areas,
  );
  const completedTasks = tasks.filter((task) =>
    isCompletedToday(task, areas, ownerTimeZone),
  );

  return <TodayView openTasks={openTasks} completedTasks={completedTasks} />;
}

export function WeekPage() {
  const { tasks, completeTask } = useTaskStore();
  const { areas, ownerTimeZone, weekStartsOn } = useAppSettings();
  const { t } = useTranslation();
  const ownerAreas = activeAreasInPositionOrder(areas);
  const areaOrderById = new Map(
    ownerAreas.map((area, index) => [area.id, index]),
  );
  const inbox = systemManagedInbox(areas);
  const inboxOrder = ownerAreas.length;
  const fallbackOrder = inboxOrder + (inbox ? 1 : 0);
  const end = ownerWeekEndDate(weekStartsOn, ownerTimeZone);
  const weekEndsOn = ((weekStartsOn + 6) % 7) as WeekStartsOn;
  const weekdayKeys = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;
  const startDay = t(`taskReview.weekday.${weekdayKeys[weekStartsOn]}`);
  const endDay = t(`taskReview.weekday.${weekdayKeys[weekEndsOn]}`);
  const weekTasks = tasks
    .filter((task) => isScheduledOpenTask(task, areas, ownerTimeZone, end))
    .sort((left, right) => {
      const leftPosition =
        left.areaId === inbox?.id
          ? inboxOrder
          : (areaOrderById.get(left.areaId) ?? fallbackOrder);
      const rightPosition =
        right.areaId === inbox?.id
          ? inboxOrder
          : (areaOrderById.get(right.areaId) ?? fallbackOrder);
      const areaPositionDifference = leftPosition - rightPosition;
      return (
        areaPositionDifference ||
        left.path
          .slice(1)
          .join("/")
          .localeCompare(right.path.slice(1).join("/")) ||
        left.id.localeCompare(right.id)
      );
    });

  return (
    <div className="page-frame max-w-5xl">
      <PageHeader
        eyebrow={t("taskReview.week.range", { startDay, endDay })}
        title="This Week"
        titleLanguage="en"
        description={t("taskReview.week.description", { endDay })}
      />
      {weekTasks.length > 0 ? (
        <div className="overflow-visible rounded-3xl border border-slate-200 bg-white">
          {weekTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onComplete={completeTask}
              compact
              taskListLayout
              taskListVariant="week"
            />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/50 p-8 text-center text-sm text-slate-400">
          {t("taskReview.week.empty")}
        </div>
      )}
    </div>
  );
}

export function InboxPage() {
  const { tasks, areaTaskOrders, inboxOrder, moveTask } = useTaskStore();
  const { areas } = useAppSettings();
  const { t } = useTranslation();
  const inbox = systemManagedInbox(areas);
  const [showCompleted, setShowCompleted] = useState(false);
  const allInboxTasks = tasks.filter((task) => task.areaId === inbox?.id);
  const inboxTasks = allInboxTasks.filter(
    (task) => !task.trashedAt && (showCompleted || task.status === "OPEN"),
  );
  const openInboxTaskCount = allInboxTasks.filter(
    (task) => !task.trashedAt && task.status === "OPEN",
  ).length;
  const openTaskCountKey = openInboxTaskCount === 1 ? "one" : "other";

  return (
    <div className="page-frame max-w-5xl">
      <PageHeader
        title="Inbox"
        titleLanguage="en"
        description={t(`taskReview.inbox.openTaskCount.${openTaskCountKey}`, {
          count: openInboxTaskCount,
        })}
      />
      <div className="mb-4 flex justify-end rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.target.checked)}
            className="size-4 rounded border-slate-300"
          />
          {t("taskReview.inbox.showCompleted")}
        </label>
      </div>
      <HeadlessTaskTree
        key="inbox"
        rootGroupKey="inbox"
        tasks={inboxTasks}
        allTasks={allInboxTasks}
        rootOrder={inboxOrder}
        siblingOrders={areaTaskOrders}
        onMoveTask={moveTask}
        treeLabel={t("taskReview.inbox.treeLabel")}
      />
    </div>
  );
}

const colorClasses: Record<AreaColor, string> = {
  blue: "bg-blue-400",
  purple: "bg-purple-400",
  green: "bg-emerald-400",
  yellow: "bg-amber-300",
  orange: "bg-orange-400",
  pink: "bg-pink-400",
  brown: "bg-amber-700",
  gray: "bg-slate-400",
};

export function AreasPage() {
  const { t } = useTranslation();
  const { tasks } = useTaskStore();
  const { areas } = useAppSettings();
  const activeAreas = activeAreasInPositionOrder(areas);

  return (
    <div className="page-frame max-w-6xl">
      <PageHeader
        eyebrow={t("organization.areas.eyebrow")}
        title="Areas"
        titleLanguage="en"
        description={t("organization.areas.description")}
      />
      <div className="grid gap-3 min-[560px]:grid-cols-2 xl:grid-cols-3">
        {activeAreas.map((area) => {
          const taskCount = tasks.filter(
            (task) => task.areaId === area.id && !task.trashedAt,
          ).length;
          const taskCountKey = taskCount === 1 ? "one" : "other";
          return (
            <Link
              key={area.id}
              to={`/areas/${area.id}`}
              className="group rounded-3xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg min-[560px]:p-4"
            >
              <div className="flex items-start justify-between">
                <span
                  className={`size-3 rounded-full ${colorClasses[area.color]}`}
                />
                <ChevronRight
                  size={18}
                  className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-700"
                />
              </div>
              <h2 className="mt-8 text-xl font-black min-[560px]:mt-5">
                {area.name}
              </h2>
              <p className="mt-2 text-xs text-slate-400">
                {t(`organization.areas.taskCount.${taskCountKey}`, {
                  count: taskCount,
                })}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function ViewManagementPage() {
  const { views } = useAppSettings();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const [newViewOpen, setNewViewOpen] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const deletingViewRef = useRef<View | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const sortedViews = sortViews(views);
  const editingView = views.find((view) => view.id === editingViewId);
  const deletingView =
    views.find((view) => view.id === deletingViewId) ??
    (deletingViewId ? deletingViewRef.current : undefined);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setNewViewOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const state = location.state as { notice?: "view-not-found" } | null;
    if (!state?.notice) return;
    addNotification({
      type: "info",
      message: t("viewManagement.notice.notFound"),
    });
    navigate(location.pathname, { replace: true, state: null });
  }, [addNotification, location.pathname, location.state, navigate, t]);

  return (
    <div className="page-frame max-w-5xl">
      <PageHeader
        eyebrow={t("viewManagement.eyebrow")}
        title="Views"
        titleLanguage="en"
        description={t("viewManagement.description")}
      />

      <div className="mb-5 flex justify-end">
        <button
          type="button"
          onClick={() => setNewViewOpen(true)}
          className="min-h-10 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
        >
          {t("viewManagement.newView")}
        </button>
      </div>

      {sortedViews.length === 0 ? (
        <EmptyState
          icon={Layers3}
          title={t("viewManagement.empty.title")}
          description={t("viewManagement.empty.description")}
        />
      ) : (
        <ol
          aria-label={t("viewManagement.listLabel")}
          className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          {sortedViews.map((view) => (
            <li
              key={view.id}
              aria-label={view.name}
              className="flex flex-wrap items-center gap-3 px-4 py-4"
            >
              <h2 className="min-w-0 flex-1 text-sm font-bold">
                <Link
                  to={`/views/${view.id}`}
                  className="block truncate underline underline-offset-2 hover:text-slate-600"
                >
                  {view.name}
                </Link>
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingViewId(view.id)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                >
                  {t("viewManagement.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deletingViewRef.current = view;
                    setDeletingViewId(view.id);
                  }}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                >
                  {t("viewManagement.delete")}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <ViewDefinitionDialog
        open={newViewOpen}
        onOpenChange={setNewViewOpen}
        onCreated={(view) =>
          navigate(`/views/${view.id}`, {
            flushSync: true,
            state: { createdView: view },
          })
        }
      />
      {editingView ? (
        <ViewDefinitionDialog
          open
          view={editingView}
          onOpenChange={(open) => {
            if (!open) setEditingViewId(null);
          }}
          onUpdated={() => setEditingViewId(null)}
        />
      ) : null}
      {deletingView ? (
        <DeleteViewDialog
          view={deletingView}
          open
          onOpenChange={(open) => {
            if (!open) {
              deletingViewRef.current = undefined;
              setDeletingViewId(null);
            }
          }}
          onDeleted={() => {
            deletingViewRef.current = undefined;
            setDeletingViewId(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function ViewPage() {
  const { viewId } = useParams();
  const { areas, ownerTimeZone, updateView, views } = useAppSettings();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const { tasks: allTasks } = useTaskStore();
  const location = useLocation();
  const navigate = useNavigate();
  const currentViewIdRef = useRef(viewId);
  currentViewIdRef.current = viewId;
  const createdView = (location.state as { createdView?: View } | null)
    ?.createdView;
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [resultRefreshKey, setResultRefreshKey] = useState(0);
  const viewResultRequestVersion = useRef(0);
  const [resultState, setResultState] = useState<ViewResultState>({
    status: "loading",
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const deletingViewIdRef = useRef<string | null>(null);
  const deletingViewRef = useRef<View | undefined>(undefined);
  const deleteNavigatingRef = useRef(false);
  const view =
    views.find((candidate) => candidate.id === viewId) ??
    (createdView?.id === viewId ? createdView : undefined) ??
    (deletingViewId === viewId ? deletingViewRef.current : undefined);
  const redirectToMissingView = useCallback(() => {
    navigate("/views", {
      replace: true,
      state: { notice: "view-not-found" },
    });
  }, [navigate]);

  useEffect(() => {
    if (
      view ||
      createdView?.id === viewId ||
      deletingViewId === viewId ||
      deletingViewIdRef.current === viewId
    )
      return;
    redirectToMissingView();
  }, [createdView, deletingViewId, redirectToMissingView, view, viewId]);

  const currentViewId = view?.id;
  const loadResults = useCallback(() => {
    if (!currentViewId) return;
    void resultRefreshKey;
    const requestVersion = ++viewResultRequestVersion.current;
    setResultState({ status: "loading" });
    setIsLoadingMore(false);
    setLoadMoreError(false);

    void api.loadViewTasks(currentViewId).then(
      (result) => {
        if (requestVersion !== viewResultRequestVersion.current) return;
        setResultState({
          status: "ready",
          tasks: result.tasks,
          nextCursor: result.nextCursor,
        });
      },
      (error: unknown) => {
        if (requestVersion !== viewResultRequestVersion.current) return;
        if (
          error instanceof api.ApiRequestError &&
          error.status === 404 &&
          deletingViewIdRef.current !== currentViewId
        ) {
          redirectToMissingView();
          return;
        }
        setResultState({ status: "error" });
      },
    );
  }, [currentViewId, redirectToMissingView, resultRefreshKey]);

  useEffect(() => {
    loadResults();
    return () => {
      viewResultRequestVersion.current += 1;
    };
  }, [loadResults]);

  async function loadMoreResults() {
    if (
      !view ||
      resultState.status !== "ready" ||
      !resultState.nextCursor ||
      isLoadingMore
    ) {
      return;
    }

    setIsLoadingMore(true);
    setLoadMoreError(false);
    const requestVersion = viewResultRequestVersion.current;
    try {
      const result = await api.loadViewTasks(view.id, resultState.nextCursor);
      if (requestVersion !== viewResultRequestVersion.current) return;
      setResultState((current) => {
        if (current.status !== "ready") return current;
        return {
          status: "ready",
          tasks: [...current.tasks, ...result.tasks],
          nextCursor: result.nextCursor,
        };
      });
    } catch (error: unknown) {
      if (requestVersion === viewResultRequestVersion.current) {
        if (
          error instanceof api.ApiRequestError &&
          error.status === 404 &&
          deletingViewIdRef.current !== view.id
        ) {
          redirectToMissingView();
          return;
        }
        setLoadMoreError(true);
      }
    } finally {
      if (requestVersion === viewResultRequestVersion.current) {
        setIsLoadingMore(false);
      }
    }
  }

  const saveViewSettings = useCallback(
    async (
      operation: "sort" | "columns",
      sort: TaskSearchSortCondition[],
      columns: TaskResultColumn[],
      reloadResults: boolean,
    ) => {
      if (!view) return;
      try {
        await updateView(view.id, {
          name: view.name,
          allTasks: view.allTasks,
          conditions: view.conditions,
          sort,
          columns,
          version: view.version,
        });
        if (reloadResults) setResultRefreshKey((current) => current + 1);
      } catch (error: unknown) {
        addNotification(viewMutationFailure(operation, view.name, error, t));
      }
    },
    [addNotification, t, updateView, view],
  );

  if (!view) return null;

  return (
    <div className="page-frame max-w-5xl">
      <PageHeader
        eyebrow={t("viewResults.eyebrow")}
        title={view.name}
        description={t("viewResults.description")}
        backTo="/views"
      />
      <section
        aria-label={t("viewResults.controls.sectionLabel")}
        className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div
          role="toolbar"
          aria-label={t("viewResults.controls.toolbarLabel")}
          className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-800">
              {resultState.status === "ready"
                ? t(
                    `viewResults.controls.resultCount.${resultState.tasks.length === 1 ? "one" : "other"}`,
                    { count: resultState.tasks.length },
                  )
                : t("viewResults.action.loading")}
            </p>
            <button
              type="button"
              aria-label={t("viewResults.controls.filtersButton")}
              onClick={() => setEditOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-bold text-slate-800 hover:border-slate-500 hover:bg-slate-100"
            >
              {view.allTasks
                ? t("viewResults.controls.all")
                : t(
                    `viewResults.controls.filterCount.${view.conditions.length === 1 ? "one" : "other"}`,
                    { count: view.conditions.length },
                  )}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              aria-label={t("viewResults.controls.sortButton")}
              onClick={() => setSortOpen(true)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-slate-500 hover:bg-slate-100 hover:text-slate-950"
            >
              {t("viewResults.controls.sort")}
            </button>
            <button
              type="button"
              aria-label={t("viewResults.controls.columnsButton")}
              onClick={() => setColumnsOpen(true)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-slate-500 hover:bg-slate-100 hover:text-slate-950"
            >
              {t("viewResults.controls.columns")}
            </button>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                deletingViewRef.current = view;
                setDeleteOpen(true);
              }}
              className="min-h-10 rounded-lg border border-rose-200 bg-white px-3 text-sm font-bold text-rose-600 hover:bg-rose-50"
            >
              {t("viewManagement.delete")}
            </button>
          </div>
        </div>
        {resultState.status === "loading" ? (
          <p className="px-4 py-5 text-sm text-slate-500" role="status">
            {t("viewResults.state.loading")}
          </p>
        ) : null}
        {resultState.status === "error" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-5">
            <p className="text-sm text-rose-700" role="alert">
              {t("viewResults.state.loadError")}
            </p>
            <button
              type="button"
              onClick={loadResults}
              className="min-h-10 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:border-slate-500 hover:text-slate-950"
            >
              {t("viewResults.action.retry")}
            </button>
          </div>
        ) : null}
        {resultState.status === "ready" && resultState.tasks.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Layers3}
              title={t("viewResults.state.emptyTitle")}
              description={t("viewResults.state.emptyDescription")}
            />
          </div>
        ) : null}
        {resultState.status === "ready" && resultState.tasks.length > 0 ? (
          <ViewResultsTable
            tasks={resultState.tasks}
            allTasks={allTasks}
            areas={areas}
            ownerTimeZone={ownerTimeZone}
            columns={view.columns}
            onMutationSuccess={loadResults}
          />
        ) : null}
        {resultState.status === "ready" && resultState.nextCursor ? (
          <div className="border-t border-slate-200 px-4 py-3">
            {loadMoreError ? (
              <p className="mb-2 text-sm text-rose-700" role="alert">
                {t("viewResults.state.loadMoreError")}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void loadMoreResults()}
              disabled={isLoadingMore}
              className="min-h-11 w-full rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 transition hover:border-slate-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingMore
                ? t("viewResults.action.loading")
                : loadMoreError
                  ? t("viewResults.action.retry")
                  : t("viewResults.action.loadMore")}
            </button>
          </div>
        ) : null}
      </section>
      <ViewDefinitionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        view={view}
        onUpdated={() => setResultRefreshKey((current) => current + 1)}
      />
      <ViewSortDialog
        open={sortOpen}
        sort={view.sort}
        onOpenChange={setSortOpen}
        onChange={(sort) =>
          void saveViewSettings("sort", sort, view.columns, true)
        }
      />
      <ViewColumnsDialog
        open={columnsOpen}
        columns={view.columns}
        onOpenChange={setColumnsOpen}
        onChange={(columns) =>
          void saveViewSettings("columns", view.sort, columns, false)
        }
      />
      <DeleteViewDialog
        view={view}
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) {
            if (deleteNavigatingRef.current) {
              deleteNavigatingRef.current = false;
              return;
            }
            deletingViewRef.current = undefined;
            deletingViewIdRef.current = null;
            setDeletingViewId(null);
          }
        }}
        onDeleteStart={(id) => {
          deletingViewRef.current = view;
          deletingViewIdRef.current = id;
          viewResultRequestVersion.current += 1;
          setDeletingViewId(id);
        }}
        onDeleted={() => {
          const deletedViewId = deletingViewIdRef.current;
          if (currentViewIdRef.current === deletedViewId) {
            deleteNavigatingRef.current = true;
            navigate("/views");
            return;
          }
          deletingViewIdRef.current = null;
          setDeletingViewId((current) =>
            current === deletedViewId ? null : current,
          );
        }}
      />
    </div>
  );
}

type ViewResultState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; tasks: Task[]; nextCursor: string | null };

export function AreaDetailPage() {
  const { areaId } = useParams();
  const { tasks, areaTaskOrders, moveTask } = useTaskStore();
  const { areas } = useAppSettings();
  const { t } = useTranslation();
  const [showCompleted, setShowCompleted] = useState(false);
  const area = areas.find(
    (candidate) =>
      candidate.id === Number(areaId) &&
      !candidate.trashedAt &&
      !candidate.isSystemManaged,
  );
  if (!area) return <Navigate to="/areas" replace />;

  const allAreaTasks = tasks.filter((task) => task.areaId === area.id);
  const areaTasks = allAreaTasks.filter(
    (task) => !task.trashedAt && (showCompleted || task.status === "OPEN"),
  );
  const areaTone = areaColorTones[area.color];
  const rootGroupKey = `area:${area.id}`;

  return (
    <div className="page-frame max-w-5xl">
      <AreaDetailHeader areaName={area.name} tone={areaTone} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            {t("taskReview.area.heading")}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
                className="size-4 rounded border-slate-300"
              />
              {t("taskReview.area.showCompleted")}
            </label>
            <span className="text-xs text-slate-400">{areaTasks.length}</span>
          </div>
        </div>
        <section
          aria-label={t("taskReview.area.outlinerLabel")}
          className="overflow-visible rounded-2xl bg-white p-1"
        >
          <HeadlessTaskTree
            key={rootGroupKey}
            rootGroupKey={rootGroupKey}
            tasks={areaTasks}
            allTasks={allAreaTasks}
            showContainerBorder={false}
            showPath={false}
            rootOrder={areaTaskOrders[rootGroupKey]}
            siblingOrders={areaTaskOrders}
            onMoveTask={moveTask}
            treeLabel={t("taskReview.area.treeLabel")}
            emptyState={
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                {t("taskReview.area.empty")}
              </div>
            }
          />
        </section>
      </section>
    </div>
  );
}

export function TrashPage() {
  const { tasks, restoreTask } = useTaskStore();
  const { areas, restoreArea } = useAppSettings();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const trashedTasks = tasks.filter((task) => task.trashedAt);
  const trashedAreas = areas.filter((area) => area.trashedAt);
  const hasTrashedRecords = trashedTasks.length > 0 || trashedAreas.length > 0;

  return (
    <div className="page-frame max-w-5xl">
      <PageHeader
        eyebrow={t("taskReview.trash.retentionEyebrow")}
        title="Trash"
        titleLanguage="en"
        description={t("taskReview.trash.description")}
      />
      {hasTrashedRecords ? (
        <div className="space-y-3">
          {trashedTasks.map((task) => (
            <article
              key={task.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <Trash2 size={18} className="text-slate-400" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold">{task.title}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {t("taskReview.trash.trashed")}{" "}
                  {task.trashedAt
                    ? format(new Date(task.trashedAt), "yyyy-MM-dd")
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => restoreTask(task.id)}
                aria-label={t("taskReview.trash.restoreAria", {
                  name: task.title,
                })}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50"
              >
                <ArchiveRestore size={15} />
                {t("taskReview.trash.restore")}
              </button>
            </article>
          ))}
          {trashedAreas.map((area) => (
            <article
              key={area.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <Layers3 size={18} className="text-slate-400" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold">{area.name}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {t("taskReview.trash.areaTrashed")}{" "}
                  {area.trashedAt
                    ? format(new Date(area.trashedAt), "yyyy-MM-dd")
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  void restoreArea(area.id).catch((error: unknown) => {
                    const rejected =
                      error instanceof api.ApiRequestError &&
                      error.status !== 401 &&
                      error.status >= 400 &&
                      error.status < 500;
                    addNotification({
                      type: rejected ? "warning" : "error",
                      message: rejected
                        ? t("taskReview.errors.areaRestoreRejected", {
                            name: area.name,
                          })
                        : t("taskReview.errors.areaRestoreFailed", {
                            name: area.name,
                          }),
                    });
                  })
                }
                aria-label={t("taskReview.trash.restoreAria", {
                  name: area.name,
                })}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50"
              >
                <ArchiveRestore size={15} />
                {t("taskReview.trash.restore")}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Trash2}
          title={t("taskReview.trash.emptyTitle")}
          description={t("taskReview.trash.emptyDescription")}
        />
      )}
    </div>
  );
}

type HealthLoaderData = {
  status: "ready" | "unavailable";
};

const settingColors: AreaColor[] = [
  "blue",
  "purple",
  "green",
  "yellow",
  "orange",
  "pink",
  "brown",
  "gray",
];

const weekDayTranslationKeys = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function createSettingsFormSchema(t: TFunction) {
  return z.object({
    displayLanguage: displayLanguageSchema,
    timeZone: z
      .string()
      .refine(
        (value) => ownerTimeZoneSchema.safeParse(value).success,
        t("settings.validation.timeZone"),
      ),
    weekStartsOn: z
      .number()
      .refine(
        (value) => weekStartsOnSchema.safeParse(value).success,
        t("settings.validation.weekStartsOn"),
      ),
    trashRetentionDays: z
      .string()
      .regex(/^[1-9]\d*$/, t("settings.validation.trashRetentionDays")),
  });
}

function createAreaSettingsSchema(t: TFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t("organization.validation.areaNameRequired"))
      .refine(
        (name) => !name.includes(","),
        t("organization.validation.areaNameComma"),
      ),
    color: areaColorSchema,
  });
}

function createTagSettingsSchema(t: TFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, t("organization.validation.tagNameRequired"))
      .refine(
        (name) => !name.includes(","),
        t("organization.validation.tagNameComma"),
      ),
  });
}

type SettingsFormValues = z.infer<ReturnType<typeof createSettingsFormSchema>>;
type AreaSettingsFormValues = z.infer<
  ReturnType<typeof createAreaSettingsSchema>
>;
type TagSettingsFormValues = z.infer<
  ReturnType<typeof createTagSettingsSchema>
>;

function TagSettingsRow({ tag }: { tag: { id: number; name: string } }) {
  const { renameTag } = useAppSettings();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const tagSettingsSchema = useMemo(() => createTagSettingsSchema(t), [t]);
  const {
    handleSubmit,
    register,
    reset,
    setError,
    trigger,
    formState: { errors, isSubmitted },
  } = useForm<TagSettingsFormValues>({
    defaultValues: { name: tag.name },
    resolver: zodResolver(tagSettingsSchema),
  });
  useEffect(() => {
    reset({ name: tag.name });
  }, [reset, tag.name]);

  const save = async ({ name }: TagSettingsFormValues) => {
    if (name === tag.name) return;
    try {
      await renameTag(tag.id, name);
    } catch (error: unknown) {
      if (error instanceof api.ApiRequestError && error.fieldErrors.name) {
        setError("name", {
          type: "server",
          message: error.fieldErrors.name,
        });
        return;
      }
      addNotification(settingsMutationFailure("rename-tag", name, error, t));
    }
  };
  const nameField = register("name");
  const validationError = errors.name?.message;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-100 px-2 py-1.5 text-xs font-semibold">
      <input
        aria-label={t("organization.tags.rename", { name: tag.name })}
        aria-describedby={
          validationError ? `tag-name-error-${tag.id}` : undefined
        }
        aria-invalid={Boolean(validationError)}
        className="min-w-20 bg-transparent px-1 py-0.5 text-base outline-none min-[560px]:text-xs"
        {...nameField}
        onChange={(event) => {
          nameField.onChange(event);
          if (isSubmitted) void trigger("name");
        }}
        onBlur={(event) => {
          nameField.onBlur(event);
          void handleSubmit(save)();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            reset({ name: tag.name });
            event.currentTarget.blur();
          }
        }}
      />
      {validationError ? (
        <p
          id={`tag-name-error-${tag.id}`}
          role="alert"
          className="basis-full px-1 text-xs font-medium text-rose-600"
        >
          <span lang={errors.name?.type === "server" ? "en" : undefined}>
            {validationError}
          </span>
        </p>
      ) : null}
      <button
        type="button"
        className="text-slate-400 hover:text-rose-600"
        aria-label={t("organization.tags.delete", { name: tag.name })}
        onClick={() => setDeleteOpen(true)}
      >
        ×
      </button>
      <TagDeleteDialog
        tag={tag}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  );
}

function AreaSettingsRow({
  area,
  index,
  onMove,
  onDelete,
}: {
  area: Area;
  index: number;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (areaId: number) => void;
}) {
  const { updateArea } = useAppSettings();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const areaSettingsSchema = useMemo(() => createAreaSettingsSchema(t), [t]);
  const {
    handleSubmit,
    register,
    reset,
    setError,
    trigger,
    formState: { errors, isSubmitted },
  } = useForm<AreaSettingsFormValues>({
    defaultValues: { name: area.name, color: area.color },
    resolver: zodResolver(areaSettingsSchema),
  });

  useEffect(() => {
    reset({ name: area.name, color: area.color });
  }, [area.color, area.name, reset]);

  const save = async (values: AreaSettingsFormValues) => {
    try {
      await updateArea(area.id, values);
    } catch (error: unknown) {
      if (error instanceof api.ApiRequestError) {
        const handledFields = Object.entries(error.fieldErrors).filter(
          ([field]) => field === "name" || field === "color",
        );
        if (handledFields.length > 0) {
          for (const [field, message] of handledFields) {
            setError(field as keyof AreaSettingsFormValues, {
              type: "server",
              message,
            });
          }
          return;
        }
      }
      addNotification(
        settingsMutationFailure("edit-area", values.name, error, t),
      );
    }
  };
  const nameField = register("name");
  const colorField = register("color");
  const validationError = errors.name?.message;
  const colorError = errors.color?.message;

  return (
    <div className="flex items-start gap-3 border-b border-slate-100 p-3 last:border-b-0">
      <GripVertical size={15} className="text-slate-300" />
      <span className={`size-3 rounded-full ${colorClasses[area.color]}`} />
      <div className="min-w-0 flex-1">
        <input
          aria-label={t("organization.areas.rename", { name: area.name })}
          aria-describedby={
            validationError ? `area-name-error-${area.id}` : undefined
          }
          aria-invalid={Boolean(validationError)}
          className="min-w-0 w-full rounded-lg border border-transparent px-2 py-1.5 text-base font-semibold hover:border-slate-200 focus:border-slate-300 focus:outline-none min-[560px]:text-sm"
          {...nameField}
          onChange={(event) => {
            nameField.onChange(event);
            if (isSubmitted) void trigger("name");
          }}
          onBlur={(event) => {
            nameField.onBlur(event);
            void handleSubmit(save)();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              reset({ name: area.name, color: area.color });
              event.currentTarget.blur();
            }
          }}
        />
        {validationError ? (
          <p
            id={`area-name-error-${area.id}`}
            role="alert"
            className="px-2 pt-1 text-xs font-medium text-rose-600"
          >
            <span lang={errors.name?.type === "server" ? "en" : undefined}>
              {validationError}
            </span>
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        <select
          aria-describedby={
            colorError ? `area-color-error-${area.id}` : undefined
          }
          aria-label={t("organization.areas.color", { name: area.name })}
          aria-invalid={Boolean(colorError)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
          {...colorField}
          onChange={(event) => {
            colorField.onChange(event);
            void handleSubmit(save)();
          }}
        >
          {settingColors.map((color) => (
            <option key={color} value={color}>
              {t(`organization.colors.${color}`)}
            </option>
          ))}
        </select>
        {colorError ? (
          <p
            id={`area-color-error-${area.id}`}
            role="alert"
            className="pt-1 text-xs font-medium text-rose-600"
          >
            <span lang={errors.color?.type === "server" ? "en" : undefined}>
              {colorError}
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex">
        <button
          type="button"
          aria-label={t("organization.areas.moveUp", { name: area.name })}
          className="p-1.5 text-slate-400 hover:text-slate-900"
          onClick={() => onMove(index, -1)}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          aria-label={t("organization.areas.moveDown", { name: area.name })}
          className="p-1.5 text-slate-400 hover:text-slate-900"
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown size={14} />
        </button>
        <button
          type="button"
          aria-label={t("organization.areas.delete", { name: area.name })}
          className="p-1.5 text-slate-400 hover:text-rose-600"
          onClick={() => onDelete(area.id)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const health = useLoaderData() as HealthLoaderData;
  const { t } = useTranslation();
  const settingsFormSchema = useMemo(() => createSettingsFormSchema(t), [t]);
  const {
    areas,
    ownerTimeZone,
    displayLanguage,
    weekStartsOn,
    trashRetentionDays,
    ownerSettingsVersion,
    createArea,
    reorderAreas,
    trashArea,
    updateOwnerSettings,
    tags,
  } = useAppSettings();
  const { tasks } = useTaskStore();
  const { addNotification } = useNotifications();
  const {
    clearErrors,
    control,
    formState: { errors: ownerSettingsErrors },
    getValues,
    resetField,
    setError,
    trigger,
  } = useForm<SettingsFormValues>({
    defaultValues: {
      displayLanguage,
      timeZone: ownerTimeZone,
      weekStartsOn,
      trashRetentionDays: String(trashRetentionDays),
    },
    resolver: zodResolver(settingsFormSchema),
  });
  const [deletingAreaId, setDeletingAreaId] = useState<number | null>(null);
  const activeAreas = activeAreasInPositionOrder(areas);
  const deletingArea = areas.find((area) => area.id === deletingAreaId);

  useEffect(() => {
    resetField("displayLanguage", { defaultValue: displayLanguage });
  }, [displayLanguage, resetField]);

  useEffect(() => {
    resetField("timeZone", { defaultValue: ownerTimeZone });
  }, [ownerTimeZone, resetField]);

  useEffect(() => {
    resetField("weekStartsOn", { defaultValue: weekStartsOn });
  }, [resetField, weekStartsOn]);

  useEffect(() => {
    resetField("trashRetentionDays", {
      defaultValue: String(trashRetentionDays),
    });
  }, [resetField, trashRetentionDays]);

  const ownerSettingsInput = (
    overrides: Partial<Parameters<typeof updateOwnerSettings>[0]>,
  ) => ({
    displayLanguage,
    timeZone: ownerTimeZone,
    weekStartsOn,
    trashRetentionDays,
    version: ownerSettingsVersion,
    ...overrides,
  });

  const saveOwnerSettings = (
    operation:
      | "update-owner-time-zone"
      | "update-week-start"
      | "update-trash-retention",
    input: Parameters<typeof updateOwnerSettings>[0],
  ) =>
    updateOwnerSettings(input).catch((error: unknown) => {
      switch (operation) {
        case "update-owner-time-zone":
          resetField("timeZone", {
            defaultValue: ownerTimeZone,
            keepError: true,
          });
          break;
        case "update-week-start":
          resetField("weekStartsOn", {
            defaultValue: weekStartsOn,
            keepError: true,
          });
          break;
        case "update-trash-retention":
          resetField("trashRetentionDays", {
            defaultValue: String(trashRetentionDays),
            keepError: true,
          });
          break;
      }
      if (
        error instanceof api.ApiRequestError &&
        Object.keys(error.fieldErrors).length > 0
      ) {
        for (const field of [
          "timeZone",
          "weekStartsOn",
          "trashRetentionDays",
        ] as const) {
          const message = error.fieldErrors[field];
          if (message) setError(field, { type: "server", message });
        }
        throw error;
      }
      addNotification(
        settingsMutationFailure(operation, "Owner settings", error, t),
      );
      throw error;
    });

  const saveDisplayLanguage = (attemptedLanguage: DisplayLanguage) => {
    void updateOwnerSettings(
      ownerSettingsInput({ displayLanguage: attemptedLanguage }),
    ).catch((error: unknown) => {
      const isConflict = error instanceof OwnerSettingsConflictError;
      const notificationLanguage = isConflict
        ? error.latestDisplayLanguage
        : attemptedLanguage;
      resetField("displayLanguage", {
        defaultValue: isConflict ? notificationLanguage : displayLanguage,
      });
      addNotification({
        ...settingsMutationFailure(
          "update-display-language",
          "Display language",
          error,
          i18n.getFixedT(notificationLanguage),
        ),
        language: notificationLanguage,
      });
    });
  };

  const saveTrashRetention = async () => {
    if (!(await trigger("trashRetentionDays"))) return;

    void saveOwnerSettings(
      "update-trash-retention",
      ownerSettingsInput({
        trashRetentionDays: Number(getValues("trashRetentionDays")),
      }),
    )
      .then(() => clearErrors("trashRetentionDays"))
      .catch(() => undefined);
  };

  const moveArea = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= activeAreas.length) return;
    const next = [...activeAreas];
    [next[index], next[target]] = [next[target], next[index]];
    void reorderAreas(next.map((area) => area.id)).catch((error: unknown) => {
      addNotification(
        settingsMutationFailure("reorder-areas", "Areas", error, t),
      );
    });
  };

  const deleteArea = (areaId: number) => {
    const area = areas.find((candidate) => candidate.id === areaId);
    if (!area) return;
    const taskCount = tasks.filter((task) => task.areaId === areaId).length;
    if (taskCount > 0) {
      setDeletingAreaId(areaId);
      return;
    }
    void trashArea(areaId).catch((error: unknown) => {
      addNotification(
        settingsMutationFailure("delete-area", area.name, error, t),
      );
    });
  };

  return (
    <div className="page-frame max-w-5xl">
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title="Settings"
        titleLanguage="en"
        description={t("settings.description")}
      />

      <div className="space-y-8 min-[560px]:space-y-5">
        <form
          className="rounded-3xl border border-slate-200 bg-white p-5 min-[560px]:p-4"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Languages size={18} />
            <div className="flex-1">
              <h2 className="text-sm font-bold">
                {t("settings.owner.displayLanguage.label")}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {t("settings.owner.displayLanguage.description")}
              </p>
            </div>
            <Controller
              control={control}
              name="displayLanguage"
              render={({ field }) => (
                <select
                  aria-label={t("settings.owner.displayLanguage.ariaLabel")}
                  className="min-w-0 w-full rounded-xl border border-slate-200 px-3 py-2 text-base min-[560px]:w-auto min-[560px]:text-sm"
                  value={field.value}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onChange={(event) => {
                    const parsedLanguage = displayLanguageSchema.safeParse(
                      event.target.value,
                    );
                    if (parsedLanguage.success) {
                      field.onChange(parsedLanguage.data);
                      saveDisplayLanguage(parsedLanguage.data);
                    }
                  }}
                >
                  {supportedDisplayLanguages.map((language) => (
                    <option key={language} value={language} lang={language}>
                      {displayLanguageLabels[language]}
                    </option>
                  ))}
                </select>
              )}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Settings2 size={18} />
            <div className="flex-1">
              <h2 className="text-sm font-bold">
                {t("settings.owner.timeZone.label")}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {t("settings.owner.timeZone.description")}
              </p>
            </div>
            <Controller
              control={control}
              name="timeZone"
              render={({ field }) => (
                <select
                  aria-label={t("settings.owner.timeZone.ariaLabel")}
                  className="min-w-0 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm min-[560px]:w-auto"
                  value={field.value}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onChange={(event) => {
                    field.onChange(event.target.value);
                    void trigger("timeZone").then((valid) => {
                      if (!valid) return;
                      void saveOwnerSettings(
                        "update-owner-time-zone",
                        ownerSettingsInput({
                          timeZone: getValues("timeZone"),
                        }),
                      ).catch(() => undefined);
                    });
                  }}
                >
                  {ownerTimeZoneOptions.map((timeZone) => (
                    <option key={timeZone} value={timeZone}>
                      {timeZone}
                    </option>
                  ))}
                </select>
              )}
            />
            {ownerSettingsErrors.timeZone?.message ? (
              <p
                className="basis-full text-xs text-rose-600"
                role="alert"
                lang={
                  ownerSettingsErrors.timeZone.type === "server"
                    ? "en"
                    : undefined
                }
              >
                {ownerSettingsErrors.timeZone.message}
              </p>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <div className="flex-1">
              <h2 className="text-sm font-bold">
                {t("settings.owner.weekStartsOn.label")}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {t("settings.owner.weekStartsOn.description")}
              </p>
            </div>
            <Controller
              control={control}
              name="weekStartsOn"
              render={({ field }) => (
                <select
                  aria-label={t("settings.owner.weekStartsOn.ariaLabel")}
                  value={field.value}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onChange={(event) => {
                    field.onChange(
                      event.target.value ? Number(event.target.value) : 7,
                    );
                    void trigger("weekStartsOn").then((valid) => {
                      if (!valid) return;
                      void saveOwnerSettings(
                        "update-week-start",
                        ownerSettingsInput({
                          weekStartsOn: getValues(
                            "weekStartsOn",
                          ) as WeekStartsOn,
                        }),
                      ).catch(() => undefined);
                    });
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  {weekDayOptions.map((day) => (
                    <option key={day.value} value={day.value}>
                      {t(
                        `settings.weekday.${weekDayTranslationKeys[day.value]}`,
                      )}
                    </option>
                  ))}
                </select>
              )}
            />
            {ownerSettingsErrors.weekStartsOn?.message ? (
              <p
                className="basis-full text-xs text-rose-600"
                role="alert"
                lang={
                  ownerSettingsErrors.weekStartsOn.type === "server"
                    ? "en"
                    : undefined
                }
              >
                {ownerSettingsErrors.weekStartsOn.message}
              </p>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <div className="min-w-44 flex-1">
              <h2 className="text-sm font-bold">
                {t("settings.owner.trashRetention.label")}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {t("settings.owner.trashRetention.description")}
              </p>
            </div>
            <Controller
              control={control}
              name="trashRetentionDays"
              render={({ field }) => (
                <input
                  {...field}
                  aria-label={t("settings.owner.trashRetention.ariaLabel")}
                  className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  inputMode="numeric"
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    field.onChange(nextValue);
                    if (ownerSettingsErrors.trashRetentionDays) {
                      void trigger("trashRetentionDays");
                    }
                  }}
                />
              )}
            />
            <span className="text-sm text-slate-500">
              {t("settings.owner.trashRetention.unit")}
            </span>
            <button
              type="button"
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"
              onClick={saveTrashRetention}
            >
              {t("settings.owner.trashRetention.save")}
            </button>
            {ownerSettingsErrors.trashRetentionDays?.message ? (
              <p
                className="basis-full text-xs text-rose-600"
                role="alert"
                lang={
                  ownerSettingsErrors.trashRetentionDays.type === "server"
                    ? "en"
                    : undefined
                }
              >
                {ownerSettingsErrors.trashRetentionDays.message}
              </p>
            ) : null}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-xs">
            <span className="text-slate-400" lang="en">
              {t("settings.health.label")}
            </span>
            <span
              role="status"
              aria-label={t("settings.health.status.ariaLabel", {
                status: t(`settings.health.status.${health.status}`),
              })}
              className={
                health.status === "ready"
                  ? "font-semibold text-emerald-600"
                  : "font-semibold text-amber-600"
              }
            >
              {t(`settings.health.status.${health.status}`)}
            </span>
          </div>
        </form>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers3 size={17} />
              <h2 className="text-sm font-bold">
                {t("organization.areas.sectionHeading")}
              </h2>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"
              onClick={() => {
                const name = nextAreaName(areas);
                void createArea({ name, color: "gray" }).catch(
                  (error: unknown) => {
                    addNotification(
                      settingsMutationFailure("create-area", name, error, t),
                    );
                  },
                );
              }}
            >
              <Plus size={14} />
              {t("organization.areas.add")}
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {activeAreas.map((area, index) => (
              <AreaSettingsRow
                key={area.id}
                area={area}
                index={index}
                onMove={moveArea}
                onDelete={deleteArea}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Tag size={17} />
            <h2 className="text-sm font-bold">
              {t("organization.tags.sectionHeading")}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4">
            {tags.map((tag) => (
              <TagSettingsRow key={tag.id} tag={tag} />
            ))}
          </div>
        </section>
      </div>
      <AreaDeleteDialog
        area={deletingArea}
        taskCount={
          deletingArea
            ? tasks.filter((task) => task.areaId === deletingArea.id).length
            : 0
        }
        open={deletingArea !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeletingAreaId(null);
        }}
      />
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <InboxIcon className="mx-auto text-slate-300" size={32} />
        <h1 className="mt-4 text-2xl font-black">
          {t("common.notFound.title")}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {t("common.notFound.description")}
        </p>
        <Link
          to="/today"
          className="mt-5 inline-block rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"
        >
          {t("common.notFound.backToToday")}
        </Link>
      </div>
    </div>
  );
}
