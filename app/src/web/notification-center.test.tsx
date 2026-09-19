import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDisplayLanguage, i18n } from "./i18n";
import { NotificationProvider, useNotifications } from "./notification-center";

function NotificationFixture() {
  const { addNotification } = useNotifications();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          addNotification({
            type: "info",
            message: "Viewが見つからなかったため、一覧へ戻りました。",
          })
        }
      >
        Show Info
      </button>
      <button
        type="button"
        onClick={() =>
          addNotification({ type: "error", message: "First failure" })
        }
      >
        Show First
      </button>
      <button
        type="button"
        onClick={() =>
          addNotification({ type: "warning", message: "Second failure" })
        }
      >
        Show Second
      </button>
      <button
        type="button"
        onClick={() =>
          addNotification({ type: "info", message: "Third message" })
        }
      >
        Show Third
      </button>
      <button
        type="button"
        onClick={() =>
          addNotification({ type: "error", message: "Fourth failure" })
        }
      >
        Show Fourth
      </button>
    </>
  );
}

describe("common notifications", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    applyDisplayLanguage("en");
  });

  function renderNotifications() {
    return render(
      <I18nextProvider i18n={i18n}>
        <NotificationProvider>
          <NotificationFixture />
        </NotificationProvider>
      </I18nextProvider>,
    );
  }

  it("shows a notification when randomUUID is unavailable on an insecure origin", () => {
    vi.stubGlobal("crypto", {});
    renderNotifications();

    fireEvent.click(screen.getByRole("button", { name: "Show First" }));

    expect(screen.getByText("First failure")).toBeInTheDocument();
  });

  it("shows Info from the public add operation without stealing focus or creating a live region", async () => {
    const user = userEvent.setup();
    renderNotifications();

    const trigger = screen.getByRole("button", { name: "Show Info" });
    trigger.focus();
    await user.click(trigger);

    expect(screen.getByText("Info")).toBeInTheDocument();
    expect(
      screen.getByText("Viewが見つからなかったため、一覧へ戻りました。"),
    ).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.querySelector("[aria-live]")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps distinct notifications newest-first, deduplicates repeats, and limits the stack to three", async () => {
    const user = userEvent.setup();
    renderNotifications();

    await user.click(screen.getByRole("button", { name: "Show First" }));
    await user.click(screen.getByRole("button", { name: "Show First" }));
    let notifications = within(
      screen.getByRole("complementary", { name: "Notifications" }),
    ).getAllByRole("button", { name: /Close notification/ });
    expect(notifications).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Show Second" }));
    await user.click(screen.getByRole("button", { name: "Show Third" }));
    await user.click(screen.getByRole("button", { name: "Show Fourth" }));

    notifications = within(
      screen.getByRole("complementary", { name: "Notifications" }),
    ).getAllByRole("button", { name: /Close notification/ });
    expect(notifications).toHaveLength(3);
    expect(
      notifications.map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Close notification: Fourth failure",
      "Close notification: Third message",
      "Close notification: Second failure",
    ]);
    expect(screen.queryByText("First failure")).not.toBeInTheDocument();
  });

  it("expires Info after five seconds and Error after ten seconds, restarting a repeated notification", () => {
    vi.useFakeTimers();
    renderNotifications();

    fireEvent.click(screen.getByRole("button", { name: "Show Info" }));
    fireEvent.click(screen.getByRole("button", { name: "Show First" }));

    act(() => vi.advanceTimersByTime(5_000));
    expect(
      screen.queryByText("Viewが見つからなかったため、一覧へ戻りました。"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("First failure")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(4_000));
    fireEvent.click(screen.getByRole("button", { name: "Show First" }));
    act(() => vi.advanceTimersByTime(9_000));
    expect(screen.getByText("First failure")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByText("First failure")).not.toBeInTheDocument();
  });

  it("pauses the remaining time while hovered or focused and resumes afterward", () => {
    vi.useFakeTimers();
    renderNotifications();

    fireEvent.click(screen.getByRole("button", { name: "Show First" }));
    const hovered = screen.getByRole("region", {
      name: "Error notification: First failure",
    });
    act(() => vi.advanceTimersByTime(4_000));
    fireEvent.mouseEnter(hovered);
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByText("First failure")).toBeInTheDocument();
    fireEvent.mouseLeave(hovered);
    act(() => vi.advanceTimersByTime(5_999));
    expect(screen.getByText("First failure")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("First failure")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Second" }));
    act(() => vi.advanceTimersByTime(3_000));
    const close = screen.getByRole("button", {
      name: "Close notification: Second failure",
    });
    act(() => close.focus());
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByText("Second failure")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Show Second" }).focus());
    act(() => vi.advanceTimersByTime(6_999));
    expect(screen.getByText("Second failure")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Second failure")).not.toBeInTheDocument();
  });

  it("closes by keyboard and returns focus to the operation that added the notification", async () => {
    const user = userEvent.setup();
    renderNotifications();

    const trigger = screen.getByRole("button", { name: "Show First" });
    await user.click(trigger);
    const close = screen.getByRole("button", {
      name: "Close notification: First failure",
    });
    close.focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByText("First failure")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("localizes notification headings, region names, and close labels", async () => {
    await i18n.changeLanguage("ja");
    const user = userEvent.setup();
    renderNotifications();

    await user.click(screen.getByRole("button", { name: "Show First" }));

    expect(screen.getByText("エラー")).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "通知" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "エラー通知: First failure" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "通知を閉じる: First failure" }),
    ).toBeInTheDocument();
  });
});
