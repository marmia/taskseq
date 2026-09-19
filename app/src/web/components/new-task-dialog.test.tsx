import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  type ActionFunction,
  createMemoryRouter,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootstrapProvider } from "../bootstrap-state";
import { applyDisplayLanguage } from "../i18n";
import {
  AppSettingsProvider as ProductionAppSettingsProvider,
  useAppSettings,
} from "../settings-store";
import { TaskStoreProvider, useTaskStore } from "../task-store";
import {
  taskMutationTestAction,
  testAreaIds,
  testSnapshot,
} from "../test/providers";
import { NewTaskDialog } from "./new-task-dialog";

const serverTag = { id: 11, name: "server-tag" };
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

function CreatedTaskPath({ title = "Dialog test" }: { title?: string }) {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.title === title);

  return task ? <output>{task.path.join(" / ")}</output> : null;
}

function TaskStoreState() {
  const { tasks, inboxOrder } = useTaskStore();
  const { tags } = useAppSettings();

  return (
    <output data-testid="task-store-state">
      {JSON.stringify({
        taskIds: tasks.map((task) => task.id),
        inboxOrder,
        tags,
      })}
    </output>
  );
}

function InboxTreeStoreState() {
  const { tasks, areaTaskOrders, inboxOrder } = useTaskStore();
  const subtask = tasks.find((task) => task.title === "Server Inbox Subtask");

  return (
    <output data-testid="inbox-tree-store-state">
      {JSON.stringify({
        subtask: subtask
          ? { id: subtask.id, parentId: subtask.parentId, path: subtask.path }
          : null,
        inboxOrder,
        areaTaskOrders,
      })}
    </output>
  );
}

function CreatedTaskStart() {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.title === "Date-only test");

  return task ? <output>{task.start}</output> : null;
}

function CreatedTaskTiming({ title }: { title: string }) {
  const { tasks } = useTaskStore();
  const task = tasks.find((candidate) => candidate.title === title);

  return task ? <output>{`${task.start}|${task.due}`}</output> : null;
}

