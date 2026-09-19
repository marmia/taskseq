import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayLanguage } from "../../shared/api-schema";
import { applyDisplayLanguage, i18n } from "../i18n";
import { TaskDateTimePicker } from "./task-date-time-picker";

function renderPicker(
  values: Partial<{
    date: string;
    time: string;
    timeEnabled: boolean;
    ownerTimeZone: string;
    weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    language: DisplayLanguage;
  }> = {},
) {
  const onDateChange = vi.fn();
  const onTimeChange = vi.fn();
  const onTimeEnabledChange = vi.fn();

  applyDisplayLanguage(values.language ?? "en");
  const rendered = render(
    <I18nextProvider i18n={i18n}>
      <TaskDateTimePicker
        label="Start"
        date={values.date ?? "2026-09-15"}
        time={values.time ?? "09:15"}
        timeEnabled={values.timeEnabled ?? false}
        ownerTimeZone={values.ownerTimeZone ?? "Asia/Tokyo"}
        weekStartsOn={values.weekStartsOn ?? 1}
        onDateChange={onDateChange}
        onTimeChange={onTimeChange}
        onTimeEnabledChange={onTimeEnabledChange}
      />
    </I18nextProvider>,
  );

  return { onDateChange, onTimeChange, onTimeEnabledChange, ...rendered };
}

