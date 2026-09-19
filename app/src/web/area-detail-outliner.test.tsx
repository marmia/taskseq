import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../domain/task";
import type { MoveTaskRequest, TaskMovePosition } from "../shared/api-schema";
import * as api from "./api-client";
import { BootstrapProvider } from "./bootstrap-state";
import { taskTreeCollapseStorageKey } from "./components/task-tree-collapse-state";
import { AreaDetailPage, TrashPage } from "./pages";
import { AppSettingsProvider } from "./settings-store";
import { TaskStoreProvider } from "./task-store";
import {
  taskMutationTestAction,
  testAreaIds,
  testSnapshot,
} from "./test/providers";

function renderAreaDetail(snapshot = testSnapshot) {
  const router = createMemoryRouter(
    [
      { path: "/areas/:areaId", element: <AreaDetailPage /> },
      { path: "/trash", element: <TrashPage /> },
      { path: "/task-mutations", action: taskMutationTestAction },
    ],
    { initialEntries: [`/areas/${testAreaIds.develop}`] },
  );

  render(
    <BootstrapProvider initialSnapshot={snapshot}>
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>
    </BootstrapProvider>,
  );

  return router;
}

function areaTask(overrides: Partial<Task>): Task {
  const baseTask = testSnapshot.tasks[0] as Task;
  const id = overrides.id ?? "area-fixture-task";
  const title = overrides.title ?? "Area fixture Task";
  return {
    ...baseTask,
    id,
    title,
    path: ["Develop", title],
    areaId: testAreaIds.develop,
    parentId: undefined,
    status: "OPEN",
    start: null,
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

async function pressTreeKey(
  item: HTMLElement,
  code: string,
  key = code,
): Promise<void> {
  fireEvent.keyDown(item, { code, key });
  fireEvent.keyUp(document, { code, key });
  await new Promise((resolve) => setTimeout(resolve, 30));
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("production Area Detail outliner", () => {
  it("omits Task paths at desktop and mobile widths", () => {
    const originalWidth = window.innerWidth;

    try {
      for (const width of [1280, 375]) {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: width,
        });
        renderAreaDetail();

        const tree = screen.getByRole("tree", { name: "Area Task tree" });
        for (const treeItem of within(tree).getAllByRole("treeitem")) {
          expect(
            treeItem.querySelector('[data-slot="task-tree-path"]'),
          ).toBeNull();
        }
        cleanup();
      }
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  it("renders a level-five flat ARIA tree with Area color on the header", () => {
    renderAreaDetail();

    const tree = screen.getByRole("tree", { name: "Area Task tree" });
    expect(tree).not.toHaveClass("border", "border-slate-200");
    const levelFiveItem = within(tree).getByRole("treeitem", {
      name: "Touch interactions",
    });
    expect(levelFiveItem).toHaveAttribute("aria-level", "5");
    expect(within(tree).queryAllByRole("list")).toHaveLength(0);

    const rootRow = screen
      .getByRole("button", { name: "Edit Taskseq MVP" })
      .closest("article");
    expect(rootRow).not.toBeNull();
    for (const treeItem of within(tree).getAllByRole("treeitem")) {
      const row = treeItem.querySelector("article");
      expect(row).not.toBeNull();
      expect(row).not.toHaveClass("border-l-[3px]");
    }

    const header = screen.getByRole("banner");
    expect(header).toHaveStyle({ backgroundColor: "#faf5ff" });
    expect(header).toHaveClass("border-b", "border-slate-200");
    expect(header).not.toHaveClass("border-2", "rounded-3xl");
    const areaIcon = screen.getByRole("img", { name: "Area color: Develop" });
    expect(areaIcon).toHaveStyle({ backgroundColor: "#c084fc" });
    expect(areaIcon).toHaveClass("size-8");
    expect(screen.getByRole("heading", { name: "Develop" })).toHaveClass(
      "text-3xl",
      "min-[560px]:text-2xl",
    );
    expect(screen.getByText("Area Detail")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Area直下のTask treeを表示します。子を持つTaskは開閉できます。",
      ),
    ).not.toBeInTheDocument();

    const treeFrame = screen.getByRole("region", {
      name: "Area task outliner",
    });
    expect(treeFrame).not.toHaveClass("border-2");
    expect(treeFrame).not.toHaveStyle({ borderColor: "#c084fc" });
    expect(treeFrame).toHaveClass("bg-white");
  });

  it("uses the shared two-line row order and 44px control targets", () => {
    renderAreaDetail();

    const row = screen
      .getByRole("button", { name: "Edit Taskseq MVP" })
      .closest("article") as HTMLElement;
    const dragHandle = within(row).getByRole("button", {
      name: "Reorder Taskseq MVP",
    });
    const toggle = within(row).getByRole("button", {
      name: "Collapse Taskseq MVP",
    });
    const checkbox = within(row).getByRole("button", {
      name: "Complete Taskseq MVP",
    });
    const title = within(row).getByRole("button", {
      name: "Edit Taskseq MVP",
    });
    const contextMenu = within(row).getByRole("button", {
      name: "Taskseq MVP actions",
    });

    expect(
      dragHandle.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      checkbox.compareDocumentPosition(title) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(contextMenu) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(row).toHaveStyle({ minHeight: "60px" });
    expect(toggle).not.toBeDisabled();
    expect(checkbox).not.toBeDisabled();
    expect(title).not.toBeDisabled();
    expect(dragHandle).not.toBeDisabled();
    expect(toggle).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "24px",
    });
    expect(checkbox).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "30px",
    });
    expect(dragHandle).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "28px",
    });
    expect(contextMenu).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "30px",
    });
    expect(dragHandle.querySelector("svg")).toHaveAttribute("width", "18");
    expect(dragHandle.querySelector("svg")).toHaveAttribute("height", "22");
    expect(toggle.querySelector("svg")).toHaveAttribute("width", "16");
    expect(checkbox.querySelector("span")).toHaveClass("size-[18px]");
    expect(contextMenu.querySelector("svg")).toHaveAttribute("width", "18");
  });

  it("uses the same compact row details and progress in Area Detail", async () => {
    const user = userEvent.setup();
    const parent = areaTask({
      id: "area-compact-parent",
      title: "Area compact parent",
      due: "2026-08-31",
      start: "2026-08-31",
      tags: [{ id: 2, name: "backend" }],
      description: "Area compact description",
      workNotes: "Area private work note",
    });
    const directOpen = areaTask({
      id: "area-compact-direct-open",
      title: "Area direct open child",
      parentId: parent.id,
      path: ["Develop", parent.title, "Area direct open child"],
    });
    const directCompleted = areaTask({
      id: "area-compact-direct-completed",
      title: "Area direct completed child",
      parentId: parent.id,
      path: ["Develop", parent.title, "Area direct completed child"],
      status: "COMPLETED",
      completedAt: "2026-08-20T00:00:00.000Z",
    });
    const directRecurring = areaTask({
      id: "area-compact-direct-recurring",
      title: "Area direct recurring child",
      parentId: parent.id,
      path: ["Develop", parent.title, "Area direct recurring child"],
      recurrenceRule: "week",
    });
    const recurringTask = areaTask({
      id: "area-compact-recurring",
      title: "Area recurring root",
      recurrenceRule: "day",
    });
    const rootGroupKey = `area:${testAreaIds.develop}`;
    renderAreaDetail({
      ...testSnapshot,
      tasks: [
        parent,
        directOpen,
        directCompleted,
        directRecurring,
        recurringTask,
      ],
      areaTaskOrders: {
        [rootGroupKey]: [parent.id, recurringTask.id],
        [`parent:${parent.id}`]: [
          directOpen.id,
          directCompleted.id,
          directRecurring.id,
        ],
      },
    });

    const tree = screen.getByRole("tree", { name: "Area Task tree" });
    const parentItem = within(tree).getByRole("treeitem", {
      name: parent.title,
    });
    const row = parentItem.querySelector(
      '[data-slot="task-tree-row"]',
    ) as HTMLElement;
    const slot = (name: string) =>
      row.querySelector(`[data-slot="${name}"]`) as HTMLElement;
    const dragHandle = slot("task-tree-drag-handle");
    const indent = slot("task-tree-depth-indent");
    const chevron = slot("task-tree-chevron");
    const status = slot("task-tree-status-control");
    const title = slot("task-tree-title");
    const progress = slot("task-tree-progress");
    const dates = slot("task-tree-dates");
    const contextMenu = slot("task-tree-context-menu");

    expect(row).toHaveStyle({ minHeight: "60px" });
    expect(indent).toHaveStyle({ width: "0px" });
    expect(dragHandle).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "28px",
    });
    expect(chevron).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "24px",
    });
    expect(status).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "30px",
    });
    expect(contextMenu).toHaveStyle({
      height: "44px",
      minHeight: "44px",
      minWidth: "30px",
    });
    expect(
      dragHandle.compareDocumentPosition(chevron) &
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
    expect(title).toHaveClass("font-normal", "text-[15px]", "leading-5");
    expect(title).toHaveStyle({
      fontSize: "15px",
      lineHeight: "20px",
      fontWeight: 400,
    });
    expect(progress).toHaveStyle({ fontSize: "12px", lineHeight: "16px" });
    expect(slot("task-tree-meta-row")).toHaveClass("flex-wrap");
    expect(dates).toHaveTextContent("8/31");
    expect(
      dates.querySelector('[data-slot="task-tree-calendar"]'),
    ).toHaveAttribute("data-icon", "calendar");
    expect(row.querySelector('[data-slot="task-tree-path"]')).toBeNull();
    const tooltipId = title.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    expect(document.getElementById(tooltipId ?? "")).toHaveStyle({
      fontSize: "13px",
      position: "fixed",
    });
    expect(row).toHaveTextContent("1/2");
    expect(row).toHaveTextContent("↻1");
    expect(
      within(row).getByRole("img", {
        name: "1 Open Recurring Subtasks",
      }),
    ).toBeInTheDocument();
    expect(row.querySelector("time")).toBeNull();

    const tooltip = document.getElementById(tooltipId ?? "") as HTMLElement;
    expect(tooltip).toHaveClass("fixed", "overflow-y-auto");
    expect(tooltip).toHaveAttribute("data-placement", "bottom-start");
    expect(tooltip).not.toHaveClass("right-0", "left-1/2");
    await user.hover(title);
    expect(tooltip).toHaveTextContent(parent.title);
    expect(tooltip).toHaveTextContent("Start");
    expect(tooltip).toHaveTextContent("Due");
    expect(tooltip).toHaveTextContent("2026/8/31");
    expect(tooltip).toHaveTextContent("backend");
    expect(tooltip).toHaveTextContent(parent.description);
    expect(tooltip).toHaveTextContent(parent.workNotes);

    const recurringRow = within(tree)
      .getByRole("treeitem", { name: recurringTask.title })
      .querySelector('[data-slot="task-tree-row"]') as HTMLElement;
    const recurringIcon = within(recurringRow).getByRole("img", {
      name: "Recurring Task",
    });
    expect(recurringIcon).toBeInTheDocument();
  });

  it("exposes flat tree metadata and supports Area keyboard navigation", async () => {
    renderAreaDetail();

    const tree = screen.getByRole("tree", { name: "Area Task tree" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Taskseq MVP",
      "UI prototype",
      "Mobile verification",
      "iPhone Safari",
      "Touch interactions",
      "Navigation shellを比較する",
      "API contractを確認する",
    ]);
    expect(items.map((item) => item.getAttribute("aria-level"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "3",
      "2",
    ]);
    expect(items[0]).toHaveAttribute("aria-posinset", "1");
    expect(items[0]).toHaveAttribute("aria-setsize", "1");
    expect(items[1]).toHaveAttribute("aria-posinset", "1");
    expect(items[1]).toHaveAttribute("aria-setsize", "2");
    expect(items[6]).toHaveAttribute("aria-posinset", "2");
    expect(items[6]).toHaveAttribute("aria-setsize", "2");
    expect(
      items.filter((item) => item.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);

    const parent = within(tree).getByRole("treeitem", {
      name: "Taskseq MVP",
    });
    parent.focus();

    await pressTreeKey(parent, "ArrowLeft");
    expect(parent).toHaveAttribute("aria-expanded", "false");
    expect(
      within(tree).queryByRole("treeitem", { name: "UI prototype" }),
    ).not.toBeInTheDocument();

    await pressTreeKey(parent, "ArrowRight");
    await pressTreeKey(parent, "ArrowRight");
    const expandedChild = within(tree).getByRole("treeitem", {
      name: "UI prototype",
    });
    expect(expandedChild).toHaveFocus();
    await pressTreeKey(expandedChild, "ArrowLeft");
    const collapsedChild = within(tree).getByRole("treeitem", {
      name: "UI prototype",
    });
    expect(collapsedChild).toHaveAttribute("aria-expanded", "false");
    await pressTreeKey(collapsedChild, "ArrowLeft");
    const currentParent = within(tree).getByRole("treeitem", {
      name: "Taskseq MVP",
    });
    expect(currentParent).toHaveFocus();
    await pressTreeKey(currentParent, "End");
    const currentLeaf = within(tree).getByRole("treeitem", {
      name: "API contractを確認する",
    });
    expect(currentLeaf).toHaveFocus();
    await pressTreeKey(currentLeaf, "Home");
    expect(
      within(tree).getByRole("treeitem", { name: "Taskseq MVP" }),
    ).toHaveFocus();
    await pressTreeKey(
      within(tree).getByRole("treeitem", { name: "Taskseq MVP" }),
      "Enter",
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Taskseq MVP",
    );
  });

  it("restores a collapsed Task after a same-tab remount", async () => {
    const user = userEvent.setup();
    renderAreaDetail();

    await user.click(
      screen.getByRole("button", { name: "Collapse Taskseq MVP" }),
    );
    expect(
      screen.queryByRole("treeitem", { name: "UI prototype" }),
    ).not.toBeInTheDocument();

    cleanup();
    renderAreaDetail();
    expect(
      screen.queryByRole("treeitem", { name: "UI prototype" }),
    ).not.toBeInTheDocument();
  });

  it("preserves collapse state while the Completed filter changes", async () => {
    const user = userEvent.setup();
    const parent = areaTask({
      id: "collapse-filter-parent",
      title: "Collapse filter parent",
    });
    const openChild = areaTask({
      id: "collapse-filter-open-child",
      title: "Collapse filter open child",
      parentId: parent.id,
      path: ["Develop", parent.title, "Collapse filter open child"],
    });
    const completedChild = areaTask({
      id: "collapse-filter-completed-child",
      title: "Collapse filter completed child",
      parentId: parent.id,
      path: ["Develop", parent.title, "Collapse filter completed child"],
      status: "COMPLETED",
      completedAt: "2026-08-20T00:00:00.000Z",
    });
    const rootGroupKey = `area:${testAreaIds.develop}`;
    renderAreaDetail({
      ...testSnapshot,
      tasks: [parent, openChild, completedChild],
      areaTaskOrders: {
        [rootGroupKey]: [parent.id],
        [`parent:${parent.id}`]: [openChild.id, completedChild.id],
      },
    });

    await user.click(screen.getByRole("checkbox", { name: "Show Completed" }));
    expect(
      screen.getByRole("treeitem", { name: completedChild.title }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: `Collapse ${parent.title}` }),
    );
    expect(
      screen.queryByRole("treeitem", { name: openChild.title }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show Completed" }));
    await user.click(screen.getByRole("checkbox", { name: "Show Completed" }));
    expect(
      screen.queryByRole("treeitem", { name: openChild.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: completedChild.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Expand ${parent.title}` }),
    ).toBeInTheDocument();
  });

  it("ignores invalid and stale collapse storage payloads", () => {
    const storageKey = taskTreeCollapseStorageKey(
      `area:${testAreaIds.develop}`,
    );
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 999,
        collapsedTaskIds: ["task-task-management-mvp"],
      }),
    );
    renderAreaDetail();

    expect(
      screen.getByRole("treeitem", { name: "UI prototype" }),
    ).toBeInTheDocument();

    cleanup();
    window.sessionStorage.setItem(storageKey, "{not-json");
    renderAreaDetail();
    expect(
      screen.getByRole("treeitem", { name: "UI prototype" }),
    ).toBeInTheDocument();

    cleanup();
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        collapsedTaskIds: ["missing-task", "trash-1"],
      }),
    );
    renderAreaDetail();
    expect(
      screen.getByRole("treeitem", { name: "UI prototype" }),
    ).toBeInTheDocument();
  });

  it("falls back to in-memory state when sessionStorage cannot be read or written", async () => {
    const user = userEvent.setup();
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("sessionStorage read blocked");
      });

    try {
      renderAreaDetail();
      await user.click(
        screen.getByRole("button", { name: "Collapse Taskseq MVP" }),
      );
      expect(
        screen.queryByRole("treeitem", { name: "UI prototype" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      cleanup();
      getItem.mockRestore();
      renderAreaDetail();
      expect(
        screen.getByRole("treeitem", { name: "UI prototype" }),
      ).toBeInTheDocument();
      cleanup();

      window.sessionStorage.setItem(
        taskTreeCollapseStorageKey(`area:${testAreaIds.develop}`),
        JSON.stringify({
          version: 1,
          collapsedTaskIds: ["task-task-management-mvp"],
        }),
      );
      renderAreaDetail();
      expect(
        screen.queryByRole("treeitem", { name: "UI prototype" }),
      ).not.toBeInTheDocument();

      const setItem = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("sessionStorage write blocked");
        });
      try {
        await user.click(
          screen.getByRole("button", { name: "Expand Taskseq MVP" }),
        );
        expect(
          screen.getByRole("treeitem", { name: "UI prototype" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      } finally {
        setItem.mockRestore();
      }

      expect(
        window.sessionStorage.getItem(
          taskTreeCollapseStorageKey(`area:${testAreaIds.develop}`),
        ),
      ).toBeNull();
      cleanup();
      renderAreaDetail();
      expect(
        screen.getByRole("treeitem", { name: "UI prototype" }),
      ).toBeInTheDocument();
    } finally {
      getItem.mockRestore();
    }
  });

  it("expands a collapsed parent after Add Subtask succeeds", async () => {
    const user = userEvent.setup();
    const storageKey = taskTreeCollapseStorageKey(
      `area:${testAreaIds.develop}`,
    );
    renderAreaDetail();

    await user.click(
      screen.getByRole("button", { name: "Collapse Taskseq MVP" }),
    );
    const parentRow = screen
      .getByRole("button", { name: "Edit Taskseq MVP" })
      .closest("article") as HTMLElement;
    await user.click(
      within(parentRow).getByRole("button", { name: "Taskseq MVP actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Add Subtask" }));
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Created child",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByRole("treeitem", { name: "Created child" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse Taskseq MVP" }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}"),
    ).toEqual({ version: 1, collapsedTaskIds: [] });
  });

  it("keeps sibling Manual Order while preserving the five-level tree", () => {
    renderAreaDetail({
      ...testSnapshot,
      areaTaskOrders: {
        "parent:task-task-management-mvp": ["task-2", "task-ui-prototype"],
      },
    });

    const firstSibling = screen.getByRole("button", {
      name: "Edit API contractを確認する",
    });
    const secondSibling = screen.getByRole("button", {
      name: "Edit UI prototype",
    });
    expect(
      firstSibling.compareDocumentPosition(secondSibling) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const levelFiveItem = screen.getByRole("treeitem", {
      name: "Touch interactions",
    });
    expect(levelFiveItem).toHaveAttribute("aria-level", "5");
    const levelFiveRow = levelFiveItem.querySelector(
      '[data-slot="task-tree-row"]',
    ) as HTMLElement;
    const levelFiveIndent = levelFiveRow.querySelector(
      '[data-slot="task-tree-depth-indent"]',
    ) as HTMLElement;
    expect(levelFiveRow).toHaveStyle({ minHeight: "60px" });
    expect(levelFiveIndent).toHaveStyle({ width: "64px" });
    expect(
      levelFiveRow.querySelector('[data-slot="task-tree-drag-handle"]'),
    ).toHaveStyle({ height: "44px", minWidth: "28px" });
    expect(
      levelFiveRow.querySelector('[data-slot="task-tree-status-control"]'),
    ).toHaveStyle({ height: "44px", minWidth: "30px" });
    expect(
      levelFiveRow.querySelector('[data-slot="task-tree-title"]'),
    ).toHaveStyle({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });

  it("does not reorder siblings through tree keyboard shortcuts", async () => {
    const baseTask = testSnapshot.tasks[0] as Task;
    const first: Task = {
      ...baseTask,
      id: "area-keyboard-first",
      title: "Area keyboard first",
      path: ["Develop", "Area keyboard first"],
      parentId: undefined,
    };
    const second: Task = {
      ...baseTask,
      id: "area-keyboard-second",
      title: "Area keyboard second",
      path: ["Develop", "Area keyboard second"],
      parentId: undefined,
    };
    renderAreaDetail({
      ...testSnapshot,
      tasks: [first, second],
      areaTaskOrders: {
        [`area:${testAreaIds.develop}`]: [first.id, second.id],
      },
    });

    const tree = screen.getByRole("tree", { name: "Area Task tree" });
    const firstItem = screen.getByRole("treeitem", {
      name: first.title,
    });
    firstItem.focus();
    await pressTreeKey(firstItem, "Space", " ");
    await pressTreeKey(firstItem, "ArrowDown");
    await pressTreeKey(firstItem, "Escape");
    expect(
      within(tree)
        .getAllByRole("treeitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([first.title, second.title]);
  });

  it("reorders root and reparents Subtasks through dedicated handles only", async () => {
    const rootFirst = areaTask({
      id: "area-pointer-root-first",
      title: "Area pointer root first",
    });
    const rootSecond = areaTask({
      id: "area-pointer-root-second",
      title: "Area pointer root second",
    });
    const firstParent = areaTask({
      id: "area-pointer-parent-one",
      title: "Area pointer parent one",
    });
    const secondParent = areaTask({
      id: "area-pointer-parent-two",
      title: "Area pointer parent two",
    });
    const firstChild = areaTask({
      id: "area-pointer-child-one",
      title: "Area pointer child one",
      parentId: firstParent.id,
      path: ["Develop", firstParent.title, "Area pointer child one"],
    });
    const secondChild = areaTask({
      id: "area-pointer-child-two",
      title: "Area pointer child two",
      parentId: firstParent.id,
      path: ["Develop", firstParent.title, "Area pointer child two"],
    });
    const otherChild = areaTask({
      id: "area-pointer-other-child",
      title: "Area pointer other child",
      parentId: secondParent.id,
      path: ["Develop", secondParent.title, "Area pointer other child"],
    });
    const rootGroupKey = `area:${testAreaIds.develop}`;
    const snapshot = {
      ...testSnapshot,
      tasks: [
        rootFirst,
        rootSecond,
        firstParent,
        secondParent,
        firstChild,
        secondChild,
        otherChild,
      ],
      areaTaskOrders: {
        [rootGroupKey]: [
          rootFirst.id,
          rootSecond.id,
          firstParent.id,
          secondParent.id,
        ],
        [`parent:${firstParent.id}`]: [firstChild.id, secondChild.id],
        [`parent:${secondParent.id}`]: [otherChild.id],
      },
    };
    renderAreaDetail(snapshot);

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
        name: "Area Task tree",
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
      expect(sourceItem).not.toHaveAttribute("draggable", "true");
      expect(sourceHandle).toHaveAttribute("draggable", "true");
      fireEvent.dragStart(sourceHandle, { dataTransfer });
      fireEvent.dragLeave(sourceItem, { dataTransfer });
      dispatchDragEvent(targetItem, "dragover", dataTransfer, clientY);
      dispatchDragEvent(targetItem, "drop", dataTransfer, clientY);
      fireEvent.dragEnd(sourceHandle, { dataTransfer });
    };
    const treeTitles = () =>
      within(screen.getByRole("tree", { name: "Area Task tree" }))
        .getAllByRole("treeitem")
        .map((item) => item.getAttribute("aria-label"));

    await dragHandleTo(rootFirst.title, rootSecond.title);
    await waitFor(() =>
      expect(treeTitles()).toEqual([
        rootSecond.title,
        rootFirst.title,
        firstParent.title,
        firstChild.title,
        secondChild.title,
        secondParent.title,
        otherChild.title,
      ]),
    );

    await dragHandleTo(firstChild.title, secondChild.title);
    await waitFor(() =>
      expect(treeTitles()).toEqual([
        rootSecond.title,
        rootFirst.title,
        firstParent.title,
        secondChild.title,
        firstChild.title,
        secondParent.title,
        otherChild.title,
      ]),
    );

    const beforeReparent = treeTitles();
    await dragHandleTo(firstChild.title, otherChild.title, 1);
    await waitFor(() =>
      expect(treeTitles()).toEqual([
        rootSecond.title,
        rootFirst.title,
        firstParent.title,
        secondChild.title,
        secondParent.title,
        firstChild.title,
        otherChild.title,
      ]),
    );
    expect(treeTitles()).not.toEqual(beforeReparent);
  });

  it("preserves hidden Completed Area siblings through reorder and remount", async () => {
    const first = areaTask({
      id: "area-visible-first",
      title: "Area visible first",
    });
    const completed = areaTask({
      id: "area-completed-middle",
      title: "Area completed middle",
      status: "COMPLETED",
      completedAt: "2026-08-05T00:00:00.000Z",
    });
    const second = areaTask({
      id: "area-visible-second",
      title: "Area visible second",
    });
    const rootGroupKey = `area:${testAreaIds.develop}`;
    const snapshot = {
      ...testSnapshot,
      tasks: [first, completed, second],
      areaTaskOrders: {
        [rootGroupKey]: [first.id, completed.id, second.id],
      },
    };
    const reorderedSnapshot = {
      ...snapshot,
      areaTaskOrders: {
        [rootGroupKey]: [completed.id, second.id, first.id],
      },
    };
    renderAreaDetail(snapshot);

    const treeTitles = () =>
      within(screen.getByRole("tree", { name: "Area Task tree" }))
        .getAllByRole("treeitem")
        .map((item) => item.getAttribute("aria-label"));
    const firstItem = screen.getByRole("treeitem", { name: first.title });
    const secondItem = screen.getByRole("treeitem", { name: second.title });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
    } as DataTransfer;
    const firstHandle = within(firstItem).getByRole("button", {
      name: `Reorder ${first.title}`,
    });
    fireEvent.dragStart(firstHandle, { dataTransfer });
    fireEvent.dragLeave(firstItem, { dataTransfer });
    dispatchDragEvent(secondItem, "dragover", dataTransfer, 59);
    dispatchDragEvent(secondItem, "drop", dataTransfer, 59);
    fireEvent.dragEnd(firstHandle, { dataTransfer });
    await waitFor(() =>
      expect(treeTitles()).toEqual([second.title, first.title]),
    );

    const completedToggle = screen.getByRole("checkbox", {
      name: "Show Completed",
    });
    await userEvent.setup().click(completedToggle);
    expect(treeTitles()).toEqual([completed.title, second.title, first.title]);

    cleanup();
    renderAreaDetail(reorderedSnapshot);
    expect(treeTitles()).toEqual([second.title, first.title]);
    await userEvent
      .setup()
      .click(screen.getByRole("checkbox", { name: "Show Completed" }));
    expect(treeTitles()).toEqual([completed.title, second.title, first.title]);
  });

  it("reports an Area Manual Order rejection, rolls back, and allows retry by dragging again", async () => {
    const baseTask = testSnapshot.tasks[0] as Task;
    const first: Task = {
      ...baseTask,
      id: "area-order-first",
      title: "Area order first",
      path: ["Develop", "Area order first"],
      areaId: testAreaIds.develop,
      parentId: undefined,
      status: "OPEN",
      trashedAt: null,
      version: 1,
    };
    const second: Task = {
      ...baseTask,
      id: "area-order-second",
      title: "Area order second",
      path: ["Develop", "Area order second"],
      areaId: testAreaIds.develop,
      parentId: undefined,
      status: "OPEN",
      trashedAt: null,
      version: 1,
    };
    const groupKey = `area:${testAreaIds.develop}`;
    const snapshot = {
      ...testSnapshot,
      tasks: [first, second],
      areaTaskOrders: { [groupKey]: [first.id, second.id] },
    };
    const reorderedSnapshot = {
      ...snapshot,
      areaTaskOrders: { [groupKey]: [second.id, first.id] },
    };
    const loadBootstrap = vi
      .spyOn(api, "loadBootstrap")
      .mockResolvedValue(snapshot);
    let rejectMove: (error: unknown) => void = () => {
      throw new Error("Area move rejection was not initialized");
    };
    const failedMove = new Promise<never>((_resolve, reject) => {
      rejectMove = reject;
    });
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockReturnValueOnce(failedMove)
      .mockResolvedValueOnce(reorderedSnapshot);
    const router = createMemoryRouter(
      [{ path: "/areas/:areaId", element: <AreaDetailPage /> }],
      { initialEntries: [`/areas/${testAreaIds.develop}`] },
    );
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "all",
    } as DataTransfer;
    const dragFirstTaskDown = async () => {
      const item = await screen.findByRole("treeitem", {
        name: "Area order first",
      });
      const target = await screen.findByRole("treeitem", {
        name: "Area order second",
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
          <AppSettingsProvider>
            <TaskStoreProvider>
              <RouterProvider router={router} />
            </TaskStoreProvider>
          </AppSettingsProvider>
        </BootstrapProvider>,
      );

      await dragFirstTaskDown();
      expect(visibleTitles()).toEqual([
        "Area order second",
        "Area order first",
      ]);
      await act(async () => {
        rejectMove(
          new api.ApiRequestError(
            422,
            "raw move response",
            "TASK_MOVE_INVALID",
          ),
        );
      });

      const message =
        "Could not move “Area order first”. Review the latest Task and try again from this Task.";
      expect(
        await screen.findByRole("region", {
          name: `Warning notification: ${message}`,
        }),
      ).toBeInTheDocument();
      expect(visibleTitles()).toEqual([
        "Area order first",
        "Area order second",
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
        "Area order second",
        "Area order first",
      ]);
      expect(
        screen.queryByRole("complementary", { name: "Notifications" }),
      ).not.toBeInTheDocument();
    } finally {
      moveTask.mockRestore();
      loadBootstrap.mockRestore();
    }
  });

  it("hides inline details and shows them from the Title tooltip", async () => {
    const user = userEvent.setup();
    renderAreaDetail({
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((task) =>
        task.id === "task-2"
          ? {
              ...task,
              description: "Area Detail description",
              workNotes: "Area Detail work notes",
            }
          : task,
      ),
    });

    const title = screen.getByRole("button", {
      name: "Edit API contractを確認する",
    });
    const row = title.closest("article") as HTMLElement;
    expect(
      within(row).queryByRole("region", { name: "Description" }),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole("region", { name: "Work Notes" }),
    ).not.toBeInTheDocument();

    const detailsId = title.getAttribute("aria-describedby");
    expect(detailsId).toBeTruthy();
    const tooltip = document.getElementById(detailsId ?? "");
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveAttribute("aria-hidden", "true");

    await user.hover(title);
    expect(tooltip).toHaveAttribute("aria-hidden", "false");
    expect(tooltip).toHaveTextContent("Area Detail description");
    expect(tooltip).toHaveTextContent("Area Detail work notes");

    await user.unhover(title);
    await waitFor(() => expect(tooltip).toHaveAttribute("aria-hidden", "true"));

    fireEvent.blur(title);
    fireEvent.focus(title);
    expect(tooltip).toHaveAttribute("aria-hidden", "false");
    fireEvent.blur(title);
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the existing Task status interaction in the tree", async () => {
    const user = userEvent.setup();
    renderAreaDetail();

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

  it("confirms a parent Trash operation with its cascade count and updates the snapshot", async () => {
    const user = userEvent.setup();
    const router = renderAreaDetail();

    const rootRow = screen
      .getByRole("button", { name: "Edit Taskseq MVP" })
      .closest("article") as HTMLElement;
    await user.click(
      within(rootRow).getByRole("button", {
        name: "Taskseq MVP actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));

    const confirmation = screen.getByRole("dialog", { name: "Move to Trash" });
    expect(confirmation).toHaveTextContent(
      "Move “Taskseq MVP” and 6 Subtasks to Trash.",
    );

    await user.click(
      within(confirmation).getByRole("button", { name: "Move to Trash" }),
    );
    expect(
      screen.queryByRole("button", { name: "Edit Taskseq MVP" }),
    ).not.toBeInTheDocument();

    await router.navigate("/trash");
    expect(
      await screen.findByRole("button", { name: "Restore Taskseq MVP" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restore Touch interactions" }),
    ).toBeInTheDocument();
  });

  it("does not offer Add Subtask for a level-five Task", async () => {
    const user = userEvent.setup();
    renderAreaDetail();

    const levelFiveRow = screen
      .getByRole("button", { name: "Edit Touch interactions" })
      .closest("article") as HTMLElement;
    await user.click(
      within(levelFiveRow).getByRole("button", {
        name: "Touch interactions actions",
      }),
    );

    expect(
      screen.queryByRole("menuitem", { name: "Add Subtask" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Move to Trash" }),
    ).toBeInTheDocument();
  });
});