function TimezoneNewTaskFixture() {
  const { setOwnerTimeZone } = useAppSettings();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOwnerTimeZone("America/Los_Angeles")}
      >
        Change timezone
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <NewTaskDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ClosableNewTaskFixture() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <NewTaskDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function renderTaskDialog(
  element: React.ReactNode,
  action: ActionFunction = taskMutationTestAction,
  snapshot = testSnapshot,
) {
  const router = createMemoryRouter(
    [
      { path: "/", element },
      { path: "/task-mutations", action },
    ],
    { initialEntries: ["/"] },
  );

  return render(
    <BootstrapProvider initialSnapshot={snapshot}>
      <ProductionAppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </ProductionAppSettingsProvider>
    </BootstrapProvider>,
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

describe("NewTaskDialog", () => {
  it("localizes New Task authoring UI and validation in Japanese", async () => {
    const user = userEvent.setup();

    renderTaskDialog(
      <NewTaskDialog open onOpenChange={vi.fn()} />,
      taskMutationTestAction,
      japaneseSnapshot,
    );

    const dialog = screen.getByRole("dialog", { name: "新しいタスク" });
    expect(
      within(dialog).getByText("エリアまたはInboxにタスクを作成します。"),
    ).toBeInTheDocument();
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
    ).toHaveValue("");
    expect(
      within(dialog).getByRole("button", { name: "開始" }),
    ).toHaveTextContent("日付と時刻を追加");
    expect(
      within(dialog).getByRole("button", { name: "期限" }),
    ).toHaveTextContent("日付と時刻を追加");
    expect(
      within(dialog).getByRole("textbox", { name: "繰り返し" }),
    ).toHaveAttribute("placeholder", "繰り返しを追加");
    expect(
      within(dialog).getByRole("combobox", { name: "タグ" }),
    ).toHaveAttribute("placeholder", "タグを追加");
    expect(
      within(dialog).getByRole("button", { name: "繰り返しの構文" }),
    ).toBeInTheDocument();
    await user.hover(
      within(dialog).getByRole("button", { name: "繰り返しの構文" }),
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("毎日");
    expect(within(dialog).getByText("Ctrl + Enterで追加")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "タスクを追加" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "タスクを追加" }),
    );
    expect(within(dialog).getByText("タイトルは必須です")).toBeInTheDocument();
  });

  it("localizes Add Subtask without translating the parent Task title", () => {
    const parent = japaneseSnapshot.tasks.find(
      (task) => task.title === "歯科検診を予約する",
    );
    if (!parent) throw new Error("Parent Task fixture was not found");

    renderTaskDialog(
      <NewTaskDialog open onOpenChange={vi.fn()} parentTask={parent} />,
      taskMutationTestAction,
      japaneseSnapshot,
    );

    const dialog = screen.getByRole("dialog", { name: "サブタスクを追加" });
    expect(
      within(dialog).getByText(
        "「歯科検診を予約する」の下にサブタスクを追加します。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("combobox", { name: "エリア" }),
    ).toHaveDisplayValue("Inbox");
    expect(
      within(dialog).getByRole("combobox", { name: "タスクパス" }),
    ).toHaveDisplayValue("歯科検診を予約する");
  });

  it("uses the desktop calendar controls for Add Subtask Start and Due", async () => {
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 1024,
      });
      const user = userEvent.setup();
      const parent = testSnapshot.tasks.find((task) => task.id === "inbox-1");
      if (!parent) throw new Error("Inbox fixture Task was not found");

      renderTaskDialog(
        <NewTaskDialog open onOpenChange={vi.fn()} parentTask={parent} />,
      );

      const dialog = screen.getByRole("dialog", { name: "Add Subtask" });
      await chooseDate(user, "Start", "2026-08-15");
      const startCalendar = await enableTime(user, "Start");
      expect(startCalendar).toHaveStyle({ width: "360px" });
      expect(
        within(startCalendar).getByRole("combobox", { name: "Start hour" }),
      ).toBeInTheDocument();
      await user.selectOptions(
        within(startCalendar).getByRole("combobox", { name: "Start hour" }),
        "10",
      );
      await user.click(
        within(startCalendar).getByRole("button", { name: "Done" }),
      );

      await chooseDate(user, "Due", "2026-08-16");
      const dueCalendar = await enableTime(user, "Due");
      expect(dueCalendar).toHaveStyle({ width: "360px" });
      expect(
        within(dueCalendar).getByRole("combobox", { name: "Due minute" }),
      ).toBeInTheDocument();
      await user.click(
        within(dueCalendar).getByRole("button", { name: "Done" }),
      );
      expect(
        within(dialog).getByRole("button", { name: "Start" }),
      ).toHaveTextContent("2026/08/15 10:00");
      expect(
        within(dialog).getByRole("button", { name: "Due" }),
      ).toHaveTextContent("2026/08/16 00:00");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  }, 15_000);

  it("uses the compact field order for New Task", () => {
    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "New Task" });
    const fields = [
      within(dialog).getByRole("textbox", { name: "Title" }),
      within(dialog).getByRole("textbox", { name: "Description" }),
      within(dialog).getByRole("combobox", { name: "Area" }),
      within(dialog).getByRole("combobox", { name: "Task Path" }),
      within(dialog).getByRole("button", { name: "Start" }),
      within(dialog).getByRole("button", { name: "Due" }),
      within(dialog).getByRole("textbox", { name: "Repeat" }),
      within(dialog).getByRole("combobox", { name: "Tags" }),
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
      within(dialog).getByRole("textbox", { name: "Description" }),
    ).toHaveClass("text-base", "min-[560px]:text-sm");
    expect(within(dialog).getByRole("textbox", { name: "Repeat" })).toHaveClass(
      "text-base",
      "min-[560px]:text-sm",
    );
    expect(within(dialog).getByRole("combobox", { name: "Tags" })).toHaveClass(
      "max-[559px]:text-base",
    );
  });

  it("expands Description to three lines and scrolls longer content", async () => {
    const user = userEvent.setup();

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

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

  it("submits with Control+Enter", async () => {
    const user = userEvent.setup();
    const action = vi.fn(taskMutationTestAction);

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />, action);

    expect(screen.getByText("Ctrl + Enter to add")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Shortcut");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("moves focus to the dialog before Escape closes it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderTaskDialog(<NewTaskDialog open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("textbox", { name: "Title" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "New Task" })).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows every invalid field and clears only the corrected field", async () => {
    const user = userEvent.setup();

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    await chooseDate(user, "Start", "2026-08-20");
    await chooseDate(user, "Due", "2026-08-19");
    await user.click(screen.getByRole("button", { name: "Add Task" }));

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

  it("clears field validation when the dialog closes", async () => {
    const user = userEvent.setup();

    renderTaskDialog(<ClosableNewTaskFixture />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.click(screen.getByRole("button", { name: "Add Task" }));
    expect(screen.getByText("Title is required")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    expect(screen.queryByText("Title is required")).not.toBeInTheDocument();
  });

  it("shows API validation at its field and clears it when corrected", async () => {
    const user = userEvent.setup();

    renderTaskDialog(
      <NewTaskDialog open onOpenChange={vi.fn()} />,
      async () => ({
        failure: {
          type: "validation" as const,
          fieldErrors: {
            title: "Title is not accepted.",
            tags: "Select valid Tags.",
          },
        },
      }),
    );

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Draft");
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByText("Title is not accepted."),
    ).toBeInTheDocument();
    expect(screen.getByText("Select valid Tags.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Title" }), " fixed");

    expect(
      screen.queryByText("Title is not accepted."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Select valid Tags.")).toBeInTheDocument();

    await user.type(screen.getByRole("combobox", { name: "Tags" }), "fixed");

    expect(screen.queryByText("Select valid Tags.")).not.toBeInTheDocument();
  });

  it("marks an API field error as English inside the Japanese dialog", async () => {
    const user = userEvent.setup();

    renderTaskDialog(
      <NewTaskDialog open onOpenChange={vi.fn()} />,
      async () => ({
        failure: {
          type: "validation" as const,
          fieldErrors: { title: "Title is not accepted." },
        },
      }),
      japaneseSnapshot,
    );

    await user.type(screen.getByRole("textbox", { name: "タイトル" }), "Draft");
    await user.click(screen.getByRole("button", { name: "タスクを追加" }));

    expect(await screen.findByText("Title is not accepted.")).toHaveAttribute(
      "lang",
      "en",
    );
  });

  it("blocks a recurring Task with a timed Start inside the dialog", async () => {
    const user = userEvent.setup();
    const action = vi.fn(taskMutationTestAction);

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />, action);

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Daily");
    await user.type(screen.getByRole("textbox", { name: "Repeat" }), "day");
    await chooseDate(user, "Start", "2026-09-02");
    const startCalendar = await enableTime(user, "Start");
    await user.click(
      within(startCalendar).getByRole("button", { name: "Done" }),
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      screen.getByText("A Recurring Task must use a date-only Start"),
    ).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();

    const correctionCalendar = await enableTime(user, "Start");
    await user.click(
      within(correctionCalendar).getByRole("checkbox", {
        name: "Set time for Start",
      }),
    );
    await user.click(
      within(correctionCalendar).getByRole("button", { name: "Done" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("A Recurring Task must use a date-only Start"),
      ).not.toBeInTheDocument(),
    );
  });

  it("defaults to Inbox when no Owner-managed Area exists", () => {
    const inbox = testSnapshot.areas.find((area) => area.isSystemManaged);
    if (!inbox) throw new Error("System-managed Inbox Area was not found");

    renderTaskDialog(
      <NewTaskDialog open onOpenChange={vi.fn()} />,
      taskMutationTestAction,
      {
        ...testSnapshot,
        areas: [inbox],
        tasks: [],
        areaTaskOrders: {},
        inboxOrder: [],
      },
    );

    const area = screen.getByRole("combobox", { name: "Area" });
    expect(area).toHaveValue(String(inbox.id));
    expect(within(area).getAllByRole("option")).toHaveLength(1);
    expect(area).toHaveTextContent("Inbox");
  });

  it("shows the Repeat field and its syntax tooltip", async () => {
    const user = userEvent.setup();

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Repeat" })).toHaveAttribute(
      "placeholder",
      "Add repeat",
    );
    const repeatHelp = screen.getByRole("button", { name: "Repeat syntax" });
    await user.hover(repeatHelp);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("day (Every day)");
    expect(tooltip).toHaveTextContent("mon, wed (Every Monday and Wednesday)");
    expect(tooltip).toHaveTextContent(
      "5, 10 (The 5th and 10th of every month)",
    );
    expect(tooltip).toHaveTextContent(
      "2nd tue (The second Tuesday of every month)",
    );
    expect(tooltip).toHaveTextContent(
      "2nd tue -1 (The day before the second Tuesday of every month)",
    );
    expect(screen.getByText("(Every day)")).toHaveClass("text-slate-400");
  });

  it("shows the Tags placeholder", () => {
    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Tags" })).toHaveAttribute(
      "placeholder",
      "Add tags",
    );
  });

  it("creates a root Task in the selected Area", async () => {
    const user = userEvent.setup();

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskPath />
      </>,
    );

    const startButton = screen.getByRole("button", { name: "Start" });
    const dueButton = screen.getByRole("button", { name: "Due" });
    expect(startButton).toHaveTextContent("Add date and time");
    expect(dueButton).toHaveTextContent("Add date and time");
    expect(
      screen.queryByRole("checkbox", { name: "Set time for Start" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Set time for Due" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Area" }), [
      "Develop",
    ]);
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Dialog test",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByText("Develop / Dialog test"),
    ).toBeInTheDocument();
  });

  it("defaults to Inbox and replaces the snapshot after creating a root Task", async () => {
    const user = userEvent.setup();
    const existingInboxTask = testSnapshot.tasks.find(
      (task) => task.id === "inbox-1",
    );
    if (!existingInboxTask) throw new Error("Inbox fixture Task was not found");
    const serverSnapshot = {
      ...testSnapshot,
      tags: [serverTag],
      inboxOrder: ["server-inbox-root"],
      tasks: [
        ...testSnapshot.tasks.filter(
          (task) => task.id !== existingInboxTask.id,
        ),
        {
          ...existingInboxTask,
          id: "server-inbox-root",
          title: "Server Inbox root",
          path: ["Inbox", "Server Inbox root"],
          tags: [serverTag],
        },
      ],
    };
    const successAction: ActionFunction = async () => ({
      snapshot: serverSnapshot,
    });

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskPath title="Server Inbox root" />
        <TaskStoreState />
      </>,
      successAction,
    );

    const area = screen.getByRole("combobox", { name: "Area" });
    const inbox = testSnapshot.areas.find(
      (candidate) => candidate.isSystemManaged,
    );
    if (!inbox) throw new Error("System-managed Inbox Area was not found");
    expect(area).toHaveValue(String(inbox.id));
    expect(area).toHaveTextContent("Inbox");
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Inbox root",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByText("Inbox / Server Inbox root"),
    ).toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId("task-store-state").textContent ?? ""),
    ).toEqual({
      taskIds: serverSnapshot.tasks.map((task) => task.id),
      inboxOrder: ["server-inbox-root"],
      tags: [serverTag],
    });
  });

  it("creates an Inbox Subtask and replaces the tree and order from the server snapshot", async () => {
    const user = userEvent.setup();
    const existingInboxParent = testSnapshot.tasks.find(
      (task) => task.id === "inbox-1",
    );
    if (!existingInboxParent)
      throw new Error("Inbox fixture Task was not found");
    const serverParent = {
      ...existingInboxParent,
      id: "server-inbox-parent",
      title: "Server Inbox parent",
      path: ["Inbox", "Server Inbox parent"],
    };
    const serverSubtask = {
      ...existingInboxParent,
      id: "server-inbox-subtask",
      title: "Server Inbox Subtask",
      path: ["Inbox", "Server Inbox parent", "Server Inbox Subtask"],
      parentId: serverParent.id,
    };
    const serverSnapshot = {
      ...testSnapshot,
      tags: [serverTag],
      inboxOrder: [serverParent.id],
      areaTaskOrders: {
        [`parent:${serverParent.id}`]: [serverSubtask.id],
      },
      tasks: [
        ...testSnapshot.tasks.filter(
          (task) => task.id !== existingInboxParent.id,
        ),
        serverParent,
        serverSubtask,
      ],
    };
    const successAction: ActionFunction = async () => ({
      snapshot: serverSnapshot,
    });

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskPath title="Server Inbox Subtask" />
        <InboxTreeStoreState />
      </>,
      successAction,
    );

    const parent = screen.getByRole("combobox", { name: "Task Path" });
    expect(parent).toHaveTextContent("歯科検診を予約する");
    await user.selectOptions(parent, "inbox-1");
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Inbox Subtask",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByText(
        "Inbox / Server Inbox parent / Server Inbox Subtask",
      ),
    ).toBeInTheDocument();
    expect(
      JSON.parse(
        screen.getByTestId("inbox-tree-store-state").textContent ?? "",
      ),
    ).toEqual({
      subtask: {
        id: serverSubtask.id,
        parentId: serverParent.id,
        path: serverSubtask.path,
      },
      inboxOrder: [serverParent.id],
      areaTaskOrders: {
        [`parent:${serverParent.id}`]: [serverSubtask.id],
      },
    });
  });

  it("disables Add Task while the create request is pending", async () => {
    const user = userEvent.setup();
    let resolveAction: (result: { snapshot: typeof testSnapshot }) => void =
      () => undefined;
    const pendingAction = () =>
      new Promise<{ snapshot: typeof testSnapshot }>((resolve) => {
        resolveAction = resolve;
      });

    renderTaskDialog(
      <NewTaskDialog open onOpenChange={vi.fn()} />,
      pendingAction,
    );

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Pending");
    const submit = screen.getByRole("button", { name: "Add Task" });
    await user.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());

    resolveAction({ snapshot: testSnapshot });
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("keeps the draft after a create failure and retries from Add Task", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const failingOnceAction: ActionFunction = async (args) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          failure: {
            type: "error" as const,
            message: "Could not create “Failed”. Try again from Add Task.",
          },
        };
      }
      return taskMutationTestAction(args);
    };

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskPath title="Failed" />
      </>,
      failingOnceAction,
    );

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Failed");
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Keep this draft",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByLabelText(
        "Error notification: Could not create “Failed”. Try again from Add Task.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "New Task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Failed",
    );
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Keep this draft",
    );
    expect(screen.queryByText("Inbox / Failed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(await screen.findByText("Inbox / Failed")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("keeps an Add Subtask draft after failure and retries from Add Task", async () => {
    const user = userEvent.setup();
    const parent = testSnapshot.tasks.find((task) => task.id === "inbox-1");
    if (!parent) throw new Error("Inbox fixture Task was not found");
    let attempts = 0;
    const failingOnceAction: ActionFunction = async (args) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          failure: {
            type: "warning" as const,
            message:
              "Could not add “Draft Subtask” below “歯科検診を予約する”. Review the Task and try again from Add Task.",
          },
        };
      }
      return taskMutationTestAction(args);
    };

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} parentTask={parent} />
        <CreatedTaskPath title="Draft Subtask" />
      </>,
      failingOnceAction,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Draft Subtask",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByLabelText(
        "Warning notification: Could not add “Draft Subtask” below “歯科検診を予約する”. Review the Task and try again from Add Task.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Draft Subtask",
    );

    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByText("Inbox / 歯科検診を予約する / Draft Subtask"),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("resets Task Path when Area changes and only lists candidates in that Area", async () => {
    const user = userEvent.setup();

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Area" }), [
      "Develop",
    ]);
    const parent = screen.getByRole("combobox", { name: "Task Path" });
    expect(parent).toHaveTextContent("Taskseq MVP");
    expect(parent).not.toHaveTextContent("Summer EP");

    await user.selectOptions(parent, ["Taskseq MVP"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Area" }), [
      "Music",
    ]);

    expect(screen.getByRole("combobox", { name: "Task Path" })).toHaveValue("");
    expect(
      screen.getByRole("combobox", { name: "Task Path" }),
    ).toHaveTextContent("Summer EP");
  });

  it("offers Inbox Tasks as Task Path candidates", () => {
    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    const parent = screen.getByRole("combobox", { name: "Task Path" });
    expect(parent).toBeEnabled();
    expect(parent).toHaveTextContent("歯科検診を予約する");
  });

  it("excludes Completed, Recurring, and Level 5 Inbox parents", () => {
    const existingInboxParent = testSnapshot.tasks.find(
      (task) => task.id === "inbox-1",
    );
    if (!existingInboxParent)
      throw new Error("Inbox fixture Task was not found");
    const snapshot = {
      ...testSnapshot,
      tasks: [
        ...testSnapshot.tasks,
        {
          ...existingInboxParent,
          id: "inbox-completed-parent",
          title: "Completed Inbox parent",
          path: ["Inbox", "Completed Inbox parent"],
          status: "COMPLETED" as const,
          completedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          ...existingInboxParent,
          id: "inbox-recurring-parent",
          title: "Recurring Inbox parent",
          path: ["Inbox", "Recurring Inbox parent"],
          recurrenceRule: "day",
        },
        {
          ...existingInboxParent,
          id: "inbox-level-five-parent",
          title: "Level five Inbox parent",
          path: [
            "Inbox",
            "Level 1",
            "Level 2",
            "Level 3",
            "Level 4",
            "Level 5",
          ],
        },
      ],
    };

    renderTaskDialog(
      <NewTaskDialog open onOpenChange={vi.fn()} />,
      taskMutationTestAction,
      snapshot,
    );

    const parent = screen.getByRole("combobox", { name: "Task Path" });
    expect(parent).toHaveTextContent("歯科検診を予約する");
    expect(parent).not.toHaveTextContent("Completed Inbox parent");
    expect(parent).not.toHaveTextContent("Recurring Inbox parent");
    expect(parent).not.toHaveTextContent("Level five Inbox parent");
  });

  it("creates an Area root Task when Task Path is not selected", async () => {
    const user = userEvent.setup();

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskPath title="Area root" />
      </>,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Area" }), [
      "Develop",
    ]);
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Area root",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(await screen.findByText("Develop / Area root")).toBeInTheDocument();
  });

  it("shows existing tags and completes the current input", async () => {
    const user = userEvent.setup();

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    const tags = screen.getByRole("combobox", { name: "Tags" });
    await user.click(tags);
    expect(
      screen.getByRole("button", { name: "cloudflare" }),
    ).toBeInTheDocument();

    await user.type(tags, "clo");
    await user.keyboard("{Enter}");
    expect(tags).toHaveValue("cloudflare");
  });

  it("submits existing Tag IDs and new Tag names", async () => {
    const user = userEvent.setup();
    const existingTag = testSnapshot.tags.find(
      (tag) => tag.name === "prototype",
    );
    const sourceTask = testSnapshot.tasks[0];
    if (!existingTag || !sourceTask) throw new Error("Tag fixture is missing");
    const newTag = { id: testSnapshot.tags.length + 1, name: "new-tag" };
    let submitted:
      | { tagIds: number[]; newTagNames: string[]; title: string }
      | undefined;
    const action: ActionFunction = async ({ request }) => {
      const formData = await request.formData();
      submitted = JSON.parse(String(formData.get("payload")));
      return {
        snapshot: {
          ...testSnapshot,
          tags: [...testSnapshot.tags, newTag],
          tasks: [
            ...testSnapshot.tasks,
            {
              ...sourceTask,
              id: "new-tag-task",
              title: "Tag payload",
              path: ["Inbox", "Tag payload"],
              areaId: testAreaIds.aiIt,
              parentId: undefined,
              tags: [existingTag, newTag],
            },
          ],
        },
      };
    };

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskPath title="Tag payload" />
        <TaskStoreState />
      </>,
      action,
    );

    const tags = screen.getByRole("combobox", { name: "Tags" });
    await user.click(tags);
    await user.click(screen.getByRole("button", { name: "prototype" }));
    await user.type(tags, ", new-tag");
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Tag payload",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(await screen.findByText("Inbox / Tag payload")).toBeInTheDocument();
    await waitFor(() =>
      expect(submitted).toMatchObject({
        tagIds: [existingTag.id],
        newTagNames: [newTag.name],
        title: "Tag payload",
      }),
    );
    expect(
      JSON.parse(screen.getByTestId("task-store-state").textContent ?? "").tags,
    ).toContainEqual(newTag);
  });

  it("reports a failure for Task creation with a new Tag and keeps the draft", async () => {
    const user = userEvent.setup();
    const existingTag = testSnapshot.tags.find(
      (tag) => tag.name === "prototype",
    );
    if (!existingTag) throw new Error("Tag fixture is missing");
    let submitted:
      | { tagIds: number[]; newTagNames: string[]; title: string }
      | undefined;
    const action: ActionFunction = async ({ request }) => {
      const formData = await request.formData();
      submitted = JSON.parse(String(formData.get("payload")));
      return {
        failure: {
          type: "error" as const,
          message: "Could not create “Tag failure”. Try again from Add Task.",
        },
      };
    };

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />, action);

    const tags = screen.getByRole("combobox", { name: "Tags" });
    await user.click(tags);
    await user.click(screen.getByRole("button", { name: "prototype" }));
    await user.type(tags, ", new-tag");
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Tag failure",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByLabelText(
        "Error notification: Could not create “Tag failure”. Try again from Add Task.",
      ),
    ).toBeInTheDocument();
    expect(tags).toHaveValue("prototype, new-tag");
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Tag failure",
    );
    await waitFor(() =>
      expect(submitted).toMatchObject({
        tagIds: [existingTag.id],
        newTagNames: ["new-tag"],
        title: "Tag failure",
      }),
    );
  });

  it("creates date-only Start and Due values", async () => {
    const user = userEvent.setup();

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskStart />
      </>,
    );

    await chooseDate(user, "Start", "2026-08-15");
    await chooseDate(user, "Due", "2026-08-16");
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Date-only test",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(await screen.findByText("2026-08-15")).toBeInTheDocument();
  });

  it("creates offset timestamps from five-minute time selections", async () => {
    const user = userEvent.setup();

    renderTaskDialog(
      <>
        <NewTaskDialog open onOpenChange={vi.fn()} />
        <CreatedTaskTiming title="Timed test" />
      </>,
    );

    await chooseDate(user, "Start", "2026-08-15");
    const startCalendar = await enableTime(user, "Start");
    await user.selectOptions(
      within(startCalendar).getByRole("combobox", { name: "Start hour" }),
      "14",
    );
    const startMinute = within(startCalendar).getByRole("combobox", {
      name: "Start minute",
    });
    expect(startMinute).toHaveTextContent("00");
    expect(startMinute).toHaveTextContent("55");
    expect(
      within(startMinute).queryByRole("option", { name: "01" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(startMinute, "30");

    await user.click(
      within(startCalendar).getByRole("button", { name: "Done" }),
    );
    expect(screen.getByRole("button", { name: "Start" })).toHaveTextContent(
      "2026/08/15 14:30",
    );
    await chooseDate(user, "Due", "2026-08-15");
    const dueCalendar = await enableTime(user, "Due");
    await user.selectOptions(
      within(dueCalendar).getByRole("combobox", { name: "Due hour" }),
      "15",
    );
    await user.selectOptions(
      within(dueCalendar).getByRole("combobox", { name: "Due minute" }),
      "05",
    );
    await user.click(within(dueCalendar).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Due" })).toHaveTextContent(
      "2026/08/15 15:05",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Timed test",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByText(
        "2026-08-15T14:30:00.000+09:00|2026-08-15T15:05:00.000+09:00",
      ),
    ).toBeInTheDocument();
  });

  it("rejects a timed Due before Start", async () => {
    const user = userEvent.setup();

    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    await chooseDate(user, "Start", "2026-08-15");
    const startCalendar = await enableTime(user, "Start");
    await user.selectOptions(
      within(startCalendar).getByRole("combobox", { name: "Start hour" }),
      "14",
    );
    await user.click(
      within(startCalendar).getByRole("button", { name: "Done" }),
    );
    await chooseDate(user, "Due", "2026-08-15");
    const dueCalendar = await enableTime(user, "Due");
    await user.selectOptions(
      within(dueCalendar).getByRole("combobox", { name: "Due hour" }),
      "13",
    );
    await user.click(within(dueCalendar).getByRole("button", { name: "Done" }));
    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "Invalid timing",
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));

    expect(
      await screen.findByText("Due must be on or after Start"),
    ).toBeInTheDocument();
  });

  it("enables the Task Path selector for the default Inbox Area", () => {
    renderTaskDialog(<NewTaskDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "Task Path" })).toBeEnabled();
  });

  it("resets the initial date when the Owner timezone changes", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-07-24T15:30:00.000Z").getTime());
    const user = userEvent.setup();

    try {
      renderTaskDialog(<TimezoneNewTaskFixture />);

      await user.click(screen.getByRole("button", { name: "Change timezone" }));
      await user.click(screen.getByRole("button", { name: "Open dialog" }));

      expect(screen.getByRole("button", { name: "Start" })).toHaveTextContent(
        "Add date and time",
      );
    } finally {
      now.mockRestore();
    }
  });
});
