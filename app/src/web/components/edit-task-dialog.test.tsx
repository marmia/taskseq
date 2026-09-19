import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  type ActionFunctionArgs,
  createMemoryRouter,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../domain/task";
import { applyDisplayLanguage } from "../i18n";
import type { TaskMutationResult } from "../router";
import { TaskStoreProvider, useTaskStore } from "../task-store";
import {
  AppSettingsProvider,
  taskMutationTestAction,
  testAreaIds,
  testSnapshot,
} from "../test/providers";
import { EditTaskDialog } from "./edit-task-dialog";

const taskId = "task-ui-prototype";
const japaneseSnapshot = {
  ...testSnapshot,
  ownerSettings: {
    ...testSnapshot.ownerSettings,
    displayLanguage: "ja" as const,
  },
};

afterEach(() => {
  applyDisplayLanguage("en");
});

function testInbox() {
  const inbox = testSnapshot.areas.find((area) => area.isSystemManaged);
  if (!inbox) throw new Error("Test Inbox Area is not configured");
  return inbox;
}

function UpdatedTaskTiming() {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.id === taskId);

  return task ? <output>{`${task.start}|${task.due}`}</output> : null;
}

function UpdatedTaskArea() {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.id === taskId);

  return task ? (
    <output aria-label="updated-area">
      {`${task.areaId}|${task.parentId ?? "Area root"}`}
    </output>
  ) : null;
}

function UpdatedTaskPath() {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.id === taskId);

  return task ? (
    <output aria-label="updated-path">{task.path.join(" / ")}</output>
  ) : null;
}

function StoreEditTaskDialog() {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) return null;

  return <EditTaskDialog task={task} open onOpenChange={vi.fn()} />;
}

function ClosableEditTaskFixture() {
  const task = testSnapshot.tasks.find((candidate) => candidate.id === taskId);
  const [open, setOpen] = useState(false);
  if (!task) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open edit dialog
      </button>
      <EditTaskDialog task={task} open={open} onOpenChange={setOpen} />
    </>
  );
}

function renderEditTaskDialog(
  task: Task,
  action: (
    args: ActionFunctionArgs,
  ) =>
    | TaskMutationResult
    | Promise<TaskMutationResult> = taskMutationTestAction,
  initialSnapshot = testSnapshot,
  onOpenChange = vi.fn(),
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <EditTaskDialog task={task} open onOpenChange={onOpenChange} />
            <UpdatedTaskTiming />
            <UpdatedTaskArea />
            <UpdatedTaskPath />
          </>
        ),
      },
      { path: "/task-mutations", action },
    ],
    { initialEntries: ["/"] },
  );

  return render(
    <AppSettingsProvider initialSnapshot={initialSnapshot}>
      <TaskStoreProvider>
        <RouterProvider router={router} />
      </TaskStoreProvider>
    </AppSettingsProvider>,
  );
}

function renderEditTaskElement(
  element: React.ReactNode,
  initialSnapshot = testSnapshot,
) {
  const router = createMemoryRouter(
    [
      { path: "/", element },
      { path: "/task-mutations", action: taskMutationTestAction },
    ],
    { initialEntries: ["/"] },
  );

  return render(
    <AppSettingsProvider initialSnapshot={initialSnapshot}>
      <TaskStoreProvider>
        <RouterProvider router={router} />
      </TaskStoreProvider>
    </AppSettingsProvider>,
  );
}

async function chooseDate(
  user: ReturnType<typeof userEvent.setup>,
  label: "Start" | "Due",
  value: string,
) {
  await user.click(screen.getByRole("button", { name: label }));
  const calendar = screen.getByRole("dialog", { name: `${label} calendar` });
  const targetMonth = Date.parse(`${value.slice(0, 7)}-01T00:00:00Z`);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const dayCell = calendar.querySelector<HTMLElement>(
      `[data-day="${value}"]:not([data-outside])`,
    );
    const dayButton = dayCell?.querySelector<HTMLButtonElement>("button");
    if (dayButton) {
      await user.click(dayButton);
      await user.click(within(calendar).getByRole("button", { name: "Done" }));
      return;
    }

    const grid = within(calendar).getByRole("grid");
    const monthLabel = grid.getAttribute("aria-label") ?? "";
    const match = monthLabel.match(/^([A-Za-z]+) (\d{4})$/);
    if (!match) throw new Error(`Unexpected calendar month: ${monthLabel}`);
    const displayedMonth = Date.parse(`${match[1]} 1, ${match[2]} UTC`);
    await user.click(
      within(calendar).getByRole("button", {
        name: targetMonth < displayedMonth ? "Previous month" : "Next month",
      }),
    );
  }

  throw new Error(`Could not select ${value} in ${label} calendar`);
}

