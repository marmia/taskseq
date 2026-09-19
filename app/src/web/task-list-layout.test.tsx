import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { formatTaskDateTime, formatTaskListDate } from "../domain/task-date";
import { BootstrapProvider } from "./bootstrap-state";
import { tomorrow, yesterday } from "./mock-data";
import { InboxPage, TodayPage, WeekPage } from "./pages";
import { AppSettingsProvider as ProductionAppSettingsProvider } from "./settings-store";
import { TaskStoreProvider } from "./task-store";
import {
  taskMutationTestAction,
  testAreaIds,
  testSnapshot,
} from "./test/providers";

function renderTaskList(page: ReactNode, snapshot = testSnapshot) {
  const router = createMemoryRouter(
    [
      { path: "/", element: page },
      { path: "/task-mutations", action: taskMutationTestAction },
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

describe("production Task List layout", () => {
  it("shows the shared two-line Task list row and complete tooltip on Today", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((task) =>
        task.id === "task-2"
          ? {
              ...task,
              recurrenceRule: "day",
              workNotes: "response shapeを確認した記録",
            }
          : task,
      ),
    };

    renderTaskList(<TodayPage />, snapshot);

    const title = screen.getByRole("button", {
      name: "Edit API contractを確認する",
    });
    const taskRow = title.closest("article");
    expect(taskRow).not.toBeNull();

    expect(
      within(taskRow as HTMLElement).queryByRole("img", {
        name: "Area badge: Develop",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(taskRow as HTMLElement).queryByRole("time"),
    ).not.toBeInTheDocument();

    expect(taskRow).toHaveAttribute("data-slot", "task-list-row");
    expect(title).toHaveClass("font-normal", "text-[15px]", "leading-5");
    expect(title).toHaveClass("inline-block", "max-w-full");
    expect(title).not.toHaveClass("w-full");
    expect(title).toHaveStyle({ fontSize: "15px", lineHeight: "20px" });

    const content = taskRow?.querySelector('[data-slot="task-list-content"]');
    expect(content).toHaveClass("pt-3", "pb-1.5");

    const metadataRow = taskRow?.querySelector(
      '[data-slot="task-list-meta-row"]',
    );
    const path = taskRow?.querySelector(
      '[data-slot="task-list-path"]',
    ) as HTMLElement;
    expect(metadataRow).not.toBeNull();
    expect(metadataRow).toHaveClass("mt-1.5");
    expect(path).not.toBeNull();
    expect(path).toHaveTextContent("Develop / Taskseq MVP");
    expect(path).not.toHaveTextContent("API contractを確認する");
    expect(path).toHaveClass("text-right", "truncate");
    expect(path).toHaveClass("text-slate-400");
    expect(path).toHaveStyle({ direction: "rtl" });
    expect(metadataRow?.firstElementChild).toHaveAttribute(
      "data-slot",
      "task-list-metadata",
    );
    expect(metadataRow?.firstElementChild).toHaveClass("text-slate-400");
    expect(taskRow?.querySelector('[data-slot="task-list-tag"]')).toBeNull();
    expect(
      within(taskRow as HTMLElement).queryByRole("time"),
    ).not.toBeInTheDocument();

    const detailsId = (title.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .find(
        (id) => document.getElementById(id)?.getAttribute("role") === "tooltip",
      );
    expect(detailsId).toBeTruthy();
    expect(document.getElementById(detailsId ?? "")).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    await user.hover(title);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveClass(
      "fixed",
      "overflow-y-auto",
      "overscroll-contain",
    );
    expect(tooltip).toHaveStyle({ position: "fixed", fontSize: "13px" });
    expect(tooltip).toHaveAttribute("data-placement", "bottom-start");
    expect(tooltip).not.toHaveClass("right-0", "left-1/2");
    const task = snapshot.tasks.find((candidate) => candidate.id === "task-2");
    if (!task?.start || !task.due) throw new Error("task-2 dates are missing");
    expect(tooltip).toHaveTextContent("Title API contractを確認する");
    expect(tooltip).toHaveTextContent(
      `Start ${formatTaskDateTime(task.start, "Asia/Tokyo")}`,
    );
    expect(tooltip).toHaveTextContent(
      `Due ${formatTaskDateTime(task.due, "Asia/Tokyo")}`,
    );
    expect(tooltip).toHaveTextContent("Repeat rule day");
    expect(tooltip).toHaveTextContent("Tags backend");
    expect(tooltip).toHaveTextContent("Description");
    expect(tooltip).toHaveTextContent("Work Notes");
    expect(tooltip).toHaveTextContent("response shapeを確認した記録");
    expect(
      screen.getByRole("img", { name: "Recurring Task" }),
    ).toBeInTheDocument();

    await user.unhover(title);
    expect(document.getElementById(detailsId ?? "")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    await user.hover(tooltip);
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(document.getElementById(detailsId ?? "")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    await user.unhover(tooltip);
    await waitFor(() =>
      expect(document.getElementById(detailsId ?? "")).toHaveAttribute(
        "aria-hidden",
        "true",
      ),
    );
    expect(document.getElementById(detailsId ?? "")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    title.blur();
    fireEvent.focus(title);
    expect(document.getElementById(detailsId ?? "")).toHaveAttribute(
      "aria-hidden",
      "false",
    );

    const completeButton = screen.getByRole("button", {
      name: "Complete API contractを確認する",
    });
    const dragButton = screen.getByRole("button", {
      name: "Reorder API contractを確認する",
    });
    expect(completeButton).toBeEnabled();
    expect(dragButton).toBeEnabled();
    expect(dragButton).toHaveStyle({
      width: "28px",
      height: "44px",
      minWidth: "28px",
      minHeight: "44px",
    });
    expect(completeButton).toHaveStyle({
      width: "30px",
      height: "44px",
      minWidth: "30px",
      minHeight: "44px",
    });
    expect(
      completeButton.querySelector('[data-slot="task-list-status-visual"]'),
    ).toHaveStyle({ width: "18px", height: "18px" });
    const contextMenu = within(taskRow as HTMLElement).getByRole("button", {
      name: "API contractを確認する actions",
    });
    expect(contextMenu).toBeEnabled();
    expect(contextMenu).toHaveStyle({
      width: "30px",
      height: "44px",
      minWidth: "30px",
      minHeight: "44px",
    });
    expect(contextMenu.parentElement).toHaveClass("mx-1");

    await user.click(title);
    expect(
      screen.getByRole("dialog", { name: "Edit Task" }),
    ).toBeInTheDocument();
  });

  it("counts only direct finite Subtasks and separates open recurring children", () => {
    const parent = testSnapshot.tasks.find((task) => task.id === "task-2");
    if (!parent) throw new Error("task-2 fixture is missing");

    const directOpen = {
      ...parent,
      id: "task-2-direct-open",
      title: "Direct open child",
      parentId: parent.id,
      path: [...parent.path, "Direct open child"],
      status: "OPEN" as const,
      recurrenceRule: null,
    };
    const directCompleted = {
      ...directOpen,
      id: "task-2-direct-completed",
      title: "Direct completed child",
      path: [...parent.path, "Direct completed child"],
      status: "COMPLETED" as const,
      completedAt: new Date().toISOString(),
    };
    const directRecurring = {
      ...directOpen,
      id: "task-2-direct-recurring",
      title: "Direct recurring child",
      path: [...parent.path, "Direct recurring child"],
      recurrenceRule: "day",
    };
    const completedRecurring = {
      ...directRecurring,
      id: "task-2-completed-recurring",
      title: "Completed recurring child",
      path: [...parent.path, "Completed recurring child"],
      status: "COMPLETED" as const,
      completedAt: new Date().toISOString(),
    };
    const trashedFinite = {
      ...directOpen,
      id: "task-2-trashed-finite",
      title: "Trashed finite child",
      path: [...parent.path, "Trashed finite child"],
      trashedAt: new Date().toISOString(),
    };
    const grandchild = {
      ...directOpen,
      id: "task-2-grandchild",
      title: "Grandchild",
      parentId: directOpen.id,
      path: [...directOpen.path, "Grandchild"],
    };
    const snapshot = {
      ...testSnapshot,
      tasks: [
        ...testSnapshot.tasks,
        directOpen,
        directCompleted,
        directRecurring,
        completedRecurring,
        trashedFinite,
        grandchild,
      ],
    };

    renderTaskList(<TodayPage />, snapshot);

    const row = screen
      .getByRole("button", { name: "Edit API contractを確認する" })
      .closest("article") as HTMLElement;
    expect(within(row).getByText("1/2")).toBeInTheDocument();
    expect(within(row).getByText("↻1")).toBeInTheDocument();
    expect(
      row.querySelector('[data-slot="task-list-subtask-progress-icon"]'),
    ).toHaveAttribute("data-icon", "corner-down-right");
  });

  it("renders compact date ranges and colors only an open overdue Due", () => {
    const snapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((task) => {
        if (task.id === "task-2") {
          return {
            ...task,
            start: `${task.start}T09:00:00.000+09:00`,
            due: `${tomorrow}T18:00:00.000+09:00`,
          };
        }
        if (task.id === "task-4") {
          return { ...task, start: null, due: yesterday };
        }
        if (task.id === "task-5") {
          return { ...task, start: null, due: yesterday };
        }
        return task;
      }),
    };

    renderTaskList(<TodayPage />, snapshot);

    const rangeTask = snapshot.tasks.find((task) => task.id === "task-2");
    if (!rangeTask?.start || !rangeTask.due) {
      throw new Error("range fixture dates are missing");
    }
    const rangeRow = screen
      .getByRole("button", { name: "Edit API contractを確認する" })
      .closest("article") as HTMLElement;
    const range = rangeRow.querySelector(
      '[data-slot="task-list-dates"]',
    ) as HTMLElement;
    expect(range).toHaveTextContent(
      `${formatTaskListDate(rangeTask.start, "Asia/Tokyo")} → ${formatTaskListDate(rangeTask.due, "Asia/Tokyo")}`,
    );
    expect(range).toHaveTextContent("→");
    expect(range.querySelector('[data-slot="task-list-due"]')).toHaveClass(
      "text-slate-400",
    );
    expect(
      range.querySelector('[data-slot="task-list-calendar"]'),
    ).not.toHaveClass("text-[#b05a48]");

    const overdueRow = screen
      .getByRole("button", { name: "Edit 請求書を送る" })
      .closest("article") as HTMLElement;
    const overdueDate = overdueRow.querySelector(
      '[data-slot="task-list-dates"]',
    ) as HTMLElement;
    expect(overdueDate).toHaveTextContent(`→`);
    expect(
      overdueDate.querySelector('[data-slot="task-list-calendar"]'),
    ).toHaveClass("text-[#b05a48]");
    expect(
      overdueDate.querySelector('[data-slot="task-list-calendar"]'),
    ).toHaveAttribute("data-icon", "calendar");
    expect(
      overdueDate.querySelector('[data-slot="task-list-due"]'),
    ).toHaveClass("text-[#b05a48]");
    expect(
      overdueRow
        .querySelector('[data-slot="task-list-path"]')
        ?.classList.contains("text-[#b05a48]"),
    ).toBe(false);
    expect(
      overdueRow
        .querySelector('[data-slot="task-list-title"]')
        ?.classList.contains("text-[#b05a48]"),
    ).toBe(false);

    const completedRow = screen
      .getByRole("button", { name: "Edit Daily noteをreviewする" })
      .closest("article") as HTMLElement;
    expect(
      Array.from(
        completedRow.querySelectorAll('[data-slot="task-list-dates"] *'),
      ).some((element) => element.classList.contains("text-[#b05a48]")),
    ).toBe(false);
  });

  it("draws separators between Today Task rows", () => {
    renderTaskList(<TodayPage />);

    const taskTitle = screen.getByRole("button", {
      name: "Edit Navigation shellを比較する",
    });
    const taskRow = taskTitle.closest("article");
    expect(taskRow).not.toBeNull();
    expect(taskRow?.parentElement?.parentElement).toHaveClass(
      "divide-y",
      "divide-slate-100",
    );
  });

  it("keeps list row spacing separate from the compact Inbox tree row", () => {
    const today = renderTaskList(<TodayPage />);
    const todayRow = screen
      .getByRole("button", { name: "Edit Navigation shellを比較する" })
      .closest("article");
    expect(todayRow).not.toBeNull();
    expect(todayRow as HTMLElement).toHaveClass("min-h-[60px]", "gap-0");
    today.unmount();

    const week = renderTaskList(<WeekPage />);
    const weekRow = screen
      .getByRole("button", { name: "Edit Navigation shellを比較する" })
      .closest("article");
    expect(weekRow).not.toBeNull();
    expect(weekRow as HTMLElement).toHaveClass("min-h-[60px]", "gap-0");
    week.unmount();

    const inbox = renderTaskList(<InboxPage />);
    const inboxRow = screen
      .getByRole("button", { name: "Edit 歯科検診を予約する" })
      .closest("article");
    expect(inboxRow).not.toBeNull();
    expect(inboxRow as HTMLElement).toHaveStyle({ minHeight: "60px" });
    expect(inboxRow as HTMLElement).toHaveClass("min-h-[60px]", "gap-0");
    expect(inboxRow as HTMLElement).not.toHaveClass("px-0.5");
    inbox.unmount();
  });

  it("uses the shared adaptive Title tooltip placement on This Week", async () => {
    const user = userEvent.setup();
    renderTaskList(<WeekPage />);

    const title = screen.getByRole("button", {
      name: "Edit Navigation shellを比較する",
    });
    const detailsId = title.getAttribute("aria-describedby");
    expect(detailsId).toBeTruthy();

    await user.hover(title);
    const tooltip = document.getElementById(detailsId ?? "");
    expect(tooltip).toHaveAttribute("aria-hidden", "false");
    expect(tooltip).toHaveAttribute("data-placement", "bottom-start");
    expect(tooltip).toHaveClass("fixed", "overflow-y-auto");
    expect(tooltip).not.toHaveClass("right-0", "left-1/2");
  });

  it("keeps Today and Inbox reorder handles while omitting them and the removed badges from This Week", () => {
    const today = renderTaskList(<TodayPage />);
    const todayRow = screen
      .getByRole("button", { name: "Edit Navigation shellを比較する" })
      .closest("article") as HTMLElement;
    expect(
      screen.getByRole("button", {
        name: "Reorder Navigation shellを比較する",
      }),
    ).toBeInTheDocument();
    expect(todayRow).not.toHaveClass("pl-1");
    today.unmount();

    const week = renderTaskList(<WeekPage />);
    expect(
      screen.getByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Reorder Navigation shellを比較する",
      }),
    ).not.toBeInTheDocument();
    const weekRow = screen
      .getByRole("button", { name: "Edit Navigation shellを比較する" })
      .closest("article") as HTMLElement;
    expect(weekRow).toHaveClass("pl-1");
    const weekContextMenu = within(weekRow).getByRole("button", {
      name: "Navigation shellを比較する actions",
    });
    expect(weekContextMenu.parentElement).toHaveClass("mx-1");
    expect(
      within(weekRow).queryByRole("img", { name: /Area badge:/ }),
    ).not.toBeInTheDocument();
    expect(within(weekRow).queryByRole("time")).not.toBeInTheDocument();
    week.unmount();

    renderTaskList(<InboxPage />);
    expect(
      screen.queryByRole("img", { name: /Area badge:/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("time")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Reorder 歯科検診を予約する",
      }),
    ).toBeInTheDocument();
    const inboxContextMenu = screen.getByRole("button", {
      name: "歯科検診を予約する actions",
    });
    expect(inboxContextMenu.parentElement).toHaveClass("mx-1");
  });

  it("keeps status and recurrence affordances on This Week rows", () => {
    const snapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((task) =>
        task.id === "task-2" ? { ...task, recurrenceRule: "day" } : task,
      ),
    };
    renderTaskList(<WeekPage />, snapshot);

    const completeButton = screen.getByRole("button", {
      name: "Complete Navigation shellを比較する",
    });
    expect(completeButton).toBeEnabled();
    expect(
      screen.getByRole("img", { name: "Recurring Task" }),
    ).toBeInTheDocument();
  });

  it("opens the row menu from the keyboard and fixes Area and Task Path for Add Subtask", async () => {
    const user = userEvent.setup();
    renderTaskList(<TodayPage />);

    const row = screen
      .getByRole("button", { name: "Edit API contractを確認する" })
      .closest("article") as HTMLElement;
    const menuTrigger = within(row).getByRole("button", {
      name: "API contractを確認する actions",
    });

    menuTrigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent("Add Subtask");

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Add Subtask" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveValue(
      String(testAreaIds.develop),
    );
    expect(screen.getByRole("combobox", { name: "Area" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Task Path" })).toHaveValue(
      "task-2",
    );
    const taskPath = screen.getByRole("combobox", { name: "Task Path" });
    expect(taskPath).toBeDisabled();
    expect(taskPath).toHaveTextContent("Taskseq MVP / API contractを確認する");

    await user.type(
      screen.getByRole("textbox", { name: "Title" }),
      "API follow-up",
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    const startCalendar = screen.getByRole("dialog", {
      name: "Start calendar",
    });
    await user.click(
      within(startCalendar).getByRole("button", { name: /^Today,/ }),
    );
    await user.click(
      within(startCalendar).getByRole("button", { name: "Done" }),
    );
    await user.click(screen.getByRole("button", { name: "Add Task" }));
    expect(
      await screen.findByRole("button", { name: "Edit API follow-up" }),
    ).toBeInTheDocument();
  });

  it("only shows Add Subtask for an open, non-recurring Task below level five", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((task) =>
        task.id === "task-2" ? { ...task, recurrenceRule: "day" } : task,
      ),
    };
    renderTaskList(<TodayPage />, snapshot);

    const recurringRow = screen
      .getByRole("button", { name: "Edit API contractを確認する" })
      .closest("article") as HTMLElement;
    await user.click(
      within(recurringRow).getByRole("button", {
        name: "API contractを確認する actions",
      }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Add Subtask" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));

    const completedRow = screen
      .getByRole("button", { name: "Edit Daily noteをreviewする" })
      .closest("article") as HTMLElement;
    await user.click(
      within(completedRow).getByRole("button", {
        name: "Daily noteをreviewする actions",
      }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Add Subtask" }),
    ).not.toBeInTheDocument();
  });

  it("moves a leaf Task to Trash immediately from the row menu", async () => {
    const user = userEvent.setup();
    renderTaskList(<TodayPage />);

    const row = screen
      .getByRole("button", { name: "Edit Navigation shellを比較する" })
      .closest("article") as HTMLElement;
    await user.click(
      within(row).getByRole("button", {
        name: "Navigation shellを比較する actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));

    expect(
      screen.queryByRole("button", {
        name: "Edit Navigation shellを比較する",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Move to Trash" }),
    ).not.toBeInTheDocument();
  });
});
