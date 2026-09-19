import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { act } from "react";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../domain/task";
import {
  defaultViewColumns,
  defaultViewSort,
  type MoveTaskRequest,
  type TaskMovePosition,
} from "../shared/api-schema";
import * as api from "./api-client";
import { BootstrapProvider } from "./bootstrap-state";
import { NewTaskDialog } from "./components/new-task-dialog";
import { applyDisplayLanguage } from "./i18n";
import {
  AreaDetailPage,
  AreasPage,
  InboxPage,
  SettingsPage,
  TodayPage,
  TrashPage,
  ViewManagementPage,
  ViewPage,
  WeekPage,
} from "./pages";
import {
  ownerTimeZoneSchema,
  AppSettingsProvider as ProductionAppSettingsProvider,
  weekStartsOnSchema,
} from "./settings-store";
import { TaskStoreProvider, useTaskStore } from "./task-store";
import {
  AppSettingsProvider,
  taskMutationTestAction,
  testAreaIds,
  testSnapshot,
} from "./test/providers";

afterEach(() => {
  window.sessionStorage.clear();
});

function scheduledTask(overrides: Partial<Task>): Task {
  const baseTask = testSnapshot.tasks[0] as Task;
  return {
    ...baseTask,
    id: "scheduled-task",
    title: "Scheduled Task",
    path: ["Develop", "Scheduled Task"],
    parentId: undefined,
    status: "OPEN",
    start: "2026-08-12",
    due: null,
    completedAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function moveRequest(
  source: Task,
  target: Task,
  position: TaskMovePosition,
): MoveTaskRequest {
  return {
    taskId: source.id,
    taskVersion: source.version ?? 1,
    targetTaskId: target.id,
    targetTaskVersion: target.version ?? 1,
    position,
  };
}

function dispatchDragEvent(
  element: HTMLElement,
  type: "dragover" | "drop",
  dataTransfer: DataTransfer,
  clientY: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { configurable: true, value: clientY },
    dataTransfer: { configurable: true, value: dataTransfer },
  });
  element.dispatchEvent(event);
}

function mockTodaySortableRects() {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;

  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (
        this.tagName !== "DIV" ||
        this.firstElementChild?.tagName !== "ARTICLE"
      ) {
        return originalGetBoundingClientRect.call(this);
      }

      const siblings = Array.from(this.parentElement?.children ?? []).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.tagName === "DIV" &&
          child.firstElementChild?.tagName === "ARTICLE",
      );
      const index = siblings.indexOf(this);
      if (index < 0) {
        return originalGetBoundingClientRect.call(this);
      }

      return new DOMRect(0, index * 100, 400, 80);
    });
}

async function navigate(
  router: ReturnType<typeof createMemoryRouter>,
  path: string,
) {
  await act(async () => {
    await router.navigate(path);
  });
}

function ReorderTodayFixture() {
  const { reorderToday } = useTaskStore();

  return (
    <button type="button" onClick={() => reorderToday(["task-2", "task-1"])}>
      Reorder Today fixture
    </button>
  );
}

function TodayOrderByDateFixture() {
  const { completeTask, reorderToday, todayOrder } = useTaskStore();

  return (
    <>
      <button type="button" onClick={() => reorderToday(["task-2", "task-1"])}>
        Reorder Today by date fixture
      </button>
      <button type="button" onClick={() => completeTask("task-2")}>
        Refresh Today fixture
      </button>
      <output>{todayOrder.join(",")}</output>
    </>
  );
}

function TaskPathProbe({ taskId }: { taskId: string }) {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.id === taskId);
  return (
    <output data-testid={`task-path-${taskId}`}>{task?.path.join("/")}</output>
  );
}

function ReopenTaskOrderFixture() {
  const { completeTask, reopenTask, tasks } = useTaskStore();

  return (
    <>
      <button type="button" onClick={() => completeTask("task-2")}>
        Complete Task order fixture
      </button>
      <button type="button" onClick={() => reopenTask("task-2")}>
        Reopen Task order fixture
      </button>
      <output>{tasks.map((task) => task.id).join(",")}</output>
    </>
  );
}

function TaskStartValueFixture() {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.id === "task-1");

  return <output aria-label="Navigation TaskのStart値">{task?.start}</output>;
}