async function enableTime(
  user: ReturnType<typeof userEvent.setup>,
  label: "Start" | "Due",
) {
  await user.click(screen.getByRole("button", { name: label }));
  const calendar = screen.getByRole("dialog", { name: `${label} calendar` });
  const checkbox = within(calendar).getByRole("checkbox", {
    name: `Set time for ${label}`,
  }) as HTMLInputElement;
  if (!checkbox.checked) await user.click(checkbox);
  return calendar;
}

describe("EditTaskDialog", () => {
  it("localizes Edit Task authoring UI in Japanese while preserving Task data", () => {
    const task = japaneseSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");

    renderEditTaskDialog(task, taskMutationTestAction, japaneseSnapshot);

    const dialog = screen.getByRole("dialog", { name: "タスクを編集" });
    expect(
      within(dialog).getByText("タスクの内容、日時、タグを編集します。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "タイトル" }),
    ).toHaveValue("UI prototype");
    expect(
      within(dialog).getByRole("textbox", { name: "タイトル" }),
    ).toHaveAttribute("placeholder", "タスクのタイトル");
    expect(
      within(dialog).getByRole("textbox", { name: "説明" }),
    ).toHaveAttribute("placeholder", "説明");
    expect(
      within(dialog).getByRole("combobox", { name: "エリア" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("combobox", { name: "タスクパス" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "開始" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "期限" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "繰り返し" }),
    ).toHaveAttribute("placeholder", "繰り返しを追加");
    expect(
      within(dialog).getByRole("combobox", { name: "タグ" }),
    ).toHaveAttribute("placeholder", "タグを追加");
    expect(
      within(dialog).getByRole("textbox", { name: "作業メモ" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "作業メモを展開" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Ctrl + Enterで保存")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "変更を保存" }),
    ).toBeInTheDocument();
  });

  it("uses the compact field order and starts Work Notes collapsed", () => {
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");

    renderEditTaskDialog(task);

    const dialog = screen.getByRole("dialog", { name: "Edit Task" });
    const fields = [
      within(dialog).getByRole("textbox", { name: "Title" }),
      within(dialog).getByRole("textbox", { name: "Description" }),
      within(dialog).getByRole("combobox", { name: "Area" }),
      within(dialog).getByRole("combobox", { name: "Task Path" }),
      within(dialog).getByRole("button", { name: "Start" }),
      within(dialog).getByRole("button", { name: "Due" }),
      within(dialog).getByRole("textbox", { name: "Repeat" }),
      within(dialog).getByRole("combobox", { name: "Tags" }),
      within(dialog).getByRole("textbox", { name: "Work Notes" }),
    ];

    for (const [index, field] of fields.entries()) {
      const nextField = fields[index + 1];
      if (!nextField) continue;
      expect(
        field.compareDocumentPosition(nextField) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    expect(
      within(dialog).getByRole("textbox", { name: "Description" }),
    ).toHaveAttribute("rows", "1");
    expect(
      within(dialog).getByRole("textbox", { name: "Work Notes" }),
    ).toHaveAttribute("rows", "3");
    expect(
      within(dialog).getByRole("button", { name: "Expand Work Notes" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "Description" }),
    ).toHaveClass("text-base", "min-[560px]:text-sm");
    expect(within(dialog).getByRole("textbox", { name: "Repeat" })).toHaveClass(
      "text-base",
      "min-[560px]:text-sm",
    );
    expect(within(dialog).getByRole("combobox", { name: "Tags" })).toHaveClass(
      "max-[559px]:text-base",
    );
    expect(
      within(dialog).getByRole("textbox", { name: "Work Notes" }),
    ).toHaveClass("text-base", "min-[560px]:text-sm");
  });

  it("expands Description to three lines and scrolls longer content", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");

    renderEditTaskDialog(task);

    const description = screen.getByRole("textbox", {
      name: "Description",
    }) as HTMLTextAreaElement;
    Object.defineProperty(description, "scrollHeight", {
      configurable: true,
      get: () => Math.max(20, description.value.split("\n").length * 20),
    });

    await user.type(description, "one\ntwo\nthree\nfour");

    expect(description).toHaveStyle({ height: "60px", overflowY: "auto" });
  });

  it("preserves Work Notes content and selection while expanding and collapsing", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");

    renderEditTaskDialog(task);

    const workNotes = screen.getByRole("textbox", {
      name: "Work Notes",
    }) as HTMLTextAreaElement;
    await user.clear(workNotes);
    await user.type(workNotes, "preserve this note");
    workNotes.setSelectionRange(2, 9);

    await user.click(screen.getByRole("button", { name: "Expand Work Notes" }));

    expect(workNotes).toHaveAttribute("rows", "8");
    expect(workNotes).toHaveValue("preserve this note");
    expect(workNotes.selectionStart).toBe(2);
    expect(workNotes.selectionEnd).toBe(9);

    await user.click(
      screen.getByRole("button", { name: "Collapse Work Notes" }),
    );

    expect(workNotes).toHaveAttribute("rows", "3");
    expect(workNotes).toHaveValue("preserve this note");
    expect(workNotes.selectionStart).toBe(2);
    expect(workNotes.selectionEnd).toBe(9);
  });

  it("resets Work Notes to three lines after the dialog is reopened", async () => {
    const user = userEvent.setup();

    renderEditTaskElement(<ClosableEditTaskFixture />);

    await user.click(screen.getByRole("button", { name: "Open edit dialog" }));
    await user.click(screen.getByRole("button", { name: "Expand Work Notes" }));
    expect(screen.getByRole("textbox", { name: "Work Notes" })).toHaveAttribute(
      "rows",
      "8",
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Open edit dialog" }));

    expect(screen.getByRole("textbox", { name: "Work Notes" })).toHaveAttribute(
      "rows",
      "3",
    );
    expect(
      screen.getByRole("button", { name: "Expand Work Notes" }),
    ).toBeInTheDocument();
  });

  it("closes child UI, moves focus to the dialog, then closes on Escape", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");
    const onOpenChange = vi.fn();

    renderEditTaskDialog(
      task,
      taskMutationTestAction,
      testSnapshot,
      onOpenChange,
    );

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Start calendar" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Edit Task" })).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("closes Tags suggestions and keeps focus on the Tags input on Escape", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");

    renderEditTaskDialog(task);

    const tags = screen.getByRole("combobox", { name: "Tags" });
    await user.click(tags);
    expect(
      screen.getByRole("button", { name: "cloudflare" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("button", { name: "cloudflare" }),
    ).not.toBeInTheDocument();
    expect(tags).toHaveFocus();
  });

  it("submits with Control+Enter", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");
    const action = vi.fn(taskMutationTestAction);

    renderEditTaskDialog(task, action);

    expect(screen.getByText("Ctrl + Enter to save")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Shortcut");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("saves Description and Work Notes from the compact form", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");
    let payload: Record<string, unknown> | undefined;

    renderEditTaskDialog(task, async ({ request }) => {
      const formData = await request.formData();
      payload = JSON.parse(String(formData.get("payload")));
      return { snapshot: testSnapshot };
    });

    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Updated description",
    );
    await user.clear(screen.getByRole("textbox", { name: "Work Notes" }));
    await user.type(
      screen.getByRole("textbox", { name: "Work Notes" }),
      "Updated work notes",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(payload).toEqual(
        expect.objectContaining({
          description: "Updated description",
          workNotes: "Updated work notes",
        }),
      );
    });
  });

  it("shows every invalid field and clears only the corrected field", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");

    renderEditTaskDialog(task);

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await chooseDate(user, "Start", "2026-08-20");
    await chooseDate(user, "Due", "2026-08-19");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(screen.getByText("Title is required")).toBeInTheDocument();
    expect(
      screen.getByText("Due must be on or after Start"),
    ).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Fixed");

    expect(screen.queryByText("Title is required")).not.toBeInTheDocument();
    expect(
      screen.getByText("Due must be on or after Start"),
    ).toBeInTheDocument();

    await chooseDate(user, "Due", "2026-08-21");

    expect(
      screen.queryByText("Due must be on or after Start"),
    ).not.toBeInTheDocument();
  });

  it("blocks Repeat for a Task that already has a Subtask", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === "task-task-management-mvp",
    );
    if (!task) throw new Error("Parent Task fixture was not found");
    const action = vi.fn(taskMutationTestAction);

    renderEditTaskDialog(task, action);

    await chooseDate(user, "Start", "2026-08-24");
    await user.type(screen.getByRole("textbox", { name: "Repeat" }), "day");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      screen.getByText(
        "A Task with Subtasks cannot be recurring. Move the Subtasks or send them to Trash first.",
      ),
    ).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("allows Repeat when every Subtask is already in Trash", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === "task-task-management-mvp",
    );
    if (!task) throw new Error("Parent Task fixture was not found");
    const action = vi.fn(taskMutationTestAction);
    const initialSnapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((candidate) =>
        candidate.id !== task.id &&
        candidate.path.length > task.path.length &&
        task.path.every((segment, index) => candidate.path[index] === segment)
          ? { ...candidate, trashedAt: "2026-08-23T00:00:00.000Z" }
          : candidate,
      ),
    };

    renderEditTaskDialog(task, action, initialSnapshot);

    await chooseDate(user, "Start", "2026-08-24");
    await user.type(screen.getByRole("textbox", { name: "Repeat" }), "day");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(
        "A Task with Subtasks cannot be recurring. Move the Subtasks or send them to Trash first.",
      ),
    ).not.toBeInTheDocument();
  });

  it("initializes date-only values with time settings off and saves enabled times", async () => {
    const user = userEvent.setup();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: "2026-08-15",
      due: "2026-08-16",
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [{ id: 7, name: "prototype" }],
      description: "",
      workNotes: "",
      version: 1,
    };

    renderEditTaskDialog(task);

    expect(screen.getByRole("button", { name: "Start" })).toHaveTextContent(
      "2026/08/15",
    );
    expect(screen.getByRole("button", { name: "Due" })).toHaveTextContent(
      "2026/08/16",
    );

    const startCalendar = await enableTime(user, "Start");
    await user.selectOptions(
      within(startCalendar).getByRole("combobox", { name: "Start hour" }),
      "09",
    );
    await user.selectOptions(
      within(startCalendar).getByRole("combobox", { name: "Start minute" }),
      "15",
    );
    await user.click(
      within(startCalendar).getByRole("button", { name: "Done" }),
    );
    const dueCalendar = await enableTime(user, "Due");
    await user.selectOptions(
      within(dueCalendar).getByRole("combobox", { name: "Due hour" }),
      "17",
    );
    await user.selectOptions(
      within(dueCalendar).getByRole("combobox", { name: "Due minute" }),
      "45",
    );
    await user.click(within(dueCalendar).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(
        "2026-08-15T09:15:00.000+09:00|2026-08-16T17:45:00.000+09:00",
      ),
    ).toBeInTheDocument();
  });

  it("initializes timestamps in Owner local time and removes time when disabled", async () => {
    const user = userEvent.setup();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: "2026-08-15T09:15:00.000+09:00",
      due: "2026-08-16T17:42:00.000+09:00",
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [{ id: 7, name: "prototype" }],
      description: "",
      workNotes: "",
      version: 1,
    };

    renderEditTaskDialog(task);

    expect(screen.getByRole("button", { name: "Start" })).toHaveTextContent(
      "2026/08/15",
    );
    const startCalendar = await enableTime(user, "Start");
    expect(
      within(startCalendar).getByRole("combobox", { name: "Start hour" }),
    ).toHaveValue("09");
    expect(
      within(startCalendar).getByRole("combobox", { name: "Start minute" }),
    ).toHaveValue("15");
    await user.click(
      within(startCalendar).getByRole("checkbox", {
        name: "Set time for Start",
      }),
    );
    await user.click(
      within(startCalendar).getByRole("button", { name: "Done" }),
    );

    expect(screen.getByRole("button", { name: "Due" })).toHaveTextContent(
      "2026/08/16",
    );
    const dueCalendar = await enableTime(user, "Due");
    expect(
      within(dueCalendar).getByRole("combobox", { name: "Due hour" }),
    ).toHaveValue("17");
    expect(
      within(dueCalendar).getByRole("combobox", { name: "Due minute" }),
    ).toHaveValue("42");
    expect(
      within(dueCalendar).getByRole("option", { name: "42 (existing)" }),
    ).toBeDisabled();

    await user.click(
      within(dueCalendar).getByRole("checkbox", { name: "Set time for Due" }),
    );
    await user.click(within(dueCalendar).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText("2026-08-15|2026-08-16"),
    ).toBeInTheDocument();
  });

  it("submits the stable Tag ID when saving an existing Tag", async () => {
    const user = userEvent.setup();
    let payload: Record<string, unknown> | undefined;
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: null,
      due: null,
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [{ id: 7, name: "prototype" }],
      description: "",
      workNotes: "",
      version: 1,
    };

    renderEditTaskDialog(task, async ({ request }) => {
      const formData = await request.formData();
      payload = JSON.parse(String(formData.get("payload")));
      return { snapshot: testSnapshot };
    });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(payload).toEqual(
        expect.objectContaining({ tagIds: [7], newTagNames: [] }),
      );
    });
  });

  it("selects an active Area and replaces the Task from the success snapshot", async () => {
    const user = userEvent.setup();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: null,
      due: null,
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [],
      description: "",
      workNotes: "",
      version: 1,
    };

    renderEditTaskDialog(task);

    const area = screen.getByRole("combobox", { name: "Area" });
    expect(area).toHaveValue(String(testAreaIds.develop));
    expect(screen.getByRole("option", { name: "Music" })).toBeEnabled();

    await user.selectOptions(area, String(testAreaIds.music));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(`${testAreaIds.music}|Area root`),
    ).toBeInTheDocument();
  });

  it("moves a Task to the Area root within the current Area", async () => {
    const user = userEvent.setup();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: null,
      due: null,
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [],
      description: "",
      workNotes: "",
      version: 1,
    };

    renderEditTaskDialog(task);

    const taskPath = screen.getByRole("combobox", { name: "Task Path" });
    expect(taskPath).toHaveValue("task-task-management-mvp");

    await user.selectOptions(taskPath, "");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(`${testAreaIds.develop}|Area root`),
    ).toBeInTheDocument();
  });

  it("resets Task Path for the selected Area and saves the selected parent", async () => {
    const user = userEvent.setup();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: null,
      due: null,
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [],
      description: "",
      workNotes: "",
      version: 1,
    };

    renderEditTaskDialog(task);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Area" }),
      String(testAreaIds.music),
    );
    const taskPath = screen.getByRole("combobox", { name: "Task Path" });
    expect(taskPath).toHaveValue("");
    expect(screen.getByRole("option", { name: "Summer EP" })).toBeEnabled();

    await user.selectOptions(taskPath, "task-summer-ep");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(`${testAreaIds.music}|task-summer-ep`),
    ).toBeInTheDocument();
  });

  it("offers Inbox Tasks as a destination Task Path", async () => {
    const user = userEvent.setup();
    const inbox = testInbox();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: null,
      due: null,
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [],
      description: "",
      workNotes: "",
      version: 1,
    };

    renderEditTaskDialog(task);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Area" }),
      String(inbox.id),
    );

    const taskPath = screen.getByRole("combobox", { name: "Task Path" });
    expect(taskPath).toBeEnabled();
    expect(taskPath).toHaveValue("");
    expect(taskPath).toHaveTextContent("歯科検診を予約する");
  });

  it("moves a Task to Inbox and replaces the success snapshot", async () => {
    const user = userEvent.setup();
    const inbox = testInbox();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: null,
      due: null,
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [],
      description: "",
      workNotes: "",
      version: 1,
    };
    const serverSnapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((candidate) =>
        candidate.id === taskId
          ? {
              ...candidate,
              areaId: inbox.id,
              parentId: undefined,
              path: ["Inbox", "Server snapshot root"],
              version: 2,
            }
          : candidate,
      ),
    };

    renderEditTaskDialog(task, async () => ({ snapshot: serverSnapshot }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Area" }),
      String(inbox.id),
    );
    expect(screen.getByRole("combobox", { name: "Task Path" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(`${inbox.id}|Area root`),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("updated-path")).toHaveTextContent(
      "Inbox / Server snapshot root",
    );
  });

  it("disables saving while an Inbox move is pending", async () => {
    const user = userEvent.setup();
    const inbox = testInbox();
    const task: Task = {
      id: taskId,
      title: "UI prototype",
      path: ["Develop", "Taskseq MVP", "UI prototype"],
      areaId: testAreaIds.develop,
      parentId: "task-task-management-mvp",
      status: "OPEN",
      start: null,
      due: null,
      completedAt: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
      tags: [],
      description: "",
      workNotes: "",
      version: 1,
    };
    let resolveAction: (result: TaskMutationResult) => void = () => {
      throw new Error("Action resolver was not initialized");
    };

    renderEditTaskDialog(
      task,
      () =>
        new Promise<TaskMutationResult>((resolve) => {
          resolveAction = resolve;
        }),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Area" }),
      String(inbox.id),
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeDisabled(),
    );
    resolveAction({
      failure: {
        type: "warning",
        message: "Destination Inbox is unavailable.",
      },
    });
    expect(
      await screen.findByLabelText(
        "Warning notification: Destination Inbox is unavailable.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the draft and persisted Task after a failure, then retries from Save Changes", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");
    let attempts = 0;

    renderEditTaskDialog(task, async (args) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          failure: {
            type: "error",
            message:
              "Could not save changes to “Draft edit”. Try again from Save Changes.",
          },
        };
      }
      return taskMutationTestAction(args);
    });

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Draft edit",
    );
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Keep this edit",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByLabelText(
        "Error notification: Could not save changes to “Draft edit”. Try again from Save Changes.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Edit Task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Draft edit",
    );
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Keep this edit",
    );
    expect(screen.getByLabelText("updated-path")).toHaveTextContent(
      task.path.join(" / "),
    );

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByLabelText("updated-path")).toHaveTextContent(
      "Develop / Taskseq MVP / Draft edit",
    );
    expect(attempts).toBe(2);
  });

  it("keeps the edit draft while a conflict reloads the persisted Task", async () => {
    const user = userEvent.setup();
    const task = testSnapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) throw new Error("Task fixture was not found");
    const latestSnapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((candidate) =>
        candidate.id === taskId
          ? {
              ...candidate,
              title: "Latest server title",
              path: [...candidate.path.slice(0, -1), "Latest server title"],
              version: (candidate.version ?? 0) + 1,
            }
          : candidate,
      ),
    };

    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <>
              <StoreEditTaskDialog />
              <UpdatedTaskPath />
            </>
          ),
        },
        {
          path: "/task-mutations",
          action: async () => ({
            snapshot: latestSnapshot,
            failure: {
              type: "warning" as const,
              message:
                "“Draft conflict” changed elsewhere. Review the latest Task before saving again.",
            },
          }),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>,
    );

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Draft conflict",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByLabelText(
        "Warning notification: “Draft conflict” changed elsewhere. Review the latest Task before saving again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("updated-path")).toHaveTextContent(
      "Develop / Taskseq MVP / Latest server title",
    );
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Draft conflict",
    );
  });
});