describe("TaskDateTimePicker", () => {
  afterEach(() => {
    applyDisplayLanguage("en");
  });

  it("localizes the Japanese calendar controls and date locale", async () => {
    const user = userEvent.setup();
    renderPicker({ date: "", language: "ja" });

    const dateButton = screen.getByRole("button", { name: "開始" });
    expect(dateButton).toHaveTextContent("日付と時刻を追加");
    await user.click(dateButton);

    const calendar = screen.getByRole("dialog", { name: "開始カレンダー" });
    expect(calendar).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "前月へ移動" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "今日へ移動" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "翌月へ移動" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "カレンダーを閉じる" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("checkbox", { name: "開始で時刻を設定" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "削除" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "完了" }),
    ).toBeInTheDocument();
    expect(calendar.querySelector('[aria-label="月曜日"]')).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: /2026年9月15日/ }),
    ).toBeInTheDocument();
    expect(
      calendar.querySelector("[data-task-calendar-month-title]"),
    ).toHaveTextContent("2026年9月");
  }, 15_000);

  it("uses natural Japanese names for time dropdowns", async () => {
    const user = userEvent.setup();
    renderPicker({ language: "ja", timeEnabled: true });

    await user.click(screen.getByRole("button", { name: "開始" }));
    expect(
      screen.getByRole("combobox", { name: "開始の時刻（時）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "開始の時刻（分）" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listbox")).toHaveLength(0);
  }, 15_000);

  it("keeps the mobile time list behavior unchanged", async () => {
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 375,
      });
      const user = userEvent.setup();
      renderPicker({ language: "ja", timeEnabled: true });

      await user.click(screen.getByRole("button", { name: "開始" }));
      expect(
        screen.getByRole("listbox", { name: "開始の時刻（時）" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("listbox", { name: "開始の時刻（分）" }),
      ).toBeInTheDocument();
      expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  }, 15_000);

  it("uses a compact calendar width on desktop and keeps the mobile width constrained", async () => {
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 1024,
      });
      const desktopUser = userEvent.setup();
      const desktop = renderPicker();
      await desktopUser.click(screen.getByRole("button", { name: "Start" }));
      expect(
        screen.getByRole("dialog", { name: "Start calendar" }),
      ).toHaveStyle({ width: "360px" });
      desktop.unmount();

      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 480,
      });
      const wideMobileUser = userEvent.setup();
      const wideMobile = renderPicker();
      await wideMobileUser.click(screen.getByRole("button", { name: "Start" }));
      expect(
        screen.getByRole("dialog", { name: "Start calendar" }),
      ).toHaveStyle({ width: "448px" });
      wideMobile.unmount();

      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 375,
      });
      const mobileUser = userEvent.setup();
      renderPicker();
      await mobileUser.click(screen.getByRole("button", { name: "Start" }));
      expect(
        screen.getByRole("dialog", { name: "Start calendar" }),
      ).toHaveStyle({ width: "343px" });
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  }, 15_000);

  it("keeps a selected date pending until the calendar is completed", async () => {
    const user = userEvent.setup();
    const { onDateChange } = renderPicker();

    const dateButton = screen.getByRole("button", { name: "Start" });
    expect(dateButton).toHaveTextContent("2026/09/15");
    expect(
      screen.queryByRole("textbox", { name: "Start" }),
    ).not.toBeInTheDocument();

    await user.click(dateButton);
    expect(
      screen.getByRole("dialog", { name: "Start calendar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("grid", { name: "September 2026" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: /September 15/ })
        .closest('[role="gridcell"]'),
    ).toHaveAttribute("data-selected", "true");

    await user.click(screen.getByRole("button", { name: /September 21/ }));
    expect(onDateChange).not.toHaveBeenCalled();
    expect(dateButton).toHaveTextContent("2026/09/15");

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDateChange).toHaveBeenCalledWith("2026-09-21");
    expect(
      screen.queryByRole("dialog", { name: "Start calendar" }),
    ).not.toBeInTheDocument();
  }, 15_000);

  it("shows the selected time in the date button when time is enabled", async () => {
    const user = userEvent.setup();
    const { onTimeChange } = renderPicker({
      date: "2026-09-15",
      time: "09:15",
      timeEnabled: true,
    });
    const dateButton = screen.getByRole("button", { name: "Start" });

    await user.click(dateButton);
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(onTimeChange).toHaveBeenCalledWith("09:15");
    expect(dateButton).toHaveTextContent("2026/09/15 09:15");
  }, 15_000);

  it("shows a light placeholder when no date is selected", () => {
    renderPicker({ date: "" });

    const dateButton = screen.getByRole("button", { name: "Start" });
    expect(dateButton).toHaveTextContent("Add date and time");
  });

  it("closes from the header without applying the calendar draft", async () => {
    const user = userEvent.setup();
    const { onDateChange } = renderPicker();
    const dateButton = screen.getByRole("button", { name: "Start" });

    await user.click(dateButton);
    await user.click(screen.getByRole("button", { name: "Close calendar" }));

    expect(onDateChange).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "Start calendar" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(dateButton).toHaveFocus());
  }, 15_000);

  it("discards outside changes and clears the date with its time draft", async () => {
    const user = userEvent.setup();
    const { onDateChange, onTimeChange, onTimeEnabledChange } = renderPicker({
      time: "09:42",
      timeEnabled: true,
    });
    const dateButton = screen.getByRole("button", { name: "Start" });

    await user.click(dateButton);
    await user.click(screen.getByRole("button", { name: /September 21/ }));
    await user.click(document.body);

    expect(onDateChange).not.toHaveBeenCalled();
    await waitFor(() => expect(dateButton).toHaveFocus());

    await user.click(dateButton);
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onDateChange).toHaveBeenLastCalledWith("");
    expect(onTimeChange).toHaveBeenLastCalledWith("00:00");
    expect(onTimeEnabledChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await waitFor(() => expect(dateButton).toHaveFocus());
  }, 15_000);

  it("keeps time selections in the calendar draft while toggling time off", async () => {
    const user = userEvent.setup();
    const { onDateChange, onTimeChange, onTimeEnabledChange } = renderPicker({
      time: "09:42",
      timeEnabled: true,
    });

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("combobox", { name: "Start hour" })).toHaveValue(
      "09",
    );
    expect(screen.getByRole("combobox", { name: "Start minute" })).toHaveValue(
      "42",
    );
    expect(
      screen.getByRole("option", { name: "42 (existing)" }),
    ).toBeDisabled();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Start hour" }),
      "10",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Start minute" }),
      "45",
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Set time for Start" }),
    );
    expect(
      screen.queryByRole("combobox", { name: "Start hour" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: "Set time for Start" }),
    );
    expect(screen.getByRole("combobox", { name: "Start hour" })).toHaveValue(
      "10",
    );
    expect(screen.getByRole("combobox", { name: "Start minute" })).toHaveValue(
      "45",
    );

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onDateChange).toHaveBeenLastCalledWith("2026-09-15");
    expect(onTimeChange).toHaveBeenLastCalledWith("10:45");
    expect(onTimeEnabledChange).toHaveBeenLastCalledWith(true);
  }, 15_000);

  it("uses the Owner timezone for today and the configured week start", async () => {
    vi.setSystemTime(new Date("2026-09-01T00:30:00.000Z"));
    try {
      const user = userEvent.setup();
      renderPicker({
        date: "",
        ownerTimeZone: "America/Los_Angeles",
        weekStartsOn: 1,
      });

      await user.click(screen.getByRole("button", { name: "Start" }));
      const calendar = screen.getByRole("dialog", { name: "Start calendar" });
      screen.getByRole("grid", { name: "August 2026" });
      expect(calendar.querySelector("th")).toHaveAttribute(
        "aria-label",
        "Monday",
      );
      expect(calendar.querySelector('[data-day="2026-08-31"]')).toHaveAttribute(
        "data-today",
        "true",
      );
      expect(
        within(calendar).getByRole("checkbox", { name: "Set time for Start" }),
      ).toBeDisabled();
      expect(
        within(calendar).getByRole("button", {
          name: /Today, Monday, August 31st, 2026/,
        }),
      ).toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  it("moves months and keeps keyboard changes pending until close", async () => {
    const user = userEvent.setup();
    const { onDateChange } = renderPicker();
    const dateButton = screen.getByRole("button", { name: "Start" });

    await user.click(dateButton);
    const calendar = screen.getByRole("dialog", { name: "Start calendar" });
    expect(
      screen.getByRole("grid", { name: "September 2026" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: /September 15/ }),
    ).toHaveFocus();

    await user.click(
      within(calendar).getByRole("button", { name: "Previous month" }),
    );
    expect(
      screen.getByRole("grid", { name: "August 2026" }),
    ).toBeInTheDocument();
    await user.click(
      within(calendar).getByRole("button", { name: "Go to today" }),
    );
    expect(
      screen.getByRole("grid", { name: "September 2026" }),
    ).toBeInTheDocument();
    await user.click(
      within(calendar).getByRole("button", { name: "Next month" }),
    );
    expect(
      screen.getByRole("grid", { name: "October 2026" }),
    ).toBeInTheDocument();

    await user.click(
      within(calendar).getByRole("button", { name: "Previous month" }),
    );
    await user.click(
      within(calendar).getByRole("button", { name: /September 15/ }),
    );
    await user.keyboard("{ArrowRight}");
    expect(
      within(calendar).getByRole("button", { name: /September 16/ }),
    ).toHaveFocus();
    await user.keyboard(" ");
    expect(onDateChange).not.toHaveBeenCalled();
    expect(dateButton).toHaveTextContent("2026/09/15");

    await user.tab();
    expect(
      within(calendar).getByRole("checkbox", { name: "Set time for Start" }),
    ).toHaveFocus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(calendar).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onDateChange).not.toHaveBeenCalled();
    await waitFor(() => expect(dateButton).toHaveFocus());
  }, 15_000);
});