describe("TodayPage", () => {
  it("keeps Today Order isolated to the Owner date", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-27T00:00:00.000Z").getTime());
    const user = userEvent.setup();

    try {
      render(
        <AppSettingsProvider>
          <TaskStoreProvider>
            <TodayOrderByDateFixture />
          </TaskStoreProvider>
        </AppSettingsProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Reorder Today by date fixture" }),
      );
      expect(screen.getByRole("status")).toHaveTextContent("task-2,task-1");

      now.mockReturnValue(new Date("2026-07-28T00:00:00.000Z").getTime());
      await user.click(
        screen.getByRole("button", { name: "Refresh Today fixture" }),
      );
      expect(screen.getByRole("status")).toHaveTextContent("");
    } finally {
      now.mockRestore();
    }
  });

  it("keeps the stored Area order when a Task is reopened", async () => {
    const user = userEvent.setup();

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <ReopenTaskOrderFixture />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const before = screen.getByRole("status").textContent ?? "";
    await user.click(
      screen.getByRole("button", { name: "Complete Task order fixture" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Reopen Task order fixture" }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(before);
  });

  it("shows Today and actionable tasks", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          children: [
            { index: true, element: <div /> },
            { path: "today", element: <TodayPage /> },
          ],
        },
        { path: "/task-mutations", action: taskMutationTestAction },
      ],
      { initialEntries: ["/today"] },
    );
    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Navigation shellを比較する" }),
    ).toBeInTheDocument();
  });

  it("shows scheduled parent and child Tasks with Today Order and Open count", () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const parent = scheduledTask({
      id: "scheduled-parent",
      title: "Scheduled parent",
      path: ["Develop", "Scheduled parent"],
      start: null,
      due: "2026-08-11",
    });
    const child = scheduledTask({
      id: "scheduled-child",
      title: "Scheduled child",
      path: ["Develop", "Scheduled parent", "Scheduled child"],
      parentId: parent.id,
    });
    const fallback = scheduledTask({
      id: "scheduled-fallback",
      title: "A scheduled fallback",
      path: ["Develop", "A scheduled fallback"],
    });
    const timezoneIncluded = scheduledTask({
      id: "timezone-included",
      title: "Timezone included",
      path: ["Develop", "Timezone included"],
      start: "2026-08-11T15:00:00.000Z",
    });
    const timezoneExcluded = scheduledTask({
      id: "timezone-excluded",
      title: "Timezone excluded",
      path: ["Develop", "Timezone excluded"],
      start: "2026-08-12T15:00:00.000Z",
      due: "2026-08-11",
    });
    const future = scheduledTask({
      id: "future-task",
      title: "Future task",
      path: ["Develop", "Future task"],
      start: "2026-08-20",
    });
    const unscheduled = scheduledTask({
      id: "unscheduled-task",
      title: "Unscheduled task",
      path: ["Develop", "Unscheduled task"],
      start: null,
    });
    const dueOnly = scheduledTask({
      id: "due-only-task",
      title: "Due only task",
      path: ["Develop", "Due only task"],
      start: null,
      due: "2026-08-12",
    });
    const completed = scheduledTask({
      id: "completed-task",
      title: "Completed task",
      path: ["Develop", "Completed task"],
      status: "COMPLETED",
      completedAt: "2026-08-11T01:00:00.000Z",
    });
    const inbox = scheduledTask({
      id: "inbox-task",
      title: "Inbox task",
      path: ["Inbox", "Inbox task"],
      areaId: testAreaIds.inbox,
    });
    const completedInbox = scheduledTask({
      id: "completed-inbox-task",
      title: "Completed Inbox task",
      path: ["Inbox", "Completed Inbox task"],
      areaId: testAreaIds.inbox,
      status: "COMPLETED",
      start: null,
      due: null,
      completedAt: "2026-08-12T01:00:00.000Z",
    });
    const trashed = scheduledTask({
      id: "trashed-task",
      title: "Trashed task",
      path: ["Develop", "Trashed task"],
      trashedAt: "2026-08-11T00:00:00.000Z",
    });
    const snapshot = {
      ...testSnapshot,
      ownerSettings: { ...testSnapshot.ownerSettings, weekStartsOn: 0 },
      tasks: [
        parent,
        child,
        fallback,
        timezoneIncluded,
        timezoneExcluded,
        future,
        unscheduled,
        dueOnly,
        completed,
        inbox,
        completedInbox,
        trashed,
      ],
      todayOrders: { "2026-08-12": [child.id] },
    };

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      expect(screen.getByText("6 Open Tasks")).toBeInTheDocument();
      const parentTitle = screen.getByRole("button", {
        name: "Edit Scheduled parent",
      });
      const childTitle = screen.getByRole("button", {
        name: "Edit Scheduled child",
      });
      const fallbackTitle = screen.getByRole("button", {
        name: "Edit A scheduled fallback",
      });
      expect(parentTitle).toBeInTheDocument();
      expect(childTitle).toBeInTheDocument();
      expect(
        childTitle.compareDocumentPosition(parentTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        fallbackTitle.compareDocumentPosition(parentTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Edit Timezone included" }),
      ).toBeInTheDocument();
      const parentRow = parentTitle.closest("article");
      const childRow = childTitle.closest("article");
      if (!parentRow || !childRow) throw new Error("Task rows are missing");
      expect(within(parentRow).getByTitle("Develop")).toBeInTheDocument();
      expect(
        within(childRow).getByTitle("Develop / Scheduled parent"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Future task" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Timezone excluded" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Unscheduled task" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit Due only task" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Completed task" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit Inbox task" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit Completed Inbox task" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit Trashed task" }),
      ).not.toBeInTheDocument();
    } finally {
      now.mockRestore();
    }
  });

  it("does not reorder Today Tasks through keyboard shortcuts", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const dueOnly = scheduledTask({
      id: "drag-due-only",
      title: "Drag Due-only",
      path: ["Develop", "Drag Due-only"],
      start: null,
      due: "2026-08-12",
    });
    const inbox = scheduledTask({
      id: "drag-inbox",
      title: "Drag Inbox",
      path: ["Inbox", "Drag Inbox"],
      areaId: testAreaIds.inbox,
      start: "2026-08-12",
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [dueOnly, inbox],
      todayOrders: {},
    };

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      expect(
        screen.getByRole("button", { name: "Reorder Drag Due-only" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reorder Drag Inbox" }),
      ).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent("space bar");
      expect(document.body).not.toHaveTextContent("arrow keys");
      const dueOnlyHandle = screen.getByRole("button", {
        name: "Reorder Drag Due-only",
      });
      dueOnlyHandle.focus();
      fireEvent.keyDown(dueOnlyHandle, { code: "Space", key: " " });
      fireEvent.keyDown(dueOnlyHandle, {
        code: "ArrowDown",
        key: "ArrowDown",
      });
      fireEvent.keyDown(dueOnlyHandle, { code: "Space", key: " " });

      const taskTitles = screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);
      expect(taskTitles.slice(0, 2)).toEqual(["Drag Due-only", "Drag Inbox"]);
    } finally {
      now.mockRestore();
    }
  });

  it("reports a Today Order rejection, rolls back, and allows retry by dragging again", async () => {
    const rectSpy = mockTodaySortableRects();
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const first = scheduledTask({
      id: "today-order-first",
      title: "Today order first",
      path: ["Develop", "Today order first"],
      version: 1,
    });
    const second = scheduledTask({
      id: "today-order-second",
      title: "Today order second",
      path: ["Develop", "Today order second"],
      version: 1,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [first, second],
      todayOrders: { "2026-08-12": [first.id, second.id] },
    };
    const reorderedSnapshot = {
      ...snapshot,
      todayOrders: { "2026-08-12": [second.id, first.id] },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    let rejectReorder: (error: unknown) => void = () => {
      throw new Error("Today Order rejection was not initialized");
    };
    const failedReorder = new Promise<never>((_resolve, reject) => {
      rejectReorder = reject;
    });
    const reorderToday = vi
      .spyOn(api, "reorderToday")
      .mockReturnValueOnce(failedReorder)
      .mockResolvedValueOnce(reorderedSnapshot);
    const dragFirstTaskDown = async () => {
      const handle = await screen.findByRole("button", {
        name: "Reorder Today order first",
      });
      fireEvent.pointerDown(handle, {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        buttons: 1,
        clientX: 10,
        clientY: 20,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.pointerMove(document, {
        isPrimary: true,
        pointerId: 1,
        buttons: 1,
        clientX: 10,
        clientY: 220,
      });
      fireEvent.pointerMove(handle, {
        isPrimary: true,
        pointerId: 1,
        buttons: 1,
        clientX: 10,
        clientY: 220,
      });
      fireEvent.pointerUp(handle, {
        isPrimary: true,
        pointerId: 1,
        buttons: 0,
        clientX: 10,
        clientY: 220,
      });
    };
    const visibleTitles = () =>
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent)
        .slice(0, 2);

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await dragFirstTaskDown();
      expect(visibleTitles()).toEqual([
        "Today order second",
        "Today order first",
      ]);
      await act(async () => {
        rejectReorder(
          new api.ApiRequestError(
            422,
            "raw order response",
            "TODAY_ORDER_INVALID",
          ),
        );
      });

      const message =
        "Could not save Today Order. Review the current Tasks and try dragging a Task again.";
      expect(
        await screen.findByRole("region", {
          name: `Warning notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(visibleTitles()).toEqual([
        "Today order first",
        "Today order second",
      ]);
      expect(reorderToday).toHaveBeenCalledTimes(1);

      await userEvent.setup().click(
        screen.getByRole("button", {
          name: `Close notification: ${message}`,
        }),
      );
      await dragFirstTaskDown();

      expect(reorderToday).toHaveBeenCalledTimes(2);
      expect(visibleTitles()).toEqual([
        "Today order second",
        "Today order first",
      ]);
      expect(
        screen.queryByRole("complementary", { name: "Notifications" }),
      ).not.toBeInTheDocument();
    } finally {
      reorderToday.mockRestore();
      loadBootstrap.mockRestore();
      rectSpy.mockRestore();
      now.mockRestore();
    }
  });

  it("confirms every open descendant before completing a parent", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const parent = scheduledTask({
      id: "cascade-parent",
      title: "Cascade parent",
      path: ["Develop", "Cascade parent"],
      version: 1,
    });
    const child = scheduledTask({
      id: "cascade-child",
      title: "Cascade child",
      path: ["Develop", "Cascade parent", "Cascade child"],
      parentId: parent.id,
      version: 1,
    });
    const offscreenChild = scheduledTask({
      id: "cascade-offscreen-child",
      title: "Cascade offscreen child",
      path: [
        "Develop",
        "Cascade parent",
        "Cascade child",
        "Cascade offscreen child",
      ],
      parentId: child.id,
      start: null,
      version: 1,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [parent, child, offscreenChild],
      todayOrders: { "2026-08-12": [parent.id, child.id] },
    };
    const completedAt = "2026-08-12T12:00:00.000Z";
    const completedSnapshot = {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        status: "COMPLETED" as const,
        completedAt,
        updatedAt: completedAt,
        version: 2,
      })),
    };
    const reopenedSnapshot = {
      ...completedSnapshot,
      tasks: completedSnapshot.tasks.map((task) =>
        task.id === parent.id
          ? {
              ...task,
              status: "OPEN" as const,
              completedAt: null,
              updatedAt: "2026-08-12T12:01:00.000Z",
              version: 3,
            }
          : task,
      ),
    };
    const updateStatus = vi
      .spyOn(api, "updateTaskStatus")
      .mockResolvedValue(completedSnapshot);

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const parentCheckbox = screen.getByRole("button", {
        name: "Complete Cascade parent",
      });
      await user.click(parentCheckbox);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Cascade parent");
      expect(dialog).toHaveTextContent("Cascade child");
      expect(dialog).toHaveTextContent("Cascade offscreen child");
      expect(
        within(dialog).getByRole("button", { name: "Complete 3 Tasks" }),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(updateStatus).not.toHaveBeenCalled();

      await user.click(parentCheckbox);
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "Complete 3 Tasks",
        }),
      );

      expect(updateStatus).toHaveBeenCalledWith(parent.id, {
        status: "COMPLETED",
        version: parent.version,
        ancestorVersions: {},
        cascadeDescendants: true,
        descendantVersions: {
          [child.id]: child.version,
          [offscreenChild.id]: offscreenChild.version,
        },
      });
      expect(
        await screen.findByRole("button", {
          name: "Reopen Cascade parent",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reopen Cascade child" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "Reopen Cascade offscreen child",
        }),
      ).toBeInTheDocument();

      updateStatus.mockResolvedValue(reopenedSnapshot);
      await user.click(
        screen.getByRole("button", { name: "Reopen Cascade parent" }),
      );
      expect(updateStatus).toHaveBeenLastCalledWith(parent.id, {
        status: "OPEN",
        version: 2,
        cascadeDescendants: false,
        descendantVersions: {},
        ancestorVersions: {},
      });
      expect(
        await screen.findByRole("button", {
          name: "Complete Cascade parent",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reopen Cascade child" }),
      ).toBeInTheDocument();
    } finally {
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("shows finite progress separately and blocks recurring cascades", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const parent = scheduledTask({
      id: "progress-parent",
      title: "Progress parent",
      path: ["Develop", "Progress parent"],
      version: 1,
    });
    const finiteOpen = scheduledTask({
      id: "finite-open",
      title: "Finite open",
      path: ["Develop", "Progress parent", "Finite open"],
      parentId: parent.id,
      version: 1,
    });
    const finiteCompleted = scheduledTask({
      id: "finite-completed",
      title: "Finite completed",
      path: ["Develop", "Progress parent", "Finite completed"],
      parentId: parent.id,
      status: "COMPLETED",
      completedAt: "2026-08-11T12:00:00.000Z",
      version: 2,
    });
    const finiteDeepCompleted = scheduledTask({
      id: "finite-deep-completed",
      title: "Finite deep completed",
      path: [
        "Develop",
        "Progress parent",
        "Finite open",
        "Finite deep completed",
      ],
      parentId: finiteOpen.id,
      status: "COMPLETED",
      completedAt: "2026-08-11T12:00:00.000Z",
      version: 2,
    });
    const openRecurring = scheduledTask({
      id: "open-recurring",
      title: "Open recurring blocker",
      path: [
        "Develop",
        "Progress parent",
        "Finite open",
        "Open recurring blocker",
      ],
      parentId: finiteOpen.id,
      recurrenceRule: "daily",
      version: 1,
    });
    const completedRecurring = scheduledTask({
      id: "completed-recurring",
      title: "Completed recurring",
      path: ["Develop", "Progress parent", "Completed recurring"],
      parentId: parent.id,
      recurrenceRule: "daily",
      status: "COMPLETED",
      completedAt: "2026-08-11T12:00:00.000Z",
      version: 2,
    });
    const trashedRecurring = scheduledTask({
      id: "trashed-recurring",
      title: "Trashed recurring",
      path: ["Develop", "Progress parent", "Trashed recurring"],
      parentId: parent.id,
      recurrenceRule: "daily",
      trashedAt: "2026-08-11T12:00:00.000Z",
      version: 2,
    });
    const trashedFinite = scheduledTask({
      id: "trashed-finite",
      title: "Trashed finite",
      path: ["Develop", "Progress parent", "Trashed finite"],
      parentId: parent.id,
      trashedAt: "2026-08-11T12:00:00.000Z",
      version: 2,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [
        parent,
        finiteOpen,
        finiteCompleted,
        finiteDeepCompleted,
        openRecurring,
        completedRecurring,
        trashedRecurring,
        trashedFinite,
      ],
      todayOrders: {
        "2026-08-12": [parent.id, finiteOpen.id, openRecurring.id],
      },
    };
    const updateStatus = vi.spyOn(api, "updateTaskStatus");

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const parentRow = screen
        .getByRole("button", { name: "Edit Progress parent" })
        .closest("article");
      if (!parentRow) throw new Error("Progress parent row was not rendered");
      expect(within(parentRow).getByText("1/2")).toBeInTheDocument();
      expect(within(parentRow).queryByText("↻1")).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Complete Progress parent" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(
        "“Progress parent” includes an Open Recurring Task. Move the recurring blocker to Trash before completing the parent.",
      );
      expect(dialog).toHaveTextContent(
        "Develop/Progress parent/Finite open/Open recurring blocker",
      );
      expect(
        within(dialog).queryByRole("button", { name: /Complete .* Tasks/ }),
      ).not.toBeInTheDocument();
      expect(updateStatus).not.toHaveBeenCalled();
    } finally {
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("keeps an unavailable cascade version blocker inside the completion dialog", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const parent = scheduledTask({
      id: "versionless-parent",
      title: "Versionless parent",
      path: ["Develop", "Versionless parent"],
      version: 1,
    });
    const child = scheduledTask({
      id: "versionless-child",
      title: "Versionless child",
      path: ["Develop", "Versionless parent", "Versionless child"],
      parentId: parent.id,
      version: undefined,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [parent, child],
      todayOrders: { "2026-08-12": [parent.id, child.id] },
    };
    const updateStatus = vi.spyOn(api, "updateTaskStatus");

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Complete Versionless parent" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(
        "The Task information needed for cascade completion is unavailable. Reload the page before trying again.",
      );
      expect(
        within(dialog).queryByRole("button", { name: /Complete .* Tasks/ }),
      ).not.toBeInTheDocument();
      expect(updateStatus).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("complementary", { name: "Notifications" }),
      ).not.toBeInTheDocument();
    } finally {
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("reports a Task completion server failure outside the Task row", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "status-error",
      title: "Status error",
      path: ["Develop", "Status error"],
      version: 1,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [task],
      todayOrders: { "2026-08-12": [task.id] },
    };
    const updateStatus = vi
      .spyOn(api, "updateTaskStatus")
      .mockRejectedValue(new api.ApiRequestError(500, "raw server response"));

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Complete Status error" }),
      );

      const message =
        "Could not complete “Status error”. Try again from this Task.";
      expect(
        await screen.findByRole("region", {
          name: `Error notification: ${message}`,
        }),
      ).toBeInTheDocument();
      const taskRow = screen
        .getByRole("button", { name: "Edit Status error" })
        .closest("article");
      if (!taskRow) throw new Error("Status error row was not rendered");
      expect(within(taskRow).queryByText(message)).not.toBeInTheDocument();
      expect(screen.queryByText("raw server response")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Complete Status error" }),
      ).toBeEnabled();
    } finally {
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("identifies a failed Task reopen operation in its Error notification", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "reopen-error",
      title: "Reopen error",
      path: ["Develop", "Reopen error"],
      status: "COMPLETED",
      completedAt: "2026-08-12T11:00:00.000Z",
      version: 2,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [task],
      todayOrders: { "2026-08-12": [] },
    };
    const updateStatus = vi
      .spyOn(api, "updateTaskStatus")
      .mockRejectedValue(new api.ApiRequestError(503, "raw server response"));

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Reopen Reopen error" }),
      );

      const message =
        "Could not reopen “Reopen error”. Try again from this Task.";
      expect(
        await screen.findByRole("region", {
          name: `Error notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Reopen Reopen error" }),
      ).toBeEnabled();
    } finally {
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("reports a server-side Task completion rule rejection as a Warning", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "status-warning",
      title: "Status warning",
      path: ["Develop", "Status warning"],
      version: 1,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [task],
      todayOrders: { "2026-08-12": [task.id] },
    };
    const updateStatus = vi
      .spyOn(api, "updateTaskStatus")
      .mockRejectedValue(
        new api.ApiRequestError(
          422,
          "raw domain response",
          "TASK_HAS_OPEN_DESCENDANTS",
        ),
      );

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Complete Status warning" }),
      );

      const message =
        "Could not complete “Status warning” because it has Open Subtasks. Review them and try again.";
      expect(
        await screen.findByRole("region", {
          name: `Warning notification: ${message}`,
        }),
      ).toBeInTheDocument();
      const taskRow = screen
        .getByRole("button", { name: "Edit Status warning" })
        .closest("article");
      if (!taskRow) throw new Error("Status warning row was not rendered");
      expect(within(taskRow).queryByText(message)).not.toBeInTheDocument();
      expect(screen.queryByText("raw domain response")).not.toBeInTheDocument();
    } finally {
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("keeps every target open after a cascade version conflict", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const parent = scheduledTask({
      id: "conflict-parent",
      title: "Conflict parent",
      path: ["Develop", "Conflict parent"],
      version: 4,
    });
    const child = scheduledTask({
      id: "conflict-child",
      title: "Conflict child",
      path: ["Develop", "Conflict parent", "Conflict child"],
      parentId: parent.id,
      version: 7,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [parent, child],
      todayOrders: { "2026-08-12": [parent.id, child.id] },
    };
    const updateStatus = vi
      .spyOn(api, "updateTaskStatus")
      .mockRejectedValue(
        new api.ApiRequestError(
          409,
          "Task version does not match",
          "TASK_VERSION_CONFLICT",
        ),
      );
    const reload = vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Complete Conflict parent" }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.click(
        within(dialog).getByRole("button", { name: "Complete 2 Tasks" }),
      );

      expect(updateStatus).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
      const message =
        "“Conflict parent” changed elsewhere. Review the latest values before trying to complete it again.";
      expect(
        await screen.findByRole("region", {
          name: `Warning notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(updateStatus).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Complete Conflict parent" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Complete Conflict child" }),
      ).toBeInTheDocument();
    } finally {
      reload.mockRestore();
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("reports an Error when the latest Task cannot be loaded after a version conflict", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "conflict-reload-error",
      title: "Conflict reload error",
      path: ["Develop", "Conflict reload error"],
      version: 4,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [task],
      todayOrders: { "2026-08-12": [task.id] },
    };
    const updateStatus = vi
      .spyOn(api, "updateTaskStatus")
      .mockRejectedValue(
        new api.ApiRequestError(
          409,
          "raw conflict response",
          "TASK_VERSION_CONFLICT",
        ),
      );
    const reload = vi
      .spyOn(api, "loadBootstrap")
      .mockRejectedValue(new Error("raw reload response"));

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        screen.getByRole("button", {
          name: "Complete Conflict reload error",
        }),
      );

      const message =
        "Could not refresh “Conflict reload error” after a version conflict. Reload the page, then try to complete it again.";
      expect(
        await screen.findByRole("region", {
          name: `Error notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(updateStatus).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText("raw conflict response"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("raw reload response")).not.toBeInTheDocument();
    } finally {
      reload.mockRestore();
      updateStatus.mockRestore();
      now.mockRestore();
    }
  });

  it("opens Edit Task dialog from a Task title and saves changes", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/today",
          element: <TodayPage />,
        },
        { path: "/task-mutations", action: taskMutationTestAction },
      ],
      { initialEntries: ["/today"] },
    );
    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "Tags" }));
    expect(screen.getByRole("button", { name: "backend" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "backend" }));
    expect(screen.getByRole("combobox", { name: "Tags" })).toHaveValue(
      "prototype, frontend, backend",
    );

    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Navigationを再確認する");
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "**確認済み**",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Work Notes" }),
      "- 記録した",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByRole("button", {
        name: "Edit Navigationを再確認する",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle("Develop / Taskseq MVP / UI prototype"),
    ).toBeInTheDocument();
    expect(screen.getByText("確認済み").tagName).toBe("STRONG");
    expect(screen.getByText("記録した").closest("section")).toHaveAttribute(
      "aria-label",
      "Work Notes",
    );
  });

  it("converts a date-only Start to a timestamp when time is enabled", async () => {
    const user = userEvent.setup();

    const router = createMemoryRouter(
      [
        {
          path: "/",
          children: [
            { index: true, element: <div /> },
            {
              path: "today",
              element: (
                <>
                  <TodayPage />
                  <TaskStartValueFixture />
                </>
              ),
            },
          ],
        },
        { path: "/task-mutations", action: taskMutationTestAction },
      ],
      { initialEntries: ["/today"] },
    );
    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    const startCalendar = screen.getByRole("dialog", {
      name: "Start calendar",
    });
    await user.click(
      within(startCalendar).getByRole("checkbox", {
        name: "Set time for Start",
      }),
    );
    await user.selectOptions(
      within(startCalendar).getByRole("combobox", { name: "Start hour" }),
      "10",
    );
    await user.selectOptions(
      within(startCalendar).getByRole("combobox", { name: "Start minute" }),
      "30",
    );
    await user.click(
      within(startCalendar).getByRole("button", { name: "Done" }),
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await screen.findByRole("button", {
      name: "Edit Navigation shellを比較する",
    });
    expect(
      screen.getByLabelText("Navigation TaskのStart値").textContent,
    ).toMatch(/T.*(?:Z|[+-]\d{2}:\d{2})$/);
  });

  it("moves a Task to Trash and restores it", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        { path: "/today", element: <TodayPage /> },
        { path: "/trash", element: <TrashPage /> },
      ],
      { initialEntries: ["/today"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const taskRow = screen
      .getByRole("button", { name: "Edit Navigation shellを比較する" })
      .closest("article") as HTMLElement;
    await user.click(
      within(taskRow).getByRole("button", {
        name: "Navigation shellを比較する actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    expect(
      screen.queryByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    ).not.toBeInTheDocument();

    await navigate(router, "/trash");
    await user.click(
      await screen.findByRole("button", {
        name: "Restore Navigation shellを比較する",
      }),
    );
    await navigate(router, "/today");
    expect(
      await screen.findByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    ).toBeInTheDocument();
  });

  it("reports a Task Trash failure, rolls back, and allows retry from the context menu", async () => {
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "trash-error",
      title: "Trash error",
      path: ["Develop", "Trash error"],
      version: 1,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [task],
      todayOrders: { "2026-08-12": [task.id] },
    };
    const trashedSnapshot = {
      ...snapshot,
      tasks: [
        {
          ...task,
          trashedAt: "2026-08-23T00:00:00.000Z",
          trashOperationId: "trash-operation",
          version: 2,
        },
      ],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    let rejectTrash: (error: unknown) => void = () => {
      throw new Error("Trash rejection was not initialized");
    };
    const failedTrash = new Promise<never>((_resolve, reject) => {
      rejectTrash = reject;
    });
    const trashTask = vi
      .spyOn(api, "trashTask")
      .mockReturnValueOnce(failedTrash)
      .mockResolvedValueOnce(trashedSnapshot);

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const openTrashMenu = async () => {
        const row = (
          await screen.findByRole("button", {
            name: "Edit Trash error",
          })
        ).closest("article");
        if (!row) throw new Error("Trash error row was not rendered");
        await user.click(
          within(row).getByRole("button", { name: "Trash error actions" }),
        );
        await user.click(
          screen.getByRole("menuitem", { name: "Move to Trash" }),
        );
      };

      await openTrashMenu();
      expect(
        screen.queryByRole("button", { name: "Edit Trash error" }),
      ).not.toBeInTheDocument();
      await act(async () => {
        rejectTrash(new api.ApiRequestError(500, "raw response"));
      });

      const message =
        "Could not move “Trash error” to Trash. Try again from this Task.";
      expect(
        await screen.findByRole("region", {
          name: `Error notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Edit Trash error" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("raw response")).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("button", {
          name: `Close notification: ${message}`,
        }),
      );
      await openTrashMenu();

      expect(trashTask).toHaveBeenCalledTimes(2);
      expect(await screen.findByText("0 Open Tasks")).toBeInTheDocument();
      expect(
        screen.queryByRole("complementary", { name: "Notifications" }),
      ).not.toBeInTheDocument();
    } finally {
      trashTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("refreshes and reports a Task Trash version conflict without resubmitting", async () => {
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "trash-conflict",
      title: "Trash conflict",
      path: ["Develop", "Trash conflict"],
      version: 1,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [task],
      todayOrders: { "2026-08-12": [task.id] },
    };
    const latestTask = {
      ...task,
      title: "Trash conflict latest",
      path: ["Develop", "Trash conflict latest"],
      version: 2,
    };
    const latestSnapshot = { ...snapshot, tasks: [latestTask] };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(latestSnapshot);
    const trashTask = vi
      .spyOn(api, "trashTask")
      .mockRejectedValue(
        new api.ApiRequestError(
          409,
          "raw conflict response",
          "TASK_VERSION_CONFLICT",
        ),
      );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/today"]}>
              <TaskStoreProvider>
                <TodayPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const row = (
        await screen.findByRole("button", { name: "Edit Trash conflict" })
      ).closest("article");
      if (!row) throw new Error("Trash conflict row was not rendered");
      await user.click(
        within(row).getByRole("button", { name: "Trash conflict actions" }),
      );
      await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));

      const message =
        "“Trash conflict” changed elsewhere. Review the latest Task before trying to move it to Trash again.";
      expect(
        await screen.findByRole("region", {
          name: `Warning notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(loadBootstrap).toHaveBeenCalledTimes(2);
      expect(trashTask).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByRole("button", {
          name: "Edit Trash conflict latest",
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("raw conflict response"),
      ).not.toBeInTheDocument();
    } finally {
      trashTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("refreshes and reports a Restore version conflict without resubmitting", async () => {
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "restore-conflict",
      title: "Restore conflict",
      path: ["Develop", "Restore conflict"],
      trashedAt: "2026-08-22T00:00:00.000Z",
      trashOperationId: "trash-operation",
      version: 2,
    });
    const snapshot = { ...testSnapshot, tasks: [task] };
    const restoredSnapshot = {
      ...snapshot,
      tasks: [
        {
          ...task,
          trashedAt: null,
          trashOperationId: null,
          version: 3,
        },
      ],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot);
    let rejectRestore: (error: unknown) => void = () => {
      throw new Error("Restore rejection was not initialized");
    };
    const failedRestore = new Promise<never>((_resolve, reject) => {
      rejectRestore = reject;
    });
    const restoreTask = vi
      .spyOn(api, "restoreTask")
      .mockReturnValueOnce(failedRestore)
      .mockResolvedValueOnce(restoredSnapshot);

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/trash"]}>
              <TaskStoreProvider>
                <TrashPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const restoreControl = await screen.findByRole("button", {
        name: "Restore Restore conflict",
      });
      await user.click(restoreControl);
      expect(
        screen.queryByRole("button", { name: "Restore Restore conflict" }),
      ).not.toBeInTheDocument();
      await act(async () => {
        rejectRestore(
          new api.ApiRequestError(
            409,
            "raw conflict response",
            "TASK_VERSION_CONFLICT",
          ),
        );
      });

      const message =
        "“Restore conflict” changed elsewhere. Review the latest Task before trying to restore it again from Trash.";
      expect(
        await screen.findByRole("region", {
          name: `Warning notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(loadBootstrap).toHaveBeenCalledTimes(2);
      expect(restoreTask).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByRole("button", { name: "Restore Restore conflict" }),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", {
          name: `Close notification: ${message}`,
        }),
      );
      await user.click(
        screen.getByRole("button", { name: "Restore Restore conflict" }),
      );

      expect(restoreTask).toHaveBeenCalledTimes(2);
      expect(await screen.findByText("Trash is empty")).toBeInTheDocument();
      expect(
        screen.queryByRole("complementary", { name: "Notifications" }),
      ).not.toBeInTheDocument();
    } finally {
      restoreTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("reports a Restore domain rejection as a Warning and rolls back", async () => {
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "restore-rejected",
      title: "Restore rejected",
      path: ["Develop", "Restore rejected"],
      trashedAt: "2026-08-22T00:00:00.000Z",
      trashOperationId: "trash-operation",
      version: 2,
    });
    const snapshot = { ...testSnapshot, tasks: [task] };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const restoreTask = vi
      .spyOn(api, "restoreTask")
      .mockRejectedValue(
        new api.ApiRequestError(404, "raw rejection", "TASK_NOT_FOUND"),
      );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/trash"]}>
              <TaskStoreProvider>
                <TrashPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", { name: "Restore Restore rejected" }),
      );

      const message =
        "Could not restore “Restore rejected”. Review the latest Task and try again from Trash.";
      expect(
        await screen.findByRole("region", {
          name: `Warning notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Restore Restore rejected" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("raw rejection")).not.toBeInTheDocument();
    } finally {
      restoreTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("reports a Restore server failure as an Error and rolls back", async () => {
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "restore-server-error",
      title: "Restore server error",
      path: ["Develop", "Restore server error"],
      trashedAt: "2026-08-22T00:00:00.000Z",
      trashOperationId: "trash-operation",
      version: 2,
    });
    const snapshot = { ...testSnapshot, tasks: [task] };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const restoreTask = vi
      .spyOn(api, "restoreTask")
      .mockRejectedValue(new api.ApiRequestError(500, "raw response"));

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/trash"]}>
              <TaskStoreProvider>
                <TrashPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", {
          name: "Restore Restore server error",
        }),
      );

      const message =
        "Could not restore “Restore server error”. Try again from Trash.";
      expect(
        await screen.findByRole("region", {
          name: `Error notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole("button", {
          name: "Restore Restore server error",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText("raw response")).not.toBeInTheDocument();
    } finally {
      restoreTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });
});

describe("WeekPage", () => {
  it("accepts only valid week start values", () => {
    expect(weekStartsOnSchema.safeParse(0).success).toBe(true);
    expect(weekStartsOnSchema.safeParse(6).success).toBe(true);
    expect(weekStartsOnSchema.safeParse(7).success).toBe(false);
  });

  it("accepts UTC as an Owner timezone", () => {
    expect(ownerTimeZoneSchema.safeParse("UTC").success).toBe(true);
  });

  it("shows the week range beside the title", () => {
    render(
      <AppSettingsProvider>
        <MemoryRouter initialEntries={["/week"]}>
          <TaskStoreProvider>
            <WeekPage />
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "This Week" }).parentElement,
    ).toHaveTextContent("This WeekMonday — Sunday");
  });

  it("uses the week start selected in Settings", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
        {
          path: "/week",
          element: <WeekPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Week starts on" }),
      "Sunday",
    );
    await navigate(router, "/week");

    expect(
      (await screen.findByRole("heading", { name: "This Week" })).parentElement,
    ).toHaveTextContent("This WeekSunday — Saturday");
  });

  it("uses a renamed Area in Task tree paths", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
        {
          path: "/week",
          element: <WeekPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const areaName = await screen.findByDisplayValue("Develop");
    await user.clear(areaName);
    await user.type(areaName, "Software");
    await user.tab();
    await navigate(router, "/week");

    expect(
      await screen.findByTitle("Software / Taskseq MVP / UI prototype"),
    ).toBeInTheDocument();
  });

  it("shows Scheduled Open Tasks through the week end in Area and path order", () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const parent = scheduledTask({
      id: "scheduled-parent",
      title: "Scheduled parent",
      path: ["Develop", "Scheduled parent"],
    });
    const child = scheduledTask({
      id: "scheduled-child",
      title: "Scheduled child",
      path: ["Develop", "Scheduled parent", "Scheduled child"],
      parentId: parent.id,
      start: "2026-08-15",
    });
    const musicTask = scheduledTask({
      id: "music-task",
      title: "Music task",
      path: ["Music", "Music task"],
      areaId: testAreaIds.music,
      start: "2026-08-13",
    });
    const afterWeek = scheduledTask({
      id: "after-week",
      title: "After week",
      path: ["Develop", "After week"],
      start: "2026-08-16",
    });
    const unscheduled = scheduledTask({
      id: "week-unscheduled-task",
      title: "Week unscheduled task",
      path: ["Develop", "Week unscheduled task"],
      start: null,
    });
    const dueOnly = scheduledTask({
      id: "week-due-only-task",
      title: "Week due only task",
      path: ["Develop", "Week due only task"],
      start: null,
      due: "2026-08-13",
    });
    const completed = scheduledTask({
      id: "week-completed-task",
      title: "Week completed task",
      path: ["Develop", "Week completed task"],
      status: "COMPLETED",
      completedAt: "2026-08-12T01:00:00.000Z",
    });
    const inbox = scheduledTask({
      id: "week-inbox-task",
      title: "Week inbox task",
      path: ["Inbox", "Week inbox task"],
      areaId: testAreaIds.inbox,
    });
    const inboxChild = scheduledTask({
      id: "week-inbox-child",
      title: "Week inbox child",
      path: ["Inbox", "Week inbox task", "Week inbox child"],
      areaId: testAreaIds.inbox,
      parentId: inbox.id,
      start: "2026-08-15",
    });
    const startTakesPrecedence = scheduledTask({
      id: "week-start-takes-precedence",
      title: "Week Start takes precedence",
      path: ["Develop", "Week Start takes precedence"],
      start: "2026-08-17",
      due: "2026-08-13",
    });
    const trashed = scheduledTask({
      id: "week-trashed-task",
      title: "Week trashed task",
      path: ["Develop", "Week trashed task"],
      trashedAt: "2026-08-11T00:00:00.000Z",
    });
    const snapshot = {
      ...testSnapshot,
      ownerSettings: { ...testSnapshot.ownerSettings, weekStartsOn: 0 },
      tasks: [
        musicTask,
        afterWeek,
        child,
        parent,
        unscheduled,
        dueOnly,
        completed,
        inbox,
        inboxChild,
        startTakesPrecedence,
        trashed,
      ],
    };

    try {
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/week"]}>
              <TaskStoreProvider>
                <WeekPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const parentTitle = screen.getByRole("button", {
        name: "Edit Scheduled parent",
      });
      const childTitle = screen.getByRole("button", {
        name: "Edit Scheduled child",
      });
      const musicTitle = screen.getByRole("button", {
        name: "Edit Music task",
      });
      const dueOnlyTitle = screen.getByRole("button", {
        name: "Edit Week due only task",
      });
      const inboxTitle = screen.getByRole("button", {
        name: "Edit Week inbox task",
      });
      const inboxChildTitle = screen.getByRole("button", {
        name: "Edit Week inbox child",
      });
      expect(
        parentTitle.compareDocumentPosition(childTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        childTitle.compareDocumentPosition(musicTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        dueOnlyTitle.compareDocumentPosition(musicTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        musicTitle.compareDocumentPosition(inboxTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        inboxTitle.compareDocumentPosition(inboxChildTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const parentRow = parentTitle.closest("article");
      const childRow = childTitle.closest("article");
      const musicRow = musicTitle.closest("article");
      const dueOnlyRow = dueOnlyTitle.closest("article");
      const inboxRow = inboxTitle.closest("article");
      const inboxChildRow = inboxChildTitle.closest("article");
      if (
        !parentRow ||
        !childRow ||
        !musicRow ||
        !dueOnlyRow ||
        !inboxRow ||
        !inboxChildRow
      ) {
        throw new Error("Task rows are missing");
      }
      expect(within(parentRow).getByTitle("Develop")).toBeInTheDocument();
      expect(
        within(childRow).getByTitle("Develop / Scheduled parent"),
      ).toBeInTheDocument();
      expect(within(musicRow).getByTitle("Music")).toBeInTheDocument();
      expect(within(dueOnlyRow).getByTitle("Develop")).toBeInTheDocument();
      expect(within(inboxRow).getByTitle("Inbox")).toBeInTheDocument();
      expect(
        within(inboxChildRow).getByTitle("Inbox / Week inbox task"),
      ).toBeInTheDocument();
      expect(
        inboxChildRow.querySelector('[data-slot="task-list-path"] [lang="en"]'),
      ).toHaveTextContent("Inbox");
      expect(
        screen.getByText(
          "Open Tasks scheduled from Today through Saturday. Tasks without Start use Due and appear in Area and tree-path order.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit After week" }),
      ).not.toBeInTheDocument();
      for (const title of [
        "Week unscheduled task",
        "Week completed task",
        "Week Start takes precedence",
        "Week trashed task",
      ]) {
        expect(
          screen.queryByRole("button", { name: `Edit ${title}` }),
        ).not.toBeInTheDocument();
      }
      expect(
        screen.queryByRole("button", { name: /^Reorder / }),
      ).not.toBeInTheDocument();
    } finally {
      now.mockRestore();
    }
  });

  it("shows Inbox Tasks when no Owner-managed Area exists", () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-08-12T12:00:00.000Z").getTime());
    const inboxArea = testSnapshot.areas.find((area) => area.isSystemManaged);
    if (!inboxArea) throw new Error("Test Inbox Area is not configured");
    const inboxTask = scheduledTask({
      id: "inbox-only-week-task",
      title: "Inbox-only week task",
      path: ["Inbox", "Inbox-only week task"],
      areaId: inboxArea.id,
      start: null,
      due: "2026-08-16",
    });

    try {
      render(
        <BootstrapProvider
          initialSnapshot={{
            ...testSnapshot,
            areas: [inboxArea],
            tasks: [inboxTask],
          }}
        >
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/week"]}>
              <TaskStoreProvider>
                <WeekPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      expect(
        screen.getByRole("button", { name: "Edit Inbox-only week task" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^Reorder / }),
      ).not.toBeInTheDocument();
    } finally {
      now.mockRestore();
    }
  });
});

describe("AreasPage", () => {
  it("keeps the system-managed Inbox out of Owner Area management", () => {
    render(
      <AppSettingsProvider>
        <MemoryRouter initialEntries={["/areas"]}>
          <TaskStoreProvider>
            <AreasPage />
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("heading", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByText("Develop")).toBeInTheDocument();
    expect(screen.queryByText("Inbox")).not.toBeInTheDocument();
  });

  it("localizes the page description when the display language is English", () => {
    applyDisplayLanguage("en");

    render(
      <AppSettingsProvider>
        <MemoryRouter initialEntries={["/areas"]}>
          <TaskStoreProvider>
            <AreasPage />
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    expect(
      screen.getByText("Manage Task trees by ongoing areas of responsibility."),
    ).toBeInTheDocument();
  });

  it("keeps the localized Japanese description natural", () => {
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };

    render(
      <AppSettingsProvider initialSnapshot={snapshot}>
        <MemoryRouter initialEntries={["/areas"]}>
          <TaskStoreProvider>
            <AreasPage />
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("heading", { name: "Areas" })).toHaveAttribute(
      "lang",
      "en",
    );
    expect(screen.getByText("責任領域")).toBeInTheDocument();
    expect(screen.getByText("7件のタスク")).toBeInTheDocument();
    expect(
      screen.getByText("継続的な責任領域ごとにタスクツリーを管理します。"),
    ).toBeInTheDocument();
    applyDisplayLanguage("en");
  });
});

describe("AreaDetailPage", () => {
  it("keeps Inbox and multiple Area Detail collapse states isolated", async () => {
    const user = userEvent.setup();
    const baseTask = testSnapshot.tasks[0] as Task;
    const inboxParent: Task = {
      ...baseTask,
      id: "collapse-inbox-parent",
      title: "Collapse Inbox parent",
      path: ["Inbox", "Collapse Inbox parent"],
      areaId: testAreaIds.inbox,
      parentId: undefined,
      status: "OPEN",
    };
    const inboxChild: Task = {
      ...baseTask,
      id: "collapse-inbox-child",
      title: "Collapse Inbox child",
      path: ["Inbox", inboxParent.title, "Collapse Inbox child"],
      areaId: testAreaIds.inbox,
      parentId: inboxParent.id,
      status: "OPEN",
    };
    const areaParent: Task = {
      ...baseTask,
      id: "collapse-area-parent",
      title: "Collapse Area parent",
      path: ["Develop", "Collapse Area parent"],
      areaId: testAreaIds.develop,
      parentId: undefined,
      status: "OPEN",
    };
    const areaChild: Task = {
      ...baseTask,
      id: "collapse-area-child",
      title: "Collapse Area child",
      path: ["Develop", areaParent.title, "Collapse Area child"],
      areaId: testAreaIds.develop,
      parentId: areaParent.id,
      status: "OPEN",
    };
    const secondAreaParent: Task = {
      ...baseTask,
      id: "collapse-second-area-parent",
      title: "Collapse second Area parent",
      path: ["Music", "Collapse second Area parent"],
      areaId: testAreaIds.music,
      parentId: undefined,
      status: "OPEN",
    };
    const secondAreaChild: Task = {
      ...baseTask,
      id: "collapse-second-area-child",
      title: "Collapse second Area child",
      path: ["Music", secondAreaParent.title, "Collapse second Area child"],
      areaId: testAreaIds.music,
      parentId: secondAreaParent.id,
      status: "OPEN",
    };
    const snapshot = {
      ...testSnapshot,
      tasks: [
        inboxParent,
        inboxChild,
        areaParent,
        areaChild,
        secondAreaParent,
        secondAreaChild,
      ],
      inboxOrder: [inboxParent.id],
      areaTaskOrders: {
        [`parent:${inboxParent.id}`]: [inboxChild.id],
        [`area:${testAreaIds.develop}`]: [areaParent.id],
        [`parent:${areaParent.id}`]: [areaChild.id],
        [`area:${testAreaIds.music}`]: [secondAreaParent.id],
        [`parent:${secondAreaParent.id}`]: [secondAreaChild.id],
      },
    };
    const router = createMemoryRouter(
      [
        { path: "/inbox", element: <InboxPage /> },
        { path: "/areas/:areaId", element: <AreaDetailPage /> },
      ],
      { initialEntries: ["/inbox"] },
    );

    render(
      <AppSettingsProvider initialSnapshot={snapshot}>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.click(
      screen.getByRole("button", {
        name: `Collapse ${inboxParent.title}`,
      }),
    );
    expect(
      screen.queryByRole("treeitem", { name: inboxChild.title }),
    ).not.toBeInTheDocument();

    await navigate(router, `/areas/${testAreaIds.develop}`);
    await user.click(
      screen.getByRole("button", {
        name: `Collapse ${areaParent.title}`,
      }),
    );
    expect(
      screen.queryByRole("treeitem", { name: areaChild.title }),
    ).not.toBeInTheDocument();

    await navigate(router, `/areas/${testAreaIds.music}`);
    await user.click(
      screen.getByRole("button", {
        name: `Collapse ${secondAreaParent.title}`,
      }),
    );
    expect(
      screen.queryByRole("treeitem", { name: secondAreaChild.title }),
    ).not.toBeInTheDocument();

    await navigate(router, "/inbox");
    expect(
      screen.queryByRole("treeitem", { name: inboxChild.title }),
    ).not.toBeInTheDocument();
    await navigate(router, `/areas/${testAreaIds.develop}`);
    expect(
      screen.queryByRole("treeitem", { name: areaChild.title }),
    ).not.toBeInTheDocument();
    await navigate(router, `/areas/${testAreaIds.music}`);
    expect(
      screen.queryByRole("treeitem", { name: secondAreaChild.title }),
    ).not.toBeInTheDocument();
  });

  it("keeps Area order independent from Today order", async () => {
    const user = userEvent.setup();

    render(
      <AppSettingsProvider>
        <MemoryRouter initialEntries={[`/areas/${testAreaIds.develop}`]}>
          <TaskStoreProvider>
            <ReorderTodayFixture />
            <Routes>
              <Route path="/areas/:areaId" element={<AreaDetailPage />} />
            </Routes>
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    const uiPrototypeHandle = screen.getByRole("button", {
      name: "Reorder UI prototype",
    });
    const apiContractHandle = screen.getByRole("button", {
      name: "Reorder API contractを確認する",
    });
    expect(
      uiPrototypeHandle.compareDocumentPosition(apiContractHandle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Reorder Today fixture" }),
    );

    expect(
      uiPrototypeHandle.compareDocumentPosition(apiContractHandle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("completes a Task from the Area tree", async () => {
    const user = userEvent.setup();

    const router = createMemoryRouter(
      [
        {
          path: "/",
          children: [
            { index: true, element: <div /> },
            { path: "areas/:areaId", element: <AreaDetailPage /> },
          ],
        },
        { path: "/task-mutations", action: taskMutationTestAction },
      ],
      { initialEntries: [`/areas/${testAreaIds.develop}`] },
    );
    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Complete API contractを確認する",
      }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Show Completed" }));
    expect(
      screen.getByRole("button", {
        name: "Reopen API contractを確認する",
      }),
    ).toBeInTheDocument();
  });

  it("collapses and expands Tasks that have children", async () => {
    const user = userEvent.setup();

    render(
      <AppSettingsProvider>
        <MemoryRouter initialEntries={[`/areas/${testAreaIds.develop}`]}>
          <TaskStoreProvider>
            <Routes>
              <Route path="/areas/:areaId" element={<AreaDetailPage />} />
            </Routes>
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    expect(
      screen.getByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Collapse Taskseq MVP",
      }),
    );
    expect(
      screen.queryByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Expand Taskseq MVP",
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    ).toBeInTheDocument();
  });

  it("keeps descendant Tasks visible when a parent Task is renamed", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/areas/:areaId",
          element: <AreaDetailPage />,
        },
        { path: "/task-mutations", action: taskMutationTestAction },
      ],
      { initialEntries: [`/areas/${testAreaIds.develop}`] },
    );
    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <TaskPathProbe taskId="task-ui-prototype" />
          <TaskPathProbe taskId="task-touch-interactions" />
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Edit Taskseq MVP" }));
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Taskseq App");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      screen.getByRole("treeitem", { name: "Taskseq App" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "Navigation shellを比較する" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByTestId("task-path-task-ui-prototype"),
      ).toHaveTextContent("Develop/Taskseq App/UI prototype");
      expect(
        screen.getByTestId("task-path-task-touch-interactions"),
      ).toHaveTextContent(
        "Develop/Taskseq App/UI prototype/Mobile verification/iPhone Safari/Touch interactions",
      );
    });
  });

  it("hides Completed Tasks until the user enables them", async () => {
    const user = userEvent.setup();

    render(
      <AppSettingsProvider>
        <MemoryRouter initialEntries={[`/areas/${testAreaIds.pkm}`]}>
          <TaskStoreProvider>
            <Routes>
              <Route path="/areas/:areaId" element={<AreaDetailPage />} />
            </Routes>
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    expect(
      screen.queryByRole("button", {
        name: "Edit Daily noteをreviewする",
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show Completed" }));

    expect(
      screen.getByRole("button", {
        name: "Edit Daily noteをreviewする",
      }),
    ).toBeInTheDocument();
  });
});

describe("Owner display language", () => {
  it("exposes stable language options, switches immediately, saves settings, and survives reload", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
        version: 2,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(testSnapshot)
      .mockResolvedValueOnce(savedSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockResolvedValue(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      const rendered = render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const language = await screen.findByRole("combobox", {
        name: "Display language",
      });
      const ownerSettingsForm = language.closest("form");
      expect(ownerSettingsForm).not.toBeNull();
      expect(
        within(ownerSettingsForm as HTMLElement).getAllByRole("combobox")[0],
      ).toBe(language);
      expect(
        within(language).getByRole("option", { name: "English" }),
      ).toBeInTheDocument();
      expect(
        within(language).getByRole("option", { name: "日本語" }),
      ).toBeInTheDocument();

      await user.selectOptions(language, "ja");

      expect(
        await screen.findByText("Ownerのタイムゾーン"),
      ).toBeInTheDocument();
      expect(document.documentElement.lang).toBe("ja");
      expect(updateOwnerSettings).toHaveBeenCalledWith({
        displayLanguage: "ja",
        timeZone: "Asia/Tokyo",
        weekStartsOn: 1,
        trashRetentionDays: 30,
        version: 1,
      });
      expect(loadBootstrap).toHaveBeenCalledTimes(1);

      rendered.unmount();
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );
      const reloadedLanguage = await screen.findByRole("combobox", {
        name: "表示言語",
      });
      expect(reloadedLanguage).toHaveValue("ja");
      expect(document.documentElement.lang).toBe("ja");
      expect(loadBootstrap).toHaveBeenCalledTimes(2);
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
      applyDisplayLanguage("en");
    }
  });

  it("rolls back a failed language save and marks the attempted-language notification", async () => {
    const user = userEvent.setup();
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockRejectedValue(new Error("raw language response"));
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const language = await screen.findByRole("combobox", {
        name: "Display language",
      });
      await user.selectOptions(language, "ja");

      const message =
        "表示言語を保存できませんでした。もう一度表示言語を変更してください。";
      const notification = await screen.findByRole("region", {
        name: `エラー通知: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw language response");
      expect(within(notification).getByText("エラー")).toBeInTheDocument();
      expect(within(notification).getByText(message)).toHaveAttribute(
        "lang",
        "ja",
      );
      expect(
        within(notification).getByRole("button", {
          name: `通知を閉じる: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(language).toHaveValue("en");
      expect(document.documentElement.lang).toBe("en");
      expect(updateOwnerSettings).toHaveBeenCalledTimes(1);
      expect(loadBootstrap).toHaveBeenCalledTimes(1);
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
      applyDisplayLanguage("en");
    }
  });

  it("uses the latest saved language after a version conflict without resubmitting", async () => {
    const user = userEvent.setup();
    const latestSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "en" as const,
        version: 2,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(testSnapshot)
      .mockResolvedValueOnce(latestSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockRejectedValue(
        new api.ApiRequestError(
          409,
          "raw language conflict response",
          "OWNER_SETTINGS_VERSION_CONFLICT",
        ),
      );
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const language = await screen.findByRole("combobox", {
        name: "Display language",
      });
      await user.selectOptions(language, "ja");

      const message =
        "Display language changed elsewhere. Review the latest setting before changing Display language again.";
      const notification = await screen.findByRole("region", {
        name: `Warning notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent(
        "raw language conflict response",
      );
      expect(within(notification).getByText(message)).toHaveAttribute(
        "lang",
        "en",
      );
      expect(language).toHaveValue("en");
      expect(document.documentElement.lang).toBe("en");
      expect(loadBootstrap).toHaveBeenCalledTimes(2);
      expect(updateOwnerSettings).toHaveBeenCalledTimes(1);
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
      applyDisplayLanguage("en");
    }
  });
});

describe("Area settings", () => {
  it("keeps an Area draft, reports a save failure, and allows retry from the field", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      areas: testSnapshot.areas.map((area) =>
        area.name === "Develop" ? { ...area, name: "Software" } : area,
      ),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const updateArea = vi
      .spyOn(api, "updateArea")
      .mockRejectedValueOnce(new Error("raw server detail"))
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const areaName = await screen.findByDisplayValue("Develop");
      await user.clear(areaName);
      await user.type(areaName, "Software");
      await user.tab();

      const notification = await screen.findByRole("complementary", {
        name: "Notifications",
      });
      expect(notification).toHaveTextContent("Could not save");
      expect(notification).not.toHaveTextContent("raw server detail");
      expect(screen.getByDisplayValue("Software")).toBeInTheDocument();

      await user.click(screen.getByDisplayValue("Software"));
      await user.tab();

      expect(updateArea).toHaveBeenCalledTimes(2);
      expect(await screen.findByDisplayValue("Software")).toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      updateArea.mockRestore();
    }
  });

  it("shows field validation beside Area and Tag controls and revalidates changes", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const areaName = await screen.findByDisplayValue("Develop");
    await user.clear(areaName);
    await user.tab();
    expect(areaName).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an Area name");

    await user.type(areaName, "Work, Personal");
    await user.tab();
    expect(areaName).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Area names cannot contain commas",
    );

    await user.clear(areaName);
    await user.type(areaName, "Software");
    await user.tab();
    expect(areaName).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const tagName = await screen.findByRole("textbox", {
      name: "Rename prototype",
    });
    await user.clear(tagName);
    await user.tab();
    expect(tagName).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a Tag name");

    await user.type(tagName, "api");
    await user.tab();
    expect(tagName).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.clear(tagName);
    await user.type(tagName, "api,ready");
    await user.tab();
    expect(tagName).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Tag names cannot contain commas",
    );
  });

  it("shows Area and Tag API validation beside their fields", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      areas: testSnapshot.areas.map((area) =>
        area.name === "Develop" ? { ...area, name: "Software" } : area,
      ),
    };
    const savedTagSnapshot = {
      ...savedSnapshot,
      tags: savedSnapshot.tags.map((tag) =>
        tag.name === "prototype" ? { ...tag, name: "api2" } : tag,
      ),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const updateArea = vi
      .spyOn(api, "updateArea")
      .mockRejectedValueOnce(
        new api.ApiRequestError(
          422,
          "raw area validation response",
          "AREA_INVALID",
          { name: "Area name is already used." },
        ),
      )
      .mockResolvedValueOnce(savedSnapshot);
    const renameTag = vi
      .spyOn(api, "renameTag")
      .mockRejectedValueOnce(
        new api.ApiRequestError(
          422,
          "raw tag validation response",
          "TAG_INVALID",
          { name: "Tag name is already used." },
        ),
      )
      .mockResolvedValueOnce(savedTagSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const areaName = await screen.findByDisplayValue("Develop");
      await user.clear(areaName);
      await user.type(areaName, "Software");
      await user.tab();
      expect(
        await screen.findByText("Area name is already used."),
      ).toBeVisible();
      expect(
        screen.queryByText("raw area validation response"),
      ).not.toBeInTheDocument();

      const softwareArea = screen.getByDisplayValue("Software");
      await user.clear(softwareArea);
      await user.type(softwareArea, "Software");
      await user.tab();
      expect(
        screen.queryByText("Area name is already used."),
      ).not.toBeInTheDocument();
      expect(updateArea).toHaveBeenCalledTimes(2);

      const tagName = await screen.findByRole("textbox", {
        name: "Rename prototype",
      });
      await user.clear(tagName);
      await user.type(tagName, "api");
      await user.tab();
      expect(
        await screen.findByText("Tag name is already used."),
      ).toBeVisible();
      expect(
        screen.queryByText("raw tag validation response"),
      ).not.toBeInTheDocument();

      const apiTag = screen.getByDisplayValue("api");
      await user.clear(apiTag);
      await user.type(apiTag, "api2");
      await user.tab();
      expect(
        screen.queryByText("Tag name is already used."),
      ).not.toBeInTheDocument();
      expect(renameTag).toHaveBeenCalledTimes(2);
    } finally {
      loadBootstrap.mockRestore();
      updateArea.mockRestore();
      renameTag.mockRestore();
    }
  });

  it("reports an Area create rejection without exposing the server response", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      areas: [
        ...testSnapshot.areas,
        {
          id: 999,
          name: "New Area",
          color: "gray" as const,
          position: 8,
          isSystemManaged: false,
        },
      ],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const createArea = vi
      .spyOn(api, "createArea")
      .mockRejectedValueOnce(
        new api.ApiRequestError(422, "raw create response", "AREA_INVALID", {
          name: "Area name is already used.",
        }),
      )
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(await screen.findByRole("button", { name: "Add Area" }));
      const message =
        "Could not create “New Area”. The Area name was rejected. Try adding the Area again.";
      const notification = await screen.findByRole("region", {
        name: `Warning notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw create response");
      expect(screen.queryByDisplayValue("New Area")).not.toBeInTheDocument();
      expect(createArea).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Add Area" }));
      expect(createArea).toHaveBeenCalledTimes(2);
      expect(await screen.findByDisplayValue("New Area")).toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      createArea.mockRestore();
    }
  });

  it("reports an Area order failure, rolls back, and allows retry", async () => {
    const user = userEvent.setup();
    const reorderedSnapshot = {
      ...testSnapshot,
      areas: testSnapshot.areas.map((area) =>
        area.name === "AI/IT"
          ? { ...area, position: 2 }
          : area.name === "Develop"
            ? { ...area, position: 1 }
            : area,
      ),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const reorderAreas = vi
      .spyOn(api, "reorderAreas")
      .mockRejectedValueOnce(new Error("raw order response"))
      .mockResolvedValueOnce(reorderedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    const isBefore = (first: HTMLElement, second: HTMLElement) =>
      Boolean(
        first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", { name: "Move AI/IT down" }),
      );
      const message = "Could not save Area order. Try moving an Area again.";
      const notification = await screen.findByRole("region", {
        name: `Error notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw order response");
      expect(
        isBefore(
          screen.getByDisplayValue("AI/IT"),
          screen.getByDisplayValue("Develop"),
        ),
      ).toBe(true);
      expect(reorderAreas).toHaveBeenCalledTimes(1);

      await user.click(
        screen.getByRole("button", {
          name: `Close notification: ${message}`,
        }),
      );
      await user.click(screen.getByRole("button", { name: "Move AI/IT down" }));
      expect(reorderAreas).toHaveBeenCalledTimes(2);
      expect(
        isBefore(
          screen.getByDisplayValue("Develop"),
          screen.getByDisplayValue("AI/IT"),
        ),
      ).toBe(true);
    } finally {
      loadBootstrap.mockRestore();
      reorderAreas.mockRestore();
    }
  });

  it("validates and saves the Trash retention period", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        trashRetentionDays: 21,
        version: 2,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockResolvedValue(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const retentionDays = await screen.findByRole("textbox", {
        name: "Trash retention days",
      });
      expect(retentionDays).toHaveValue("30");

      await user.clear(retentionDays);
      await user.type(retentionDays, "0");
      await user.click(
        screen.getByRole("button", { name: "Save Trash retention" }),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Enter a whole number of at least 1 for Trash retention",
      );

      await user.clear(retentionDays);
      await user.type(retentionDays, "14");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "Save Trash retention" }),
      );

      expect(updateOwnerSettings).toHaveBeenCalledWith({
        displayLanguage: "en",
        timeZone: "Asia/Tokyo",
        weekStartsOn: 1,
        trashRetentionDays: 14,
        version: 1,
      });
      expect(
        await screen.findByRole("textbox", { name: "Trash retention days" }),
      ).toHaveValue("21");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
    }
  });

  it("shows timezone and week-start validation beside the changed control", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const timezone = await screen.findByRole("combobox", {
      name: "Owner timezone",
    });
    fireEvent.change(timezone, { target: { value: "Not/A_Timezone" } });
    expect(
      await screen.findByText("Choose a supported timezone"),
    ).toBeInTheDocument();

    await user.selectOptions(timezone, "UTC");
    await waitFor(() =>
      expect(
        screen.queryByText("Choose a supported timezone"),
      ).not.toBeInTheDocument(),
    );

    const weekStartsOn = screen.getByRole("combobox", {
      name: "Week starts on",
    });
    fireEvent.change(weekStartsOn, { target: { value: "7" } });
    expect(
      await screen.findByText("Choose a supported week-start day"),
    ).toBeInTheDocument();

    await user.selectOptions(weekStartsOn, "Sunday");
    await waitFor(() =>
      expect(
        screen.queryByText("Choose a supported week-start day"),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps another owner-setting error when one field is corrected", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        timeZone: "UTC",
        version: 2,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockRejectedValueOnce(
        new api.ApiRequestError(
          422,
          "raw validation response",
          "OWNER_SETTINGS_INVALID",
          {
            timeZone: "Timezone was rejected by the server.",
            weekStartsOn: "Week start was rejected by the server.",
          },
        ),
      )
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const timezone = await screen.findByRole("combobox", {
        name: "Owner timezone",
      });
      await user.selectOptions(timezone, "America/Los_Angeles");

      expect(
        await screen.findByText("Timezone was rejected by the server."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Week start was rejected by the server."),
      ).toBeInTheDocument();

      await user.selectOptions(timezone, "UTC");

      await waitFor(() =>
        expect(
          screen.queryByText("Timezone was rejected by the server."),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.getByText("Week start was rejected by the server."),
      ).toBeInTheDocument();
      expect(updateOwnerSettings).toHaveBeenCalledTimes(2);
      expect(timezone).toHaveValue("UTC");
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
    }
  });

  it("keeps an invalid Trash retention draft when another setting saves", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        timeZone: "UTC",
        version: 2,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockResolvedValue(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const retentionDays = await screen.findByRole("textbox", {
        name: "Trash retention days",
      });
      await user.clear(retentionDays);
      await user.type(retentionDays, "0");
      await user.click(
        screen.getByRole("button", { name: "Save Trash retention" }),
      );
      expect(
        await screen.findByText(
          "Enter a whole number of at least 1 for Trash retention",
        ),
      ).toBeInTheDocument();

      await user.selectOptions(
        screen.getByRole("combobox", { name: "Owner timezone" }),
        "UTC",
      );

      await waitFor(() => expect(updateOwnerSettings).toHaveBeenCalledTimes(1));
      expect(retentionDays).toHaveValue("0");
      expect(
        screen.getByText(
          "Enter a whole number of at least 1 for Trash retention",
        ),
      ).toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
    }
  });

  it("reports a timezone save failure, rolls back, and allows retry", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        timeZone: "America/Los_Angeles",
        version: 2,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockRejectedValueOnce(new Error("raw timezone response"))
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const timezone = await screen.findByRole("combobox", {
        name: "Owner timezone",
      });
      await user.selectOptions(timezone, "America/Los_Angeles");

      const message =
        "Could not save Owner timezone. Try changing Owner timezone again.";
      const notification = await screen.findByRole("region", {
        name: `Error notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw timezone response");
      expect(timezone).toHaveValue("Asia/Tokyo");
      expect(updateOwnerSettings).toHaveBeenCalledTimes(1);

      await user.click(
        screen.getByRole("button", {
          name: `Close notification: ${message}`,
        }),
      );
      await user.selectOptions(timezone, "America/Los_Angeles");

      expect(updateOwnerSettings).toHaveBeenCalledTimes(2);
      expect(timezone).toHaveValue("America/Los_Angeles");
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
    }
  });

  it("reloads the latest week start after a conflict without resubmitting", async () => {
    const user = userEvent.setup();
    const latestSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        weekStartsOn: 2 as const,
        version: 2,
      },
    };
    const savedSnapshot = {
      ...latestSnapshot,
      ownerSettings: {
        ...latestSnapshot.ownerSettings,
        weekStartsOn: 4 as const,
        version: 3,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(testSnapshot)
      .mockResolvedValueOnce(latestSnapshot);
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockRejectedValueOnce(
        new api.ApiRequestError(
          409,
          "raw conflict response",
          "OWNER_SETTINGS_VERSION_CONFLICT",
        ),
      )
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const weekStartsOn = await screen.findByRole("combobox", {
        name: "Week starts on",
      });
      await user.selectOptions(weekStartsOn, "Sunday");

      const message =
        "Week start changed elsewhere. Review the latest setting before changing Week starts on again.";
      const notification = await screen.findByRole("region", {
        name: `Warning notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw conflict response");
      expect(weekStartsOn).toHaveValue("2");
      expect(loadBootstrap).toHaveBeenCalledTimes(2);
      expect(updateOwnerSettings).toHaveBeenCalledTimes(1);

      await user.click(
        screen.getByRole("button", {
          name: `Close notification: ${message}`,
        }),
      );
      await user.selectOptions(weekStartsOn, "Thursday");

      expect(updateOwnerSettings).toHaveBeenCalledTimes(2);
      expect(weekStartsOn).toHaveValue("4");
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
    }
  });

  it("reports an error when owner settings cannot reload after a conflict", async () => {
    const user = userEvent.setup();
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(testSnapshot)
      .mockRejectedValueOnce(new Error("raw reload response"));
    const updateOwnerSettings = vi
      .spyOn(api, "updateOwnerSettings")
      .mockRejectedValue(
        new api.ApiRequestError(
          409,
          "raw conflict response",
          "OWNER_SETTINGS_VERSION_CONFLICT",
        ),
      );
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const retentionDays = await screen.findByRole("textbox", {
        name: "Trash retention days",
      });
      await user.clear(retentionDays);
      await user.type(retentionDays, "14");
      await user.click(
        screen.getByRole("button", { name: "Save Trash retention" }),
      );

      const message =
        "Could not refresh Trash retention after a version conflict. Reload the page, then try saving Trash retention again.";
      const notification = await screen.findByRole("region", {
        name: `Error notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw reload response");
      expect(notification).not.toHaveTextContent("raw conflict response");
      expect(retentionDays).toHaveValue("30");
      expect(updateOwnerSettings).toHaveBeenCalledTimes(1);
    } finally {
      loadBootstrap.mockRestore();
      updateOwnerSettings.mockRestore();
    }
  });

  it("uses the configured Areas in the list and New Task dialog", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
        {
          path: "/areas",
          element: <AreasPage />,
        },
        {
          path: "/new",
          element: <NewTaskDialog open onOpenChange={() => undefined} />,
        },
        {
          path: "/today",
          element: <TodayPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const areaName = await screen.findByDisplayValue("Develop");
    await user.clear(areaName);
    await user.type(areaName, "Software");
    await user.tab();

    await navigate(router, "/areas");
    expect(
      await screen.findByRole("heading", { name: "Software" }),
    ).toBeInTheDocument();

    await navigate(router, "/new");
    expect(
      await screen.findByRole("option", { name: "Software" }),
    ).toBeInTheDocument();

    await navigate(router, "/today");
    const updatedTaskPath = await screen.findByTitle(
      "Software / Taskseq MVP / UI prototype",
    );
    expect(updatedTaskPath).toHaveTextContent(
      "Software / Taskseq MVP / UI prototype",
    );
  });

  it("lets the Owner timezone be changed", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const timezone = await screen.findByRole("combobox", {
      name: "Owner timezone",
    });
    await user.selectOptions(timezone, "America/Los_Angeles");

    expect(timezone).toHaveValue("America/Los_Angeles");
  });

  it("renames and deletes Tags in Task data without changing View definitions", async () => {
    const user = userEvent.setup();
    const prototypeTag = testSnapshot.tags.find(
      (tag) => tag.name === "prototype",
    );
    const frontendTag = testSnapshot.tags.find(
      (tag) => tag.name === "frontend",
    );
    if (!prototypeTag || !frontendTag) {
      throw new Error("Tag fixtures are missing");
    }
    const snapshot = {
      ...testSnapshot,
      views: [
        {
          id: "view-tag-rename",
          name: "Tag rename View",
          allTasks: false,
          conditions: [
            {
              field: "tag" as const,
              operator: "containsAll" as const,
              value: [prototypeTag.name, frontendTag.name],
            },
          ],
          sort: [...defaultViewSort],
          columns: [...defaultViewColumns],
          version: 1,
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    };
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
        { path: "/today", element: <TodayPage /> },
        { path: "/views", element: <ViewManagementPage /> },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <TaskStoreProvider>
            <RouterProvider router={router} />
          </TaskStoreProvider>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    const tagName = await screen.findByRole("textbox", {
      name: "Rename prototype",
    });
    expect(tagName).toHaveClass("text-base", "min-[560px]:text-xs");
    expect(
      await screen.findByRole("textbox", { name: "Rename Develop" }),
    ).toHaveClass("text-base", "min-[560px]:text-sm");
    expect(
      screen.getByRole("textbox", { name: "Rename unused" }),
    ).toBeInTheDocument();
    await user.clear(tagName);
    await user.type(tagName, "api");
    await user.tab();
    expect(
      screen.getByRole("textbox", { name: "Rename api" }),
    ).toBeInTheDocument();

    await navigate(router, "/views");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    let viewDialog = screen.getByRole("dialog", { name: "Edit View" });
    expect(
      within(viewDialog).getByRole("combobox", { name: "Tags" }),
    ).toHaveValue("prototype, frontend");
    await user.click(within(viewDialog).getByRole("button", { name: "Close" }));

    await navigate(router, "/today");
    await user.click(
      await screen.findByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Tags" })).toHaveValue(
      "api, frontend",
    );

    await navigate(router, "/settings");
    const apiTag = await screen.findByRole("textbox", {
      name: "Rename api",
    });
    await user.clear(apiTag);
    await user.type(apiTag, "frontend");
    await user.tab();
    expect(
      screen.queryByRole("textbox", { name: "Rename api" }),
    ).not.toBeInTheDocument();

    await navigate(router, "/views");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    viewDialog = screen.getByRole("dialog", { name: "Edit View" });
    expect(
      within(viewDialog).getByRole("combobox", { name: "Tags" }),
    ).toHaveValue("prototype, frontend");
    await user.click(within(viewDialog).getByRole("button", { name: "Close" }));

    await navigate(router, "/today");
    await user.click(
      await screen.findByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Tags" })).toHaveValue(
      "frontend",
    );

    await navigate(router, "/settings");
    await user.click(
      await screen.findByRole("button", { name: "Delete frontend" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete Tag" })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );
    expect(
      screen.queryByRole("textbox", { name: "Rename frontend" }),
    ).not.toBeInTheDocument();
  });

  it("does not show affected View names before deleting a Tag", async () => {
    const user = userEvent.setup();
    const prototypeTag = testSnapshot.tags.find(
      (tag) => tag.name === "prototype",
    );
    if (!prototypeTag) throw new Error("prototype Tag fixture is missing");
    const snapshot = {
      ...testSnapshot,
      views: [
        {
          id: "view-prototype",
          name: "Prototype work",
          allTasks: false,
          conditions: [
            {
              field: "tag" as const,
              operator: "containsAll" as const,
              value: [prototypeTag.name],
            },
          ],
          sort: [...defaultViewSort],
          columns: [...defaultViewColumns],
          version: 1,
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
        },
        {
          id: "view-unrelated",
          name: "Unrelated work",
          allTasks: true,
          conditions: [],
          sort: [...defaultViewSort],
          columns: [...defaultViewColumns],
          version: 1,
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
        },
        {
          id: "view-combined",
          name: "Combined work",
          allTasks: false,
          conditions: [
            {
              field: "tag" as const,
              operator: "containsAll" as const,
              value: [prototypeTag.name, "frontend"],
            },
          ],
          sort: [...defaultViewSort],
          columns: [...defaultViewColumns],
          version: 1,
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    };
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
        { path: "/views", element: <ViewManagementPage /> },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <TaskStoreProvider>
            <RouterProvider router={router} />
          </TaskStoreProvider>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Delete prototype" }),
    );

    const confirmation = screen.getByRole("dialog", { name: "Delete Tag" });
    expect(
      within(confirmation).queryByText("Prototype work"),
    ).not.toBeInTheDocument();
    expect(
      within(confirmation).queryByText("Combined work"),
    ).not.toBeInTheDocument();
    expect(
      within(confirmation).queryByText("Unrelated work"),
    ).not.toBeInTheDocument();
    expect(confirmation).not.toHaveTextContent("View conditions");
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );
    expect(
      screen.queryByRole("textbox", { name: "Rename prototype" }),
    ).not.toBeInTheDocument();

    await navigate(router, "/views");
    const combinedView = screen.getByRole("listitem", {
      name: "Combined work",
    });
    await user.click(
      within(combinedView).getByRole("button", { name: "Edit" }),
    );
    const combinedDialog = screen.getByRole("dialog", { name: "Edit View" });
    expect(
      within(combinedDialog).getByRole("combobox", { name: "Tags" }),
    ).toHaveValue("prototype, frontend");
    await user.click(
      within(combinedDialog).getByRole("button", { name: "Close" }),
    );

    const prototypeView = screen.getByRole("listitem", {
      name: "Prototype work",
    });
    await user.click(
      within(prototypeView).getByRole("button", { name: "Edit" }),
    );
    const allTasksDialog = screen.getByRole("dialog", { name: "Edit View" });
    expect(
      within(allTasksDialog).getByRole("checkbox", { name: "All Tasks" }),
    ).not.toBeChecked();
    expect(
      within(allTasksDialog).getByRole("combobox", { name: "Tags" }),
    ).toHaveValue("prototype");
  });

  it("deletes an empty Area and rejects an Area that still has Tasks", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Add Area" }));
    await user.click(screen.getByRole("button", { name: "Delete New Area" }));
    expect(screen.queryByDisplayValue("New Area")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Develop" }));
    const blockedDialog = screen.getByRole("dialog", {
      name: "Cannot move Area to Trash",
    });
    expect(blockedDialog).toHaveTextContent("Develop still has 7 Tasks.");
    expect(blockedDialog).toHaveTextContent(
      "Move every Task to another Area before sending this Area to Trash.",
    );
    expect(
      within(blockedDialog).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(blockedDialog).getByRole("button", { name: "Close" }),
    );
  });

  it("assigns a unique placeholder name to each added Area", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Add Area" }));
    await user.click(screen.getByRole("button", { name: "Add Area" }));

    expect(screen.getByDisplayValue("New Area")).toBeInTheDocument();
    expect(screen.getByDisplayValue("New Area 2")).toBeInTheDocument();
  });

  it("moves an empty Area to Trash and restores it", async () => {
    const user = userEvent.setup();
    const referencedArea = {
      id: Math.max(...testSnapshot.areas.map((area) => area.id)) + 1,
      name: "Referenced Area",
      color: "gray" as const,
      position:
        Math.max(...testSnapshot.areas.map((area) => area.position)) + 1,
      isSystemManaged: false,
      trashedAt: null,
    };
    const snapshot = {
      ...testSnapshot,
      areas: [...testSnapshot.areas, referencedArea],
      views: [
        {
          id: "view-area-reference",
          name: "Area reference View",
          allTasks: false,
          conditions: [
            {
              field: "area" as const,
              operator: "isAnyOf" as const,
              value: [referencedArea.name],
            },
          ],
          sort: [...defaultViewSort],
          columns: [...defaultViewColumns],
          version: 1,
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    };
    const restoredAreaTask = {
      ...(testSnapshot.tasks[0] as Task),
      id: "restored-area-result",
      title: "Restored Area result",
      areaId: referencedArea.id,
      path: [referencedArea.name, "Restored Area result"],
    };
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockResolvedValueOnce({ tasks: [], nextCursor: null })
      .mockResolvedValueOnce({ tasks: [restoredAreaTask], nextCursor: null });
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
        { path: "/trash", element: <TrashPage /> },
        { path: "/views", element: <ViewManagementPage /> },
        { path: "/views/:viewId", element: <ViewPage /> },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <TaskStoreProvider>
            <RouterProvider router={router} />
          </TaskStoreProvider>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Delete Referenced Area" }),
    );
    expect(
      screen.queryByDisplayValue("Referenced Area"),
    ).not.toBeInTheDocument();

    await navigate(router, "/views");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const viewDialog = screen.getByRole("dialog", { name: "Edit View" });
    expect(
      within(viewDialog).getByRole("combobox", { name: "Areas" }),
    ).toHaveValue("Referenced Area");
    await user.click(within(viewDialog).getByRole("button", { name: "Close" }));
    await navigate(router, "/views/view-area-reference");
    expect(await screen.findByText("No Tasks in this View.")).toBeVisible();

    await navigate(router, "/trash");
    await user.click(
      await screen.findByRole("button", { name: "Restore Referenced Area" }),
    );
    await navigate(router, "/settings");
    expect(
      await screen.findByDisplayValue("Referenced Area"),
    ).toBeInTheDocument();

    await navigate(router, "/views/view-area-reference");
    expect(
      await screen.findByRole("button", {
        name: "Edit Restored Area result",
      }),
    ).toBeVisible();
    loadViewTasks.mockRestore();
  });

  it("reports an Area delete failure, rolls back, and allows retry", async () => {
    const user = userEvent.setup();
    const temporaryArea = {
      id: 999,
      name: "Temporary Area",
      color: "gray" as const,
      position: 8,
      isSystemManaged: false,
      trashedAt: null,
    };
    const snapshot = {
      ...testSnapshot,
      areas: [...testSnapshot.areas, temporaryArea],
    };
    const savedSnapshot = {
      ...snapshot,
      areas: snapshot.areas.map((area) =>
        area.id === temporaryArea.id
          ? { ...area, trashedAt: "2026-08-24T00:00:00.000Z" }
          : area,
      ),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const trashArea = vi
      .spyOn(api, "trashArea")
      .mockRejectedValueOnce(new Error("raw delete response"))
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", {
          name: "Delete Temporary Area",
        }),
      );

      const message =
        "Could not move “Temporary Area” to Trash. Try again from Delete Area.";
      const notification = await screen.findByRole("region", {
        name: `Error notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw delete response");
      expect(
        await screen.findByDisplayValue("Temporary Area"),
      ).toBeInTheDocument();
      expect(trashArea).toHaveBeenCalledTimes(1);

      await user.click(
        screen.getByRole("button", { name: "Delete Temporary Area" }),
      );
      expect(trashArea).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByDisplayValue("Temporary Area"),
      ).not.toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      trashArea.mockRestore();
    }
  });

  it("explains a server-side Area task blocker and allows retry", async () => {
    const user = userEvent.setup();
    const temporaryArea = {
      id: 999,
      name: "Temporary Area",
      color: "gray" as const,
      position: 8,
      isSystemManaged: false,
      trashedAt: null,
    };
    const snapshot = {
      ...testSnapshot,
      areas: [...testSnapshot.areas, temporaryArea],
    };
    const savedSnapshot = {
      ...snapshot,
      areas: snapshot.areas.map((area) =>
        area.id === temporaryArea.id
          ? { ...area, trashedAt: "2026-08-24T00:00:00.000Z" }
          : area,
      ),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const trashArea = vi
      .spyOn(api, "trashArea")
      .mockRejectedValueOnce(
        new api.ApiRequestError(
          409,
          "raw area blocker response",
          "AREA_HAS_TASKS",
        ),
      )
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", {
          name: "Delete Temporary Area",
        }),
      );

      const message =
        "Could not move “Temporary Area” to Trash because it still has Tasks. Move every Task to another Area, then try again from Delete Area.";
      const notification = await screen.findByRole("region", {
        name: `Warning notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw area blocker response");
      expect(
        await screen.findByDisplayValue("Temporary Area"),
      ).toBeInTheDocument();
      expect(trashArea).toHaveBeenCalledTimes(1);

      await user.click(
        screen.getByRole("button", { name: "Delete Temporary Area" }),
      );
      expect(trashArea).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByDisplayValue("Temporary Area"),
      ).not.toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      trashArea.mockRestore();
    }
  });

  it("reports an Area restore failure, rolls back, and allows retry", async () => {
    const user = userEvent.setup();
    const restorableArea = {
      id: 999,
      name: "Restorable Area",
      color: "gray" as const,
      position: 8,
      isSystemManaged: false,
      trashedAt: "2026-08-24T00:00:00.000Z",
    };
    const snapshot = {
      ...testSnapshot,
      areas: [...testSnapshot.areas, restorableArea],
    };
    const restoredSnapshot = {
      ...snapshot,
      areas: snapshot.areas.map((area) =>
        area.id === restorableArea.id ? { ...area, trashedAt: null } : area,
      ),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const restoreArea = vi
      .spyOn(api, "restoreArea")
      .mockRejectedValueOnce(new Error("raw restore response"))
      .mockResolvedValueOnce(restoredSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/trash",
          loader: () => ({ status: "ready" }),
          element: <TrashPage />,
        },
      ],
      { initialEntries: ["/trash"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const restoreButton = await screen.findByRole("button", {
        name: "Restore Restorable Area",
      });
      await user.click(restoreButton);

      const message =
        "Could not restore “Restorable Area”. Try again from Trash.";
      const notification = await screen.findByRole("region", {
        name: `Error notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw restore response");
      expect(
        await screen.findByRole("button", {
          name: "Restore Restorable Area",
        }),
      ).toBeInTheDocument();
      expect(restoreArea).toHaveBeenCalledTimes(1);

      await user.click(
        screen.getByRole("button", { name: "Restore Restorable Area" }),
      );
      expect(restoreArea).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("button", { name: "Restore Restorable Area" }),
      ).not.toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      restoreArea.mockRestore();
    }
  });

  it("keeps a Tag draft after rename failure and allows retry from the field", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      tags: testSnapshot.tags.map((tag) =>
        tag.name === "prototype" ? { ...tag, name: "api" } : tag,
      ),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const renameTag = vi
      .spyOn(api, "renameTag")
      .mockRejectedValueOnce(new Error("raw rename response"))
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const tagName = await screen.findByRole("textbox", {
        name: "Rename prototype",
      });
      await user.clear(tagName);
      await user.type(tagName, "api");
      await user.tab();

      const message = "Could not rename “api”. Try again from the Tag field.";
      const notification = await screen.findByRole("region", {
        name: `Error notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw rename response");
      expect(screen.getByDisplayValue("api")).toBeInTheDocument();
      expect(renameTag).toHaveBeenCalledTimes(1);

      await user.click(screen.getByDisplayValue("api"));
      await user.tab();
      expect(renameTag).toHaveBeenCalledTimes(2);
      expect(
        await screen.findByRole("textbox", { name: "Rename api" }),
      ).toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      renameTag.mockRestore();
    }
  });

  it("reports a Tag delete failure, rolls back, and allows retry", async () => {
    const user = userEvent.setup();
    const savedSnapshot = {
      ...testSnapshot,
      tags: testSnapshot.tags.filter((tag) => tag.name !== "unused"),
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(testSnapshot);
    const deleteTag = vi
      .spyOn(api, "deleteTag")
      .mockRejectedValueOnce(new Error("raw tag delete response"))
      .mockResolvedValueOnce(savedSnapshot);
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", { name: "Delete unused" }),
      );
      await user.click(
        within(screen.getByRole("dialog", { name: "Delete Tag" })).getByRole(
          "button",
          { name: "Delete" },
        ),
      );

      const message = "Could not delete “unused”. Try again from Delete Tag.";
      const notification = await screen.findByRole("region", {
        name: `Error notification: ${message}`,
      });
      expect(notification).not.toHaveTextContent("raw tag delete response");
      expect(
        await screen.findByRole("textbox", { name: "Rename unused" }),
      ).toBeInTheDocument();
      expect(deleteTag).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Delete unused" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "Delete Tag" })).getByRole(
          "button",
          { name: "Delete" },
        ),
      );
      expect(deleteTag).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("textbox", { name: "Rename unused" }),
      ).not.toBeInTheDocument();
    } finally {
      loadBootstrap.mockRestore();
      deleteTag.mockRestore();
    }
  });

  it("localizes the Japanese Settings surface while keeping its page title fixed", async () => {
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
        { path: "/areas", element: <AreasPage /> },
      ],
      { initialEntries: ["/settings"] },
    );

    render(
      <AppSettingsProvider initialSnapshot={snapshot}>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    expect(document.documentElement).toHaveAttribute("lang", "ja");
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toHaveAttribute("lang", "en");
    expect(screen.getByText("設定")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Ownerのタイムゾーン" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "週の開始曜日" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "ゴミ箱の保持期間の日数" }),
    ).toBeInTheDocument();
    expect(screen.getByText("利用可能")).toBeInTheDocument();

    await navigate(router, "/areas");
    expect(
      await screen.findByRole("heading", { name: "Areas" }),
    ).toHaveAttribute("lang", "en");
    expect(screen.getByText("責任領域")).toBeInTheDocument();
    expect(screen.getByText("7件のタスク")).toBeInTheDocument();
    applyDisplayLanguage("en");
  });

  it("localizes Japanese organization controls without translating Owner data", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <AppSettingsProvider initialSnapshot={snapshot}>
          <TaskStoreProvider>
            <RouterProvider router={router} />
          </TaskStoreProvider>
        </AppSettingsProvider>,
      );

      const areaName = await screen.findByRole("textbox", {
        name: "Developの名前を変更",
      });
      expect(
        screen.getByRole("button", { name: "Developを上へ移動" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Developを下へ移動" }),
      ).toBeInTheDocument();
      const color = screen.getByRole("combobox", { name: "Developの色" });
      expect(color).toHaveValue("purple");
      expect(
        within(color).getByRole("option", { name: "紫" }),
      ).toBeInTheDocument();
      const weekStartsOn = screen.getByRole("combobox", {
        name: "週の開始曜日",
      });
      expect(
        within(weekStartsOn).getByRole("option", { name: "月曜日" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "エリアを追加" }));
      expect(screen.getByDisplayValue("New Area")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "New Areaを削除" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "New Areaを削除" }));
      expect(screen.queryByDisplayValue("New Area")).not.toBeInTheDocument();

      await user.clear(areaName);
      await user.tab();
      expect(
        await screen.findByText("エリア名を入力してください"),
      ).toBeInTheDocument();
      await user.clear(areaName);
      await user.type(areaName, "Develop");
      await user.tab();
      await waitFor(() => {
        expect(
          screen.queryByText("エリア名を入力してください"),
        ).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Developを削除" }));
      const areaDialog = screen.getByRole("dialog", {
        name: "エリアをゴミ箱に移せません",
      });
      expect(areaDialog).toHaveTextContent(
        "「Develop」には7件のタスクが残っています。",
      );
      expect(areaDialog).toHaveTextContent(
        "このエリアをゴミ箱に移す前に、すべてのタスクを別のエリアへ移してください。",
      );
      await user.click(
        within(areaDialog).getByRole("button", { name: "閉じる" }),
      );

      await user.click(screen.getByRole("button", { name: "prototypeを削除" }));
      const tagDialog = screen.getByRole("dialog", { name: "タグを削除" });
      expect(tagDialog).toHaveTextContent(
        "「prototype」を削除しますか？このタグは関連するタスクからも削除されます。",
      );
      await user.click(
        within(tagDialog).getByRole("button", { name: "キャンセル" }),
      );
    } finally {
      applyDisplayLanguage("en");
    }
  });

  it("localizes the unavailable health status in Japanese", async () => {
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "unavailable" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <AppSettingsProvider initialSnapshot={snapshot}>
          <TaskStoreProvider>
            <RouterProvider router={router} />
          </TaskStoreProvider>
        </AppSettingsProvider>,
      );

      expect(
        await screen.findByRole("status", {
          name: "ヘルス状態：利用できません",
        }),
      ).toHaveTextContent("利用できません");
    } finally {
      applyDisplayLanguage("en");
    }
  });

  it("localizes Japanese organization failure notifications", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const createArea = vi
      .spyOn(api, "createArea")
      .mockRejectedValue(new Error("raw create response"));
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => ({ status: "ready" }),
          element: <SettingsPage />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", { name: "エリアを追加" }),
      );
      const notification = await screen.findByRole("complementary", {
        name: "通知",
      });
      expect(notification).toHaveTextContent(
        "「New Area」を作成できませんでした。エリアの追加からもう一度お試しください。",
      );
      expect(notification).not.toHaveTextContent("raw create response");
      expect(createArea).toHaveBeenCalledTimes(1);
    } finally {
      loadBootstrap.mockRestore();
      createArea.mockRestore();
      applyDisplayLanguage("en");
    }
  });
});

describe("InboxPage", () => {
  it("uses the system-managed Inbox Area reference", () => {
    render(
      <BootstrapProvider initialSnapshot={testSnapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Edit 歯科検診を予約する" }),
    ).toBeInTheDocument();
  });

  it("uses the shared two-line Task row layout in Inbox", () => {
    render(
      <BootstrapProvider initialSnapshot={testSnapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    const row = screen
      .getByRole("button", { name: "Edit 歯科検診を予約する" })
      .closest("article") as HTMLElement;
    expect(row).toHaveClass("min-h-[60px]");
    expect(row.querySelector('[data-slot="task-tree-content"]')).not.toBeNull();
    expect(row.querySelector('[data-slot="task-tree-path"]')).toHaveTextContent(
      "Inbox",
    );
    expect(
      within(row).getByRole("button", {
        name: "Reorder 歯科検診を予約する",
      }),
    ).toHaveStyle({
      width: "28px",
      height: "44px",
      minWidth: "28px",
      minHeight: "44px",
    });
    expect(
      within(row).getByRole("button", {
        name: "Complete 歯科検診を予約する",
      }),
    ).toHaveStyle({
      width: "30px",
      height: "44px",
      minWidth: "30px",
      minHeight: "44px",
    });
    expect(
      within(row).getByRole("button", {
        name: "歯科検診を予約する actions",
      }),
    ).toHaveStyle({
      width: "30px",
      height: "44px",
      minWidth: "30px",
      minHeight: "44px",
    });
  });

  it("expands a newly-parented Inbox Task after Add Subtask succeeds", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        { path: "/inbox", element: <InboxPage /> },
        { path: "/task-mutations", action: taskMutationTestAction },
      ],
      { initialEntries: ["/inbox"] },
    );

    render(
      <AppSettingsProvider initialSnapshot={testSnapshot}>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    const parentRow = screen
      .getByRole("button", { name: "Edit 歯科検診を予約する" })
      .closest("article") as HTMLElement;
    await user.click(
      within(parentRow).getByRole("button", {
        name: "歯科検診を予約する actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Add Subtask" }));
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Created Inbox child",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByRole("treeitem", { name: "Created Inbox child" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse 歯科検診を予約する" }),
    ).toBeInTheDocument();
  });

  it("uses the shared two-line row contract for controls, progress, and details", async () => {
    const user = userEvent.setup();
    const parent = scheduledTask({
      id: "inbox-compact-parent",
      title: "A very long Inbox Task title that should stay inside the row",
      path: [
        "Inbox",
        "A very long Inbox Task title that should stay inside the row",
      ],
      areaId: testAreaIds.inbox,
      due: "2026-08-31",
      tags: [{ id: 2, name: "backend" }],
      description: "compact row description",
      workNotes: "private work note",
    });
    const directOpen = scheduledTask({
      id: "inbox-compact-direct-open",
      title: "Direct open child",
      path: ["Inbox", parent.title, "Direct open child"],
      areaId: testAreaIds.inbox,
      parentId: parent.id,
      due: "2026-08-01",
    });
    const directCompleted = scheduledTask({
      id: "inbox-compact-direct-completed",
      title: "Direct completed child",
      path: ["Inbox", parent.title, "Direct completed child"],
      areaId: testAreaIds.inbox,
      parentId: parent.id,
      status: "COMPLETED",
      completedAt: "2026-08-20T00:00:00.000Z",
    });
    const directRecurring = scheduledTask({
      id: "inbox-compact-direct-recurring",
      title: "Direct recurring child",
      path: ["Inbox", parent.title, "Direct recurring child"],
      areaId: testAreaIds.inbox,
      parentId: parent.id,
      recurrenceRule: "week",
    });
    const hiddenGrandchild = scheduledTask({
      id: "inbox-compact-grandchild",
      title: "Hidden grandchild",
      path: ["Inbox", parent.title, directOpen.title, "Hidden grandchild"],
      areaId: testAreaIds.inbox,
      parentId: directOpen.id,
      status: "COMPLETED",
      completedAt: "2026-08-21T00:00:00.000Z",
    });
    const recurringTask = scheduledTask({
      id: "inbox-compact-recurring",
      title: "Recurring root",
      path: ["Inbox", "Recurring root"],
      areaId: testAreaIds.inbox,
      recurrenceRule: "day",
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [
        parent,
        directOpen,
        directCompleted,
        directRecurring,
        hiddenGrandchild,
        recurringTask,
      ],
      inboxOrder: [parent.id, recurringTask.id],
      areaTaskOrders: {
        [`parent:${parent.id}`]: [
          directOpen.id,
          directCompleted.id,
          directRecurring.id,
        ],
        [`parent:${directOpen.id}`]: [hiddenGrandchild.id],
      },
    };

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    const tree = await screen.findByRole("tree", { name: "Inbox Task tree" });
    expect(tree).toHaveClass("border", "border-slate-200");
    const parentItem = within(tree).getByRole("treeitem", {
      name: parent.title,
    });
    const parentRow = parentItem.querySelector(
      '[data-slot="task-tree-row"]',
    ) as HTMLElement;
    expect(parentRow).not.toBeNull();
    const slot = (name: string) =>
      parentRow.querySelector(`[data-slot="${name}"]`) as HTMLElement;
    const dragHandle = slot("task-tree-drag-handle");
    const depthIndent = slot("task-tree-depth-indent");
    const chevron = slot("task-tree-chevron");
    const status = slot("task-tree-status-control");
    const title = slot("task-tree-title");
    const progress = slot("task-tree-progress");
    const contextMenu = slot("task-tree-context-menu");
    const metadataRow = slot("task-tree-meta-row");
    const dates = slot("task-tree-dates");
    const path = slot("task-tree-path");

    expect(parentRow).toHaveStyle({ minHeight: "60px" });
    expect(parentRow).not.toHaveClass("border-l-[3px]");
    expect(dragHandle).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "28px",
    });
    expect(dragHandle.querySelector("svg")).toHaveAttribute("width", "18");
    expect(dragHandle.querySelector("svg")).toHaveAttribute("height", "22");
    expect(depthIndent).toHaveStyle({ width: "0px" });
    expect(chevron).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "24px",
    });
    expect(chevron.querySelector("svg")).toHaveAttribute("width", "16");
    expect(status).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "30px",
    });
    expect(status.querySelector("span")).toHaveClass("size-[18px]");
    expect(contextMenu).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "30px",
    });
    expect(contextMenu.querySelector("svg")).toHaveAttribute("width", "18");
    expect(title).toHaveClass("font-normal", "text-[15px]", "leading-5");
    expect(title).toHaveStyle({
      fontSize: "15px",
      lineHeight: "20px",
      fontWeight: 400,
    });
    expect(progress).toHaveStyle({ fontSize: "12px", lineHeight: "16px" });
    expect(metadataRow).toHaveClass("flex-wrap");
    expect(path).toHaveClass("ml-auto", "truncate", "shrink-0");
    expect(path).toHaveStyle({ direction: "rtl" });
    expect(dates.querySelector('[data-slot="task-tree-calendar"]')).toHaveClass(
      "text-[#b05a48]",
    );
    expect(dates.querySelector('[data-slot="task-tree-due"]')).toHaveClass(
      "text-[#b05a48]",
    );
    expect(title).not.toHaveClass("text-[#b05a48]");
    expect(path).not.toHaveClass("text-[#b05a48]");
    const tooltipId = title.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId ?? "")).toHaveStyle({
      fontSize: "13px",
      position: "fixed",
    });
    expect(
      dragHandle.compareDocumentPosition(depthIndent) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      depthIndent.compareDocumentPosition(chevron) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      chevron.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      status.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(progress) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      progress.compareDocumentPosition(contextMenu) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(title).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    expect(
      parentRow.querySelector('[data-slot="task-tree-path"]'),
    ).toHaveTextContent("Inbox");
    expect(parentRow.querySelector("time")).toBeNull();
    expect(parentRow).toHaveTextContent("1/2");
    expect(parentRow).toHaveTextContent("↻1");
    expect(
      within(parentRow).getByRole("img", {
        name: "1 Open Recurring Subtasks",
      }),
    ).toBeInTheDocument();

    const childItem = within(tree).getByRole("treeitem", {
      name: directOpen.title,
    });
    const childIndent = childItem.querySelector(
      '[data-slot="task-tree-depth-indent"]',
    );
    expect(childIndent).toHaveStyle({ width: "16px" });
    expect(
      within(childItem).getByRole("button", {
        name: `Edit ${directOpen.title}`,
      }),
    ).toHaveClass("text-slate-900");

    const tooltip = document.getElementById(tooltipId ?? "") as HTMLElement;
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
    expect(tooltip).toHaveClass("fixed", "overflow-y-auto");
    expect(tooltip).toHaveAttribute("data-placement", "bottom-start");
    expect(tooltip).not.toHaveClass("right-0", "left-1/2");
    await user.hover(title);
    expect(tooltip).toHaveAttribute("aria-hidden", "false");
    expect(tooltip).toHaveTextContent(parent.title);
    expect(tooltip).toHaveTextContent("Due");
    expect(tooltip).toHaveTextContent("2026/8/31");
    expect(tooltip).toHaveTextContent("backend");
    expect(tooltip).toHaveTextContent(parent.description);
    expect(tooltip).toHaveTextContent(parent.workNotes);

    await user.unhover(title);
    await user.click(screen.getByRole("checkbox", { name: "Show Completed" }));
    const completedRow = within(tree)
      .getByRole("treeitem", { name: directCompleted.title })
      .querySelector('[data-slot="task-tree-row"]') as HTMLElement;
    expect(
      completedRow.querySelector('[data-slot="task-tree-title"]'),
    ).toHaveClass("text-slate-400", "line-through");
    expect(
      completedRow.querySelector('[data-slot="task-tree-metadata"]'),
    ).toHaveClass("text-slate-300");
    expect(
      completedRow.querySelector('[data-slot="task-tree-path"]'),
    ).toHaveClass("text-slate-300");

    const recurringRow = within(tree)
      .getByRole("treeitem", { name: recurringTask.title })
      .querySelector('[data-slot="task-tree-row"]') as HTMLElement;
    const recurringIcon = within(recurringRow).getByRole("img", {
      name: "Recurring Task",
    });
    expect(recurringIcon).toBeInTheDocument();
    expect(
      recurringRow.querySelector('[data-slot="task-tree-recurring"]'),
    ).toBe(recurringIcon);
  });

  it("renders Inbox Tasks as a flat ARIA tree with Headless Tree metadata", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      tasks: [
        ...testSnapshot.tasks,
        {
          id: "inbox-child",
          title: "Inbox child",
          path: ["Inbox", "歯科検診を予約する", "Inbox child"],
          areaId: testAreaIds.inbox,
          parentId: "inbox-1",
          status: "OPEN" as const,
          start: null,
          due: null,
          completedAt: null,
          updatedAt: "2026-08-05T00:00:00.000Z",
          tags: [],
          description: "",
          workNotes: "",
        },
      ],
    };

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    const tree = await screen.findByRole("tree", { name: "Inbox Task tree" });
    const items = within(tree).getAllByRole("treeitem");
    expect(tree).not.toHaveTextContent("focused item");
    expect(tree).not.toHaveTextContent("selected items");
    const parent = within(tree).getByRole("treeitem", {
      name: "歯科検診を予約する",
    });
    const leaf = within(tree).getByRole("treeitem", {
      name: "読書メモからTaskを切り出す",
    });
    const child = within(tree).getByRole("treeitem", {
      name: "Inbox child",
    });
    const parentHandle = within(parent).getByRole("button", {
      name: "Reorder 歯科検診を予約する",
    });

    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
      "歯科検診を予約する",
      "Inbox child",
      "読書メモからTaskを切り出す",
    ]);
    expect(parent).toHaveAttribute("aria-level", "1");
    expect(parent).toHaveAttribute("aria-posinset", "1");
    expect(parent).toHaveAttribute("aria-setsize", "2");
    expect(child).toHaveAttribute("aria-level", "2");
    expect(child).toHaveAttribute("aria-posinset", "1");
    expect(child).toHaveAttribute("aria-setsize", "1");
    expect(
      items.filter((item) => item.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
    expect(within(tree).queryAllByRole("list")).toHaveLength(0);

    expect(
      within(parent).getByRole("button", {
        name: "Collapse 歯科検診を予約する",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    const leafPlaceholder = leaf.querySelector(
      '[data-slot="task-tree-chevron-placeholder"]',
    );
    expect(leafPlaceholder).toBeInTheDocument();
    expect(leafPlaceholder).toHaveAttribute("aria-hidden", "true");
    expect(leafPlaceholder).not.toHaveAttribute("aria-label");
    expect(
      within(leaf).queryByRole("button", { name: /折り畳む|展開する/ }),
    ).not.toBeInTheDocument();
    expect(parentHandle).toHaveAttribute("draggable", "true");
    expect(parentHandle).toHaveAttribute("tabindex", "-1");
    expect(
      within(leaf).getByRole("button", {
        name: "Reorder 読書メモからTaskを切り出す",
      }),
    ).toBeInTheDocument();
    expect(
      within(child).getByRole("button", { name: "Reorder Inbox child" }),
    ).toBeInTheDocument();

    await user.click(
      within(parent).getByRole("button", {
        name: "Collapse 歯科検診を予約する",
      }),
    );
    expect(
      within(parent).getByRole("button", {
        name: "Expand 歯科検診を予約する",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(parent).queryByRole("listitem", { name: "Inbox child" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(parent).getByRole("button", {
        name: "Expand 歯科検診を予約する",
      }),
    );
    expect(
      within(parent).getByRole("button", {
        name: "Collapse 歯科検診を予約する",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(tree).getByRole("treeitem", { name: "Inbox child" }),
    ).toBeInTheDocument();
  });

  it("moves focus with tree keyboard navigation and opens the focused Task with Enter", async () => {
    const snapshot = {
      ...testSnapshot,
      tasks: [
        ...testSnapshot.tasks,
        {
          id: "inbox-child",
          title: "Inbox child",
          path: ["Inbox", "歯科検診を予約する", "Inbox child"],
          areaId: testAreaIds.inbox,
          parentId: "inbox-1",
          status: "OPEN" as const,
          start: null,
          due: null,
          completedAt: null,
          updatedAt: "2026-08-05T00:00:00.000Z",
          tags: [],
          description: "",
          workNotes: "",
        },
      ],
    };
    const router = createMemoryRouter(
      [
        {
          path: "/",
          children: [{ index: true, element: <InboxPage /> }],
        },
        { path: "/task-mutations", action: taskMutationTestAction },
      ],
      { initialEntries: ["/"] },
    );

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <TaskStoreProvider>
            <RouterProvider router={router} />
          </TaskStoreProvider>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    const tree = await screen.findByRole("tree", { name: "Inbox Task tree" });
    const press = async (item: HTMLElement, code: string, key = code) => {
      fireEvent.keyDown(item, { code, key });
      fireEvent.keyUp(document, { code, key });
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    const parent = within(tree).getByRole("treeitem", {
      name: "歯科検診を予約する",
    });
    parent.focus();

    await press(parent, "ArrowLeft");
    expect(parent).toHaveAttribute("aria-expanded", "false");
    expect(
      within(tree).queryByRole("treeitem", { name: "Inbox child" }),
    ).not.toBeInTheDocument();

    await press(parent, "ArrowRight");
    expect(parent).toHaveAttribute("aria-expanded", "true");
    await press(parent, "ArrowRight");
    const child = within(tree).getByRole("treeitem", { name: "Inbox child" });
    expect(child).toHaveFocus();
    await press(child, "ArrowDown");
    expect(
      within(tree).getByRole("treeitem", {
        name: "読書メモからTaskを切り出す",
      }),
    ).toHaveFocus();

    const leaf = within(tree).getByRole("treeitem", {
      name: "読書メモからTaskを切り出す",
    });
    await press(leaf, "Home");
    expect(parent).toHaveFocus();
    await press(parent, "End");
    expect(leaf).toHaveFocus();
    await press(leaf, "Home");
    expect(parent).toHaveFocus();
    await press(parent, "Enter");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "歯科検診を予約する",
    );
  });

  it("preserves hidden Completed sibling order when visible Inbox Tasks are reordered", async () => {
    const user = userEvent.setup();
    const first = scheduledTask({
      id: "inbox-visible-first",
      title: "Inbox visible first",
      path: ["Inbox", "Inbox visible first"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const completed = scheduledTask({
      id: "inbox-completed-middle",
      title: "Inbox completed middle",
      path: ["Inbox", "Inbox completed middle"],
      areaId: testAreaIds.inbox,
      status: "COMPLETED",
      completedAt: "2026-08-05T00:00:00.000Z",
      start: null,
    });
    const second = scheduledTask({
      id: "inbox-visible-second",
      title: "Inbox visible second",
      path: ["Inbox", "Inbox visible second"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [first, completed, second],
      inboxOrder: [first.id, completed.id, second.id],
    };
    const reorderedSnapshot = {
      ...snapshot,
      inboxOrder: [second.id, completed.id, first.id],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockResolvedValue(reorderedSnapshot);

    try {
      const rendered = render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/inbox"]}>
              <TaskStoreProvider>
                <InboxPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const tree = await screen.findByRole("tree", {
        name: "Inbox Task tree",
      });
      const visibleTitles = () =>
        within(tree)
          .getAllByRole("treeitem")
          .map((item) => item.getAttribute("aria-label"));
      expect(visibleTitles()).toEqual([
        "Inbox visible first",
        "Inbox visible second",
      ]);

      const focusedItem = within(tree).getByRole("treeitem", {
        name: "Inbox visible first",
      });
      focusedItem.focus();
      fireEvent.keyDown(focusedItem, { code: "Space", key: " " });
      fireEvent.keyDown(focusedItem, { code: "ArrowDown", key: "ArrowDown" });
      fireEvent.keyDown(focusedItem, { code: "Escape", key: "Escape" });
      expect(moveTask).not.toHaveBeenCalled();
      expect(visibleTitles()).toEqual([
        "Inbox visible first",
        "Inbox visible second",
      ]);

      const dataTransfer = {
        dropEffect: "none",
        effectAllowed: "all",
      } as DataTransfer;
      const firstHandle = within(focusedItem).getByRole("button", {
        name: `Reorder ${first.title}`,
      });
      const secondItem = within(tree).getByRole("treeitem", {
        name: second.title,
      });
      fireEvent.dragStart(firstHandle, { dataTransfer });
      fireEvent.dragLeave(focusedItem, { dataTransfer });
      dispatchDragEvent(secondItem, "dragover", dataTransfer, 59);
      dispatchDragEvent(secondItem, "drop", dataTransfer, 59);
      fireEvent.dragEnd(firstHandle, { dataTransfer });
      await waitFor(() =>
        expect(moveTask).toHaveBeenCalledWith(
          moveRequest(first, second, "after"),
        ),
      );
      await waitFor(() =>
        expect(visibleTitles()).toEqual([
          "Inbox visible second",
          "Inbox visible first",
        ]),
      );

      await user.click(
        screen.getByRole("checkbox", { name: "Show Completed" }),
      );
      await screen.findByRole("treeitem", { name: "Inbox completed middle" });
      expect(visibleTitles()).toEqual([
        "Inbox visible second",
        "Inbox completed middle",
        "Inbox visible first",
      ]);

      rendered.unmount();
      loadBootstrap.mockResolvedValue(reorderedSnapshot);
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/inbox"]}>
              <TaskStoreProvider>
                <InboxPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );
      const reloadedTree = await screen.findByRole("tree", {
        name: "Inbox Task tree",
      });
      expect(
        within(reloadedTree)
          .getAllByRole("treeitem")
          .map((item) => item.getAttribute("aria-label")),
      ).toEqual(["Inbox visible second", "Inbox visible first"]);
      await user.click(
        screen.getByRole("checkbox", { name: "Show Completed" }),
      );
      expect(
        within(reloadedTree)
          .getAllByRole("treeitem")
          .map((item) => item.getAttribute("aria-label")),
      ).toEqual([
        "Inbox visible second",
        "Inbox completed middle",
        "Inbox visible first",
      ]);
    } finally {
      moveTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("keeps a visible child in its stored parent group when its parent is hidden", async () => {
    const hiddenParent = scheduledTask({
      id: "inbox-hidden-parent",
      title: "Inbox hidden parent",
      path: ["Inbox", "Inbox hidden parent"],
      areaId: testAreaIds.inbox,
      status: "COMPLETED",
      completedAt: "2026-08-05T00:00:00.000Z",
      start: null,
    });
    const child = scheduledTask({
      id: "inbox-visible-child",
      title: "Inbox visible child",
      path: ["Inbox", "Inbox hidden parent", "Inbox visible child"],
      areaId: testAreaIds.inbox,
      parentId: hiddenParent.id,
      start: null,
    });
    const first = scheduledTask({
      id: "inbox-root-first",
      title: "Inbox root first",
      path: ["Inbox", "Inbox root first"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const second = scheduledTask({
      id: "inbox-root-second",
      title: "Inbox root second",
      path: ["Inbox", "Inbox root second"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [hiddenParent, child, first, second],
      inboxOrder: [first.id, hiddenParent.id, second.id],
      areaTaskOrders: { [`parent:${hiddenParent.id}`]: [child.id] },
    };
    const reorderedSnapshot = {
      ...snapshot,
      inboxOrder: [second.id, hiddenParent.id, first.id],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockResolvedValue(reorderedSnapshot);

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/inbox"]}>
              <TaskStoreProvider>
                <InboxPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const tree = await screen.findByRole("tree", {
        name: "Inbox Task tree",
      });
      expect(
        within(tree)
          .getAllByRole("treeitem")
          .map((item) => item.getAttribute("aria-label")),
      ).toEqual([
        "Inbox root first",
        "Inbox root second",
        "Inbox visible child",
      ]);

      const item = within(tree).getByRole("treeitem", {
        name: "Inbox root first",
      });
      const secondItem = within(tree).getByRole("treeitem", {
        name: "Inbox root second",
      });
      const dataTransfer = {
        dropEffect: "none",
        effectAllowed: "all",
      } as DataTransfer;
      const sourceHandle = within(item).getByRole("button", {
        name: `Reorder ${first.title}`,
      });
      fireEvent.dragStart(sourceHandle, { dataTransfer });
      fireEvent.dragLeave(item, { dataTransfer });
      dispatchDragEvent(secondItem, "dragover", dataTransfer, 59);
      dispatchDragEvent(secondItem, "drop", dataTransfer, 59);
      fireEvent.dragEnd(sourceHandle, { dataTransfer });

      await waitFor(() =>
        expect(moveTask).toHaveBeenCalledWith(
          moveRequest(first, second, "after"),
        ),
      );
      expect(
        within(tree)
          .getAllByRole("treeitem")
          .map((treeItem) => treeItem.getAttribute("aria-label")),
      ).toEqual([
        "Inbox root second",
        "Inbox root first",
        "Inbox visible child",
      ]);
    } finally {
      moveTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("reorders Inbox Tasks through a pointer drag handle without leaving a focus ring", async () => {
    const user = userEvent.setup();
    const first = scheduledTask({
      id: "inbox-pointer-first",
      title: "Inbox pointer first",
      path: ["Inbox", "Inbox pointer first"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const second = scheduledTask({
      id: "inbox-pointer-second",
      title: "Inbox pointer second",
      path: ["Inbox", "Inbox pointer second"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [first, second],
      inboxOrder: [first.id, second.id],
    };
    const reorderedSnapshot = {
      ...snapshot,
      inboxOrder: [second.id, first.id],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockResolvedValue(reorderedSnapshot);
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
    } as DataTransfer;

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/inbox"]}>
              <TaskStoreProvider>
                <InboxPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const tree = await screen.findByRole("tree", {
        name: "Inbox Task tree",
      });
      const firstItem = within(tree).getByRole("treeitem", {
        name: first.title,
      });
      const secondItem = within(tree).getByRole("treeitem", {
        name: second.title,
      });
      const firstHandle = within(firstItem).getByRole("button", {
        name: `Reorder ${first.title}`,
      });

      await user.click(firstHandle);
      fireEvent.dragStart(firstHandle, { dataTransfer });
      fireEvent.dragLeave(firstItem, { dataTransfer });
      dispatchDragEvent(secondItem, "dragover", dataTransfer, 1);

      const dropIndicator = tree.querySelector<HTMLElement>(
        '[data-slot="task-tree-drop-indicator"]',
      );
      expect(dropIndicator).not.toBeNull();
      await waitFor(() => {
        expect(dropIndicator).toHaveAttribute("aria-hidden", "true");
        expect(dropIndicator).toHaveStyle({ position: "absolute" });
        expect(dropIndicator).not.toHaveStyle({ display: "none" });
      });

      dispatchDragEvent(secondItem, "drop", dataTransfer, 1);
      fireEvent.dragEnd(firstHandle, { dataTransfer });

      await waitFor(() =>
        expect(moveTask).toHaveBeenCalledWith(
          moveRequest(first, second, "before"),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      const focusedItem = within(tree).getByRole("treeitem", {
        name: first.title,
      });
      expect(document.activeElement).toBe(focusedItem);
      expect(focusedItem).toHaveAttribute(
        "data-drag-focus-ring-suppressed",
        "true",
      );
      await user.keyboard(" ");
      expect(focusedItem).not.toHaveAttribute(
        "data-drag-focus-ring-suppressed",
      );
      focusedItem.blur();
      expect(focusedItem).not.toHaveAttribute(
        "data-drag-focus-ring-suppressed",
      );
    } finally {
      moveTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("reorders Subtask siblings and reparents within the same Area", async () => {
    const firstParent = scheduledTask({
      id: "inbox-pointer-parent-one",
      title: "Inbox pointer parent one",
      path: ["Inbox", "Inbox pointer parent one"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const secondParent = scheduledTask({
      id: "inbox-pointer-parent-two",
      title: "Inbox pointer parent two",
      path: ["Inbox", "Inbox pointer parent two"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const firstChild = scheduledTask({
      id: "inbox-pointer-child-one",
      title: "Inbox pointer child one",
      path: ["Inbox", "Inbox pointer parent one", "Inbox pointer child one"],
      areaId: testAreaIds.inbox,
      parentId: firstParent.id,
      start: null,
    });
    const secondChild = scheduledTask({
      id: "inbox-pointer-child-two",
      title: "Inbox pointer child two",
      path: ["Inbox", "Inbox pointer parent one", "Inbox pointer child two"],
      areaId: testAreaIds.inbox,
      parentId: firstParent.id,
      start: null,
    });
    const otherChild = scheduledTask({
      id: "inbox-pointer-other-child",
      title: "Inbox pointer other child",
      path: ["Inbox", "Inbox pointer parent two", "Inbox pointer other child"],
      areaId: testAreaIds.inbox,
      parentId: secondParent.id,
      start: null,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [firstParent, secondParent, firstChild, secondChild, otherChild],
      inboxOrder: [firstParent.id, secondParent.id],
      areaTaskOrders: {
        [`parent:${firstParent.id}`]: [firstChild.id, secondChild.id],
        [`parent:${secondParent.id}`]: [otherChild.id],
      },
    };
    const reorderedSnapshot = {
      ...snapshot,
      areaTaskOrders: {
        ...snapshot.areaTaskOrders,
        [`parent:${firstParent.id}`]: [secondChild.id, firstChild.id],
      },
    };
    const reparentedSnapshot = {
      ...reorderedSnapshot,
      tasks: reorderedSnapshot.tasks.map((task) =>
        task.id === firstChild.id
          ? {
              ...task,
              parentId: secondParent.id,
              path: ["Inbox", secondParent.title, firstChild.title],
              version: (task.version ?? 1) + 1,
            }
          : task,
      ),
      areaTaskOrders: {
        ...reorderedSnapshot.areaTaskOrders,
        [`parent:${firstParent.id}`]: [secondChild.id],
        [`parent:${secondParent.id}`]: [firstChild.id, otherChild.id],
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockResolvedValueOnce(reorderedSnapshot)
      .mockResolvedValueOnce(reparentedSnapshot);
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
    } as DataTransfer;

    const dragHandleTo = async (
      sourceTitle: string,
      targetTitle: string,
      clientY = 59,
    ) => {
      const tree = await screen.findByRole("tree", {
        name: "Inbox Task tree",
      });
      const sourceItem = within(tree).getByRole("treeitem", {
        name: sourceTitle,
      });
      const targetItem = within(tree).getByRole("treeitem", {
        name: targetTitle,
      });
      const sourceHandle = within(sourceItem).getByRole("button", {
        name: `Reorder ${sourceTitle}`,
      });
      fireEvent.dragStart(sourceHandle, { dataTransfer });
      dispatchDragEvent(targetItem, "dragover", dataTransfer, clientY);
      dispatchDragEvent(targetItem, "drop", dataTransfer, clientY);
    };

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/inbox"]}>
              <TaskStoreProvider>
                <InboxPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await dragHandleTo(firstChild.title, secondChild.title);
      await waitFor(() =>
        expect(moveTask).toHaveBeenNthCalledWith(
          1,
          moveRequest(firstChild, secondChild, "after"),
        ),
      );

      await dragHandleTo(firstChild.title, otherChild.title, 1);
      await waitFor(() =>
        expect(moveTask).toHaveBeenNthCalledWith(
          2,
          moveRequest(firstChild, otherChild, "before"),
        ),
      );
      expect(
        within(screen.getByRole("tree", { name: "Inbox Task tree" }))
          .getAllByRole("treeitem")
          .map((item) => item.getAttribute("aria-label")),
      ).toEqual([
        firstParent.title,
        secondChild.title,
        secondParent.title,
        firstChild.title,
        otherChild.title,
      ]);
    } finally {
      moveTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("shows the as-last-child target state when dropping onto a parent", async () => {
    const source = scheduledTask({
      id: "inbox-drop-child-source",
      title: "Inbox drop child source",
      path: ["Inbox", "Inbox drop child source"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const parent = scheduledTask({
      id: "inbox-drop-child-parent",
      title: "Inbox drop child parent",
      path: ["Inbox", "Inbox drop child parent"],
      areaId: testAreaIds.inbox,
      start: null,
    });
    const existingChild = scheduledTask({
      id: "inbox-drop-child-existing",
      title: "Inbox drop child existing",
      path: ["Inbox", "Inbox drop child parent", "Inbox drop child existing"],
      areaId: testAreaIds.inbox,
      parentId: parent.id,
      start: null,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [source, parent, existingChild],
      inboxOrder: [source.id, parent.id],
      areaTaskOrders: {
        [`parent:${parent.id}`]: [existingChild.id],
      },
    };
    const movedSource = {
      ...source,
      parentId: parent.id,
      path: [...parent.path, source.title],
      version: (source.version ?? 1) + 1,
    };
    const movedSnapshot = {
      ...snapshot,
      tasks: [movedSource, parent, existingChild],
      inboxOrder: [parent.id],
      areaTaskOrders: {
        [`parent:${parent.id}`]: [existingChild.id, source.id],
      },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const moveTask = vi.spyOn(api, "moveTask").mockResolvedValue(movedSnapshot);
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
    } as DataTransfer;

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/inbox"]}>
              <TaskStoreProvider>
                <InboxPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      const tree = await screen.findByRole("tree", {
        name: "Inbox Task tree",
      });
      const parentItem = within(tree).getByRole("treeitem", {
        name: parent.title,
      });
      const sourceItem = within(tree).getByRole("treeitem", {
        name: source.title,
      });
      const existingChildItem = within(tree).getByRole("treeitem", {
        name: existingChild.title,
      });
      const sourceHandle = within(sourceItem).getByRole("button", {
        name: `Reorder ${source.title}`,
      });
      const setRect = (element: HTMLElement, top: number, bottom: number) => {
        Object.defineProperty(element, "getBoundingClientRect", {
          configurable: true,
          value: () =>
            ({
              bottom,
              height: bottom - top,
              left: 0,
              right: 400,
              top,
              width: 400,
              x: 0,
              y: top,
            }) as DOMRect,
        });
      };
      setRect(tree, 100, 220);
      setRect(sourceItem, 100, 140);
      setRect(parentItem, 140, 180);
      setRect(existingChildItem, 180, 220);

      fireEvent.dragStart(sourceHandle, { dataTransfer });
      dispatchDragEvent(parentItem, "dragover", dataTransfer, 160);

      const dropIndicator = tree.querySelector<HTMLElement>(
        '[data-slot="task-tree-drop-indicator"]',
      );
      expect(dropIndicator).not.toBeNull();
      await waitFor(() => {
        expect(dropIndicator).toHaveStyle({ display: "none" });
        expect(parentItem).toHaveAttribute(
          "data-drop-position",
          "as-last-child",
        );
        expect(parentItem).toHaveClass("outline-sky-400");
      });

      dispatchDragEvent(parentItem, "drop", dataTransfer, 160);
      await waitFor(() =>
        expect(moveTask).toHaveBeenCalledWith({
          ...moveRequest(source, parent, "as-last-child"),
          anchorTaskId: existingChild.id,
          anchorTaskVersion: existingChild.version ?? 1,
          anchorPosition: "after",
        }),
      );
      expect(parentItem).toHaveAttribute("aria-expanded", "true");
      expect(
        within(tree).getByRole("treeitem", { name: source.title }),
      ).toHaveAttribute("aria-level", "2");
    } finally {
      moveTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("reports an Inbox Manual Order failure, rolls back, and allows retry by dragging again", async () => {
    const first = scheduledTask({
      id: "inbox-order-first",
      title: "Inbox order first",
      path: ["Inbox", "Inbox order first"],
      areaId: testAreaIds.inbox,
      start: null,
      version: 1,
    });
    const second = scheduledTask({
      id: "inbox-order-second",
      title: "Inbox order second",
      path: ["Inbox", "Inbox order second"],
      areaId: testAreaIds.inbox,
      start: null,
      version: 1,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [first, second],
      inboxOrder: [first.id, second.id],
    };
    const reorderedSnapshot = {
      ...snapshot,
      inboxOrder: [second.id, first.id],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    let rejectMove: (error: unknown) => void = () => {
      throw new Error("Inbox move rejection was not initialized");
    };
    const failedMove = new Promise<never>((_resolve, reject) => {
      rejectMove = reject;
    });
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockReturnValueOnce(failedMove)
      .mockResolvedValueOnce(reorderedSnapshot);
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
    } as DataTransfer;
    const dragFirstTaskDown = async () => {
      const item = await screen.findByRole("treeitem", {
        name: "Inbox order first",
      });
      const target = await screen.findByRole("treeitem", {
        name: "Inbox order second",
      });
      const handle = within(item).getByRole("button", {
        name: `Reorder ${first.title}`,
      });
      fireEvent.dragStart(handle, { dataTransfer });
      fireEvent.dragLeave(item, { dataTransfer });
      dispatchDragEvent(target, "dragover", dataTransfer, 59);
      dispatchDragEvent(target, "drop", dataTransfer, 59);
      fireEvent.dragEnd(handle, { dataTransfer });
    };
    const visibleTitles = () =>
      screen
        .getAllByRole("button", { name: /^Edit / })
        .map((button) => button.textContent)
        .slice(0, 2);

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/inbox"]}>
              <TaskStoreProvider>
                <InboxPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await dragFirstTaskDown();
      expect(visibleTitles()).toEqual([
        "Inbox order second",
        "Inbox order first",
      ]);
      await act(async () => {
        rejectMove(new api.ApiRequestError(500, "raw move response"));
      });

      const message =
        "Could not move “Inbox order first”. Try again from this Task.";
      expect(
        await screen.findByRole("region", {
          name: `Error notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(visibleTitles()).toEqual([
        "Inbox order first",
        "Inbox order second",
      ]);

      await userEvent.setup().click(
        screen.getByRole("button", {
          name: `Close notification: ${message}`,
        }),
      );
      await dragFirstTaskDown();

      expect(moveTask).toHaveBeenCalledTimes(2);
      expect(moveTask).toHaveBeenNthCalledWith(
        1,
        moveRequest(first, second, "after"),
      );
      expect(moveTask).toHaveBeenNthCalledWith(
        2,
        moveRequest(first, second, "after"),
      );
      expect(visibleTitles()).toEqual([
        "Inbox order second",
        "Inbox order first",
      ]);
      expect(
        screen.queryByRole("complementary", { name: "Notifications" }),
      ).not.toBeInTheDocument();
    } finally {
      moveTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("completes and reopens an Inbox Subtask without changing its tree order", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      areaTaskOrders: {
        "parent:inbox-1": ["inbox-subtask-1", "inbox-subtask-2"],
      },
      tasks: [
        ...testSnapshot.tasks,
        {
          id: "inbox-subtask-1",
          title: "Inbox Subtask one",
          path: ["Inbox", "歯科検診を予約する", "Inbox Subtask one"],
          areaId: testAreaIds.inbox,
          parentId: "inbox-1",
          status: "OPEN" as const,
          start: null,
          due: null,
          completedAt: null,
          updatedAt: "2026-08-05T00:00:00.000Z",
          tags: [],
          description: "",
          workNotes: "",
        },
        {
          id: "inbox-subtask-2",
          title: "Inbox Subtask two",
          path: ["Inbox", "歯科検診を予約する", "Inbox Subtask two"],
          areaId: testAreaIds.inbox,
          parentId: "inbox-1",
          status: "OPEN" as const,
          start: null,
          due: null,
          completedAt: null,
          updatedAt: "2026-08-05T00:00:00.000Z",
          tags: [],
          description: "",
          workNotes: "",
        },
      ],
    };

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Complete Inbox Subtask one" }),
    );
    expect(
      screen.queryByRole("button", { name: "Edit Inbox Subtask one" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show Completed" }));
    const reopen = await screen.findByRole("button", {
      name: "Reopen Inbox Subtask one",
    });
    await user.click(reopen);

    expect(
      await screen.findByRole("button", {
        name: "Complete Inbox Subtask one",
      }),
    ).toBeInTheDocument();
    const first = screen.getByRole("button", {
      name: "Edit Inbox Subtask one",
    });
    const second = screen.getByRole("button", {
      name: "Edit Inbox Subtask two",
    });
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("applies the saved sibling Manual Order inside the Inbox tree", () => {
    const snapshot = {
      ...testSnapshot,
      areaTaskOrders: {
        "parent:inbox-1": ["inbox-subtask-2", "inbox-subtask-1"],
      },
      tasks: [
        ...testSnapshot.tasks,
        {
          id: "inbox-subtask-1",
          title: "Inbox Subtask one",
          path: ["Inbox", "歯科検診を予約する", "Inbox Subtask one"],
          areaId: testAreaIds.inbox,
          parentId: "inbox-1",
          status: "OPEN" as const,
          start: null,
          due: null,
          completedAt: null,
          updatedAt: "2026-08-05T00:00:00.000Z",
          tags: [],
          description: "",
          workNotes: "",
        },
        {
          id: "inbox-subtask-2",
          title: "Inbox Subtask two",
          path: ["Inbox", "歯科検診を予約する", "Inbox Subtask two"],
          areaId: testAreaIds.inbox,
          parentId: "inbox-1",
          status: "OPEN" as const,
          start: null,
          due: null,
          completedAt: null,
          updatedAt: "2026-08-05T00:00:00.000Z",
          tags: [],
          description: "",
          workNotes: "",
        },
      ],
    };

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    const second = screen.getByRole("button", {
      name: "Edit Inbox Subtask two",
    });
    const first = screen.getByRole("button", {
      name: "Edit Inbox Subtask one",
    });
    expect(
      second.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("completes an Inbox Task", async () => {
    const user = userEvent.setup();

    render(
      <AppSettingsProvider>
        <MemoryRouter initialEntries={["/inbox"]}>
          <TaskStoreProvider>
            <InboxPage />
          </TaskStoreProvider>
        </MemoryRouter>
      </AppSettingsProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Complete 歯科検診を予約する" }),
    );
    expect(
      screen.queryByRole("button", { name: "Edit 歯科検診を予約する" }),
    ).not.toBeInTheDocument();
  });
});

describe("Inbox page header", () => {
  it("presents Inbox as a permanent Task area", () => {
    const inbox = testSnapshot.areas.find((area) => area.isSystemManaged);
    if (!inbox) throw new Error("System-managed Inbox Area was not found");

    const snapshot = {
      ...testSnapshot,
      areas: [inbox],
      tasks: testSnapshot.tasks.filter((task) => task.areaId === inbox.id),
    };

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    expect(screen.getByText("2 Open Tasks")).toBeInTheDocument();
    expect(screen.queryByText("Unclassified")).not.toBeInTheDocument();
    expect(screen.queryByText(/整理を待っています/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AIの実行候補/)).not.toBeInTheDocument();
  });
});

describe("Japanese task review localization", () => {
  it("localizes the five review pages while keeping static titles in English", () => {
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
      tasks: [],
      areaTaskOrders: {},
      inboxOrder: [],
      todayOrders: {},
    };

    const renderPage = (page: ReactNode, initialEntries: string[]) =>
      render(
        <BootstrapProvider initialSnapshot={snapshot}>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={initialEntries}>
              <TaskStoreProvider>{page}</TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

    const today = renderPage(<TodayPage />, ["/today"]);
    expect(document.documentElement).toHaveAttribute("lang", "ja");
    expect(today.getByRole("heading", { name: "Today" })).toHaveAttribute(
      "lang",
      "en",
    );
    expect(today.getByText(/\d+月\d+日.*曜日/)).toBeInTheDocument();
    expect(today.getByText("実行順")).toBeInTheDocument();
    expect(
      today.getByText("今日の未完了タスクはありません。"),
    ).toBeInTheDocument();
    today.unmount();

    const week = renderPage(<WeekPage />, ["/week"]);
    expect(week.getByRole("heading", { name: "This Week" })).toHaveAttribute(
      "lang",
      "en",
    );
    expect(
      week.getByText("今週予定されている未完了タスクはありません。"),
    ).toBeInTheDocument();
    week.unmount();

    const inbox = renderPage(<InboxPage />, ["/inbox"]);
    expect(inbox.getByRole("heading", { name: "Inbox" })).toHaveAttribute(
      "lang",
      "en",
    );
    expect(inbox.getByText("完了を表示")).toBeInTheDocument();
    expect(inbox.getByText("タスクはありません")).toBeInTheDocument();
    inbox.unmount();

    const area = renderPage(
      <Routes>
        <Route path="/areas/:areaId" element={<AreaDetailPage />} />
      </Routes>,
      [`/areas/${testAreaIds.develop}`],
    );
    expect(area.getByText("エリア詳細")).toBeInTheDocument();
    expect(area.getByText("タスクはありません")).toBeInTheDocument();
    expect(
      area.getByRole("img", { name: "エリアの色: Develop" }),
    ).toBeInTheDocument();
    area.unmount();

    const trash = renderPage(<TrashPage />, ["/trash"]);
    expect(trash.getByRole("heading", { name: "Trash" })).toHaveAttribute(
      "lang",
      "en",
    );
    expect(trash.getByText("ゴミ箱は空です")).toBeInTheDocument();
    expect(
      trash.getByText("復元できるタスクまたはエリアはありません。"),
    ).toBeInTheDocument();
    trash.unmount();

    applyDisplayLanguage("en");
  });

  it("localizes shared Task controls, context menu, and tooltip metadata", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };

    render(
      <BootstrapProvider initialSnapshot={snapshot}>
        <ProductionAppSettingsProvider>
          <MemoryRouter initialEntries={["/inbox"]}>
            <TaskStoreProvider>
              <InboxPage />
            </TaskStoreProvider>
          </MemoryRouter>
        </ProductionAppSettingsProvider>
      </BootstrapProvider>,
    );

    const title = "歯科検診を予約する";
    const edit = screen.getByRole("button", { name: `${title}を編集` });
    expect(
      screen.getByRole("tree", { name: "Inboxのタスクツリー" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${title}を完了` }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${title}の操作` }));
    expect(
      screen.getByRole("menuitem", { name: "サブタスクを追加" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "ゴミ箱へ移動" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const row = edit.closest("article");
    expect(
      row?.querySelector('[data-slot="task-tree-path"]'),
    ).toHaveTextContent("Inbox");

    const tooltipId = edit.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    const tooltip = document.getElementById(tooltipId ?? "");
    expect(tooltip).not.toBeNull();
    await user.hover(edit);
    await waitFor(() =>
      expect(tooltip).toHaveAttribute("aria-hidden", "false"),
    );
    expect(tooltip).toHaveTextContent("説明");

    applyDisplayLanguage("en");
  });

  it("localizes a Restore failure notification", async () => {
    const user = userEvent.setup();
    const task = scheduledTask({
      id: "ja-restore-rejected",
      title: "Restore rejected",
      path: ["Develop", "Restore rejected"],
      trashedAt: "2026-08-22T00:00:00.000Z",
      trashOperationId: "trash-operation",
      version: 2,
    });
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
      tasks: [task],
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    const restoreTask = vi
      .spyOn(api, "restoreTask")
      .mockRejectedValue(
        new api.ApiRequestError(404, "raw rejection", "TASK_NOT_FOUND"),
      );

    try {
      render(
        <BootstrapProvider>
          <ProductionAppSettingsProvider>
            <MemoryRouter initialEntries={["/trash"]}>
              <TaskStoreProvider>
                <TrashPage />
              </TaskStoreProvider>
            </MemoryRouter>
          </ProductionAppSettingsProvider>
        </BootstrapProvider>,
      );

      await user.click(
        await screen.findByRole("button", {
          name: "Restore rejectedを復元",
        }),
      );

      const message =
        "「Restore rejected」を復元できませんでした。最新のタスクを確認して、ゴミ箱からもう一度お試しください。";
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(
        await screen.findByRole("button", {
          name: "Restore rejectedを復元",
        }),
      ).toBeInTheDocument();
    } finally {
      restoreTask.mockRestore();
      loadBootstrap.mockRestore();
      applyDisplayLanguage("en");
    }
  });
});
