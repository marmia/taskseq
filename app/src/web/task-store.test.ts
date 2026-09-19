import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Task } from "../domain/task";
import type { BootstrapResponse } from "../shared/api-schema";
import { BootstrapProvider, useBootstrap } from "./bootstrap-state";
import { testAreaIds } from "./mock-data";
import { AppSettingsProvider } from "./settings-store";
import {
  canCompleteTask,
  isActionableOpenTask,
  isCompletedToday,
  isTodayOpenTask,
  orderTodayTasks,
  reopenTaskAndCompletedAncestors,
  restoreTaskAndDescendants,
  TaskStoreProvider,
  trashTaskAndDescendants,
  useTaskStore,
} from "./task-store";

const api = vi.hoisted(() => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(readonly status: number) {
      super("API request failed");
    }
  },
  loadBootstrap: vi.fn(),
  reorderToday: vi.fn(),
  restoreTask: vi.fn(),
  trashTask: vi.fn(),
}));

vi.mock("./api-client", () => api);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task",
    title: "Task",
    path: ["Develop", "Task"],
    areaId: testAreaIds.develop,
    status: "OPEN",
    start: "2026-07-25",
    due: null,
    completedAt: null,
    updatedAt: "2026-08-05T00:00:00.000Z",
    tags: [],
    description: "",
    workNotes: "",
    ...overrides,
  };
}

const systemInbox: Area = {
  id: testAreaIds.inbox,
  name: "Inbox",
  color: "gray",
  position: 0,
  isSystemManaged: true,
};

describe("Task actionability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("applies Today Order without changing the source task collection", () => {
    const first = task({ id: "first" });
    const second = task({ id: "second" });
    const tasks = [first, second];

    expect(orderTodayTasks(tasks, ["second"])).toEqual([second, first]);
    expect(tasks).toEqual([first, second]);
  });

  it("includes a parent Task in Today when it has a visible child", () => {
    const parent = task({ id: "parent" });
    const child = task({
      id: "child",
      parentId: "parent",
      path: ["Develop", "Parent", "Child"],
    });

    expect(isTodayOpenTask(parent, [parent, child], [], "Asia/Tokyo")).toBe(
      true,
    );
    expect(isTodayOpenTask(child, [parent, child], [], "Asia/Tokyo")).toBe(
      true,
    );
  });

  it("keeps Inbox Tasks eligible for Actionable Task", () => {
    const inboxTask = task({ areaId: systemInbox.id });
    const completedInboxTask = task({
      id: "completed-inbox",
      areaId: systemInbox.id,
      status: "COMPLETED",
      completedAt: "2026-07-25T00:30:00.000Z",
    });

    expect(isActionableOpenTask(inboxTask, [inboxTask], [systemInbox])).toBe(
      true,
    );
    expect(
      isTodayOpenTask(inboxTask, [inboxTask], [systemInbox], "Asia/Tokyo"),
    ).toBe(true);
    expect(
      isCompletedToday(
        completedInboxTask,
        [systemInbox],
        "Asia/Tokyo",
        "2026-07-25",
      ),
    ).toBe(true);
  });

  it("rejects completion while an open descendant remains", () => {
    const parent = task({ id: "parent" });
    const child = task({
      id: "child",
      parentId: "parent",
      path: ["Develop", "Parent", "Child"],
    });

    expect(canCompleteTask([parent, child], "parent")).toBe(false);
    expect(
      canCompleteTask(
        [
          parent,
          {
            ...child,
            status: "COMPLETED",
            completedAt: "2026-07-25T00:00:00.000Z",
          },
        ],
        "parent",
      ),
    ).toBe(true);
  });

  it("sorts unordered Today Tasks by tree path", () => {
    const navigation = task({
      id: "navigation",
      path: ["Develop", "Taskseq MVP", "UI prototype", "Navigation"],
    });
    const api = task({
      id: "api",
      path: ["Develop", "Taskseq MVP", "API contract"],
    });

    expect(orderTodayTasks([navigation, api], [])).toEqual([api, navigation]);
  });

  it("uses the current Area name for an unordered Today Task path", () => {
    const renamedAreaTask = task({
      id: "renamed-area",
      areaId: testAreaIds.develop,
      path: ["Develop", "A Task"],
    });
    const musicTask = task({
      id: "music",
      areaId: testAreaIds.music,
      path: ["Music", "Z Task"],
    });
    const areas: Area[] = [
      {
        id: testAreaIds.develop,
        name: "Zulu",
        color: "purple",
        position: 2,
        isSystemManaged: false,
      },
      {
        id: testAreaIds.music,
        name: "Music",
        color: "green",
        position: 3,
        isSystemManaged: false,
      },
    ];

    expect(orderTodayTasks([renamedAreaTask, musicTask], [], areas)).toEqual([
      musicTask,
      renamedAreaTask,
    ]);
  });

  it("restores only descendants from the same trash operation", () => {
    const parent = task({
      id: "parent",
      trashedAt: "2026-07-25T00:00:00.000Z",
      trashOperationId: "operation-1",
    });
    const cascadedChild = task({
      id: "cascaded-child",
      parentId: "parent",
      trashedAt: "2026-07-25T00:00:00.000Z",
      trashOperationId: "operation-1",
    });
    const separatelyTrashedChild = task({
      id: "separately-trashed-child",
      parentId: "parent",
      trashedAt: "2026-07-26T00:00:00.000Z",
      trashOperationId: "operation-2",
    });

    expect(
      restoreTaskAndDescendants(
        [parent, cascadedChild, separatelyTrashedChild],
        "parent",
      ),
    ).toEqual([
      { ...parent, trashedAt: null, trashOperationId: null },
      { ...cascadedChild, trashedAt: null, trashOperationId: null },
      separatelyTrashedChild,
    ]);
  });

  it("restores the trashed cascade root when restoring its child", () => {
    const parent = task({
      id: "parent",
      trashedAt: "2026-07-25T00:00:00.000Z",
      trashOperationId: "operation-1",
    });
    const child = task({
      id: "child",
      parentId: "parent",
      trashedAt: "2026-07-25T00:00:00.000Z",
      trashOperationId: "operation-1",
    });

    expect(restoreTaskAndDescendants([parent, child], "child")).toEqual([
      { ...parent, trashedAt: null, trashOperationId: null },
      { ...child, trashedAt: null, trashOperationId: null },
    ]);
  });

  it("reopens completed ancestors with a reopened child", () => {
    const parent = task({
      id: "parent",
      status: "COMPLETED",
      completedAt: "2026-07-25T00:00:00.000Z",
    });
    const child = task({
      id: "child",
      parentId: "parent",
      status: "COMPLETED",
      completedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(reopenTaskAndCompletedAncestors([parent, child], "child")).toEqual([
      { ...parent, status: "OPEN", completedAt: null },
      { ...child, status: "OPEN", completedAt: null },
    ]);
  });

  it("trashes a Task and its active descendants with one operation ID", () => {
    const parent = task({ id: "parent" });
    const child = task({ id: "child", parentId: "parent" });
    const separatelyTrashedChild = task({
      id: "separately-trashed-child",
      parentId: "parent",
      trashedAt: "2026-07-24T00:00:00.000Z",
      trashOperationId: "operation-0",
    });

    expect(
      trashTaskAndDescendants(
        [parent, child, separatelyTrashedChild],
        "parent",
        "2026-07-25T00:00:00.000Z",
        "operation-1",
      ),
    ).toEqual([
      {
        ...parent,
        trashedAt: "2026-07-25T00:00:00.000Z",
        trashOperationId: "operation-1",
      },
      {
        ...child,
        trashedAt: "2026-07-25T00:00:00.000Z",
        trashOperationId: "operation-1",
      },
      separatelyTrashedChild,
    ]);
  });

  it("optimistically trashes a Task and then accepts the server snapshot", async () => {
    const initialSnapshot = productionSnapshot();
    const trashedSnapshot = {
      ...initialSnapshot,
      tasks: initialSnapshot.tasks.map((candidate) => ({
        ...candidate,
        trashedAt: "2026-07-29T00:00:00.000Z",
        trashOperationId: "operation-1",
        version: 2,
      })),
    };
    let resolveTrash: (snapshot: BootstrapResponse) => void = () => {
      throw new Error("Trash response resolver was not initialized");
    };
    const trashResponse = new Promise<BootstrapResponse>((resolve) => {
      resolveTrash = resolve;
    });
    api.loadBootstrap.mockResolvedValue(initialSnapshot);
    api.trashTask.mockReturnValue(trashResponse);

    const user = userEvent.setup();
    render(
      createElement(
        BootstrapProvider,
        null,
        createElement(
          AppSettingsProvider,
          null,
          createElement(
            TaskStoreProvider,
            null,
            createElement(ProductionTrashFixture),
          ),
        ),
      ),
    );

    await screen.findByText("Active");
    await user.click(screen.getByRole("button", { name: "Trash" }));
    expect(screen.getByText("Trashed v1")).toBeInTheDocument();
    expect(api.trashTask).toHaveBeenCalledWith("active", { version: 1 });

    resolveTrash(trashedSnapshot);
    expect(await screen.findByText("Trashed v2")).toBeInTheDocument();
  });

  it("rolls back only a failed Today Order after a newer snapshot arrives", async () => {
    const initialSnapshot = productionSnapshot();
    let rejectReorder: (error: unknown) => void = () => {
      throw new Error("Today Order rejection was not initialized");
    };
    const reorderResponse = new Promise<never>((_resolve, reject) => {
      rejectReorder = reject;
    });
    api.loadBootstrap.mockResolvedValue(initialSnapshot);
    api.reorderToday.mockReturnValue(reorderResponse);

    const user = userEvent.setup();
    render(
      createElement(
        BootstrapProvider,
        null,
        createElement(
          AppSettingsProvider,
          null,
          createElement(
            TaskStoreProvider,
            null,
            createElement(ConcurrentTodayRollbackFixture),
          ),
        ),
      ),
    );

    await screen.findByText("Active|30|");
    await user.click(screen.getByRole("button", { name: "Reorder Today" }));
    expect(screen.getByText("Active|30|active")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Apply newer snapshot" }),
    );
    expect(screen.getByText("Latest title|14|active")).toBeInTheDocument();

    rejectReorder(new api.ApiRequestError(500));

    expect(await screen.findByText("Latest title|14|")).toBeInTheDocument();
  });

  it("synchronously replaces the Task list when the bootstrap snapshot changes", async () => {
    const user = userEvent.setup();
    const renderStates: string[] = [];

    render(
      createElement(
        BootstrapProvider,
        { initialSnapshot: productionSnapshot() },
        createElement(
          AppSettingsProvider,
          null,
          createElement(
            TaskStoreProvider,
            null,
            createElement(SnapshotReplacementFixture, { renderStates }),
          ),
        ),
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Replace bootstrap snapshot" }),
    );

    expect(renderStates).not.toContain(
      `${testAreaIds.music}|${testAreaIds.develop}`,
    );
  });

  it("uses the Owner timezone for Completed today", () => {
    const completed = task({
      status: "COMPLETED",
      completedAt: "2026-07-25T00:30:00.000Z",
    });

    expect(isCompletedToday(completed, [], "Asia/Tokyo", "2026-07-25")).toBe(
      true,
    );
    expect(
      isCompletedToday(completed, [], "America/Los_Angeles", "2026-07-24"),
    ).toBe(true);
  });
});

function productionSnapshot(): BootstrapResponse {
  return {
    areas: [
      {
        id: testAreaIds.develop,
        name: "Develop",
        color: "purple",
        position: 1,
        isSystemManaged: false,
        trashedAt: null,
      },
    ],
    ownerSettings: {
      displayLanguage: "en",
      timeZone: "Asia/Tokyo",
      weekStartsOn: 0,
      trashRetentionDays: 30,
      version: 1,
    },
    tags: [],
    tasks: [
      {
        id: "active",
        title: "Active",
        path: ["Develop", "Active"],
        areaId: testAreaIds.develop,
        status: "OPEN",
        start: null,
        due: null,
        completedAt: null,
        updatedAt: "2026-08-05T00:00:00.000Z",
        tags: [],
        description: "",
        workNotes: "",
        trashedAt: null,
        trashOperationId: null,
        version: 1,
      },
    ],
    areaTaskOrders: {},
    inboxOrder: [],
    todayOrders: {},
    views: [],
  };
}

function ProductionTrashFixture() {
  const { tasks, trashTask } = useTaskStore();
  const task = tasks[0];
  if (task.trashedAt) {
    return createElement("p", null, `Trashed v${task.version}`);
  }
  return createElement(
    "div",
    null,
    createElement("p", null, task.title),
    createElement(
      "button",
      { type: "button", onClick: () => trashTask(task.id) },
      "Trash",
    ),
  );
}

function ConcurrentTodayRollbackFixture() {
  const { snapshot, replaceSnapshot } = useBootstrap();
  const { reorderToday, tasks, todayOrder } = useTaskStore();

  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", onClick: () => reorderToday(["active"]) },
      "Reorder Today",
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () =>
          replaceSnapshot({
            ...snapshot,
            ownerSettings: {
              ...snapshot.ownerSettings,
              trashRetentionDays: 14,
            },
            tasks: snapshot.tasks.map((task) => ({
              ...task,
              title: "Latest title",
            })),
          }),
      },
      "Apply newer snapshot",
    ),
    createElement(
      "output",
      null,
      `${tasks[0]?.title}|${snapshot.ownerSettings.trashRetentionDays}|${todayOrder.join(",")}`,
    ),
  );
}

function SnapshotReplacementFixture({
  renderStates,
}: {
  renderStates: string[];
}) {
  const { snapshot, replaceSnapshot } = useBootstrap();
  const { tasks } = useTaskStore();
  renderStates.push(`${snapshot.tasks[0]?.areaId}|${tasks[0]?.areaId}`);

  return createElement(
    "button",
    {
      type: "button",
      onClick: () =>
        replaceSnapshot({
          ...snapshot,
          tasks: snapshot.tasks.map((task) => ({
            ...task,
            areaId: testAreaIds.music,
          })),
        }),
    },
    "Replace bootstrap snapshot",
  );
}
