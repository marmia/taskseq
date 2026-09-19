import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../domain/task";
import {
  defaultViewColumns,
  defaultViewSort,
  type View,
} from "../../shared/api-schema";
import * as api from "../api-client";
import { BootstrapProvider } from "../bootstrap-state";
import { applyDisplayLanguage } from "../i18n";
import { NotFoundPage } from "../pages";
import { RouteErrorBoundary } from "../router";
import { AppSettingsProvider, useAppSettings } from "../settings-store";
import { TaskStoreProvider } from "../task-store";
import { testAreaIds, testSnapshot } from "../test/providers";
import { AppShell } from "./app-shell";

const views: View[] = [
  {
    id: "view-zulu",
    name: "Zulu Tasks",
    allTasks: true,
    conditions: [],
    sort: [...defaultViewSort],
    columns: [...defaultViewColumns],
    version: 1,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  },
  {
    id: "view-alpha",
    name: "Alpha Tasks",
    allTasks: true,
    conditions: [],
    sort: [...defaultViewSort],
    columns: [...defaultViewColumns],
    version: 1,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  },
];

const searchResult: Task = {
  ...(testSnapshot.tasks[0] as Task),
  id: "search-result",
  title: "Find the Search result",
  path: ["Develop", "Find the Search result"],
  updatedAt: "2026-08-17T00:00:00.000Z",
};

const inboxSearchResult: Task = {
  ...searchResult,
  id: "inbox-search-result",
  title: "Find the Inbox Search result",
  areaId: testAreaIds.inbox,
  path: ["Inbox", "Find the Inbox Search result"],
};

const navigationLinks = [
  ["Inbox", "/inbox"],
  ["Today", "/today"],
  ["This Week", "/week"],
  ["View", "/views"],
  ["Area", "/areas"],
  ["Trash", "/trash"],
  ["Settings", "/settings"],
] as const;

function ShellContent() {
  const { setOwnerTimeZone } = useAppSettings();

  return (
    <button
      type="button"
      onClick={() => setOwnerTimeZone("America/Los_Angeles")}
    >
      Change timezone
    </button>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    applyDisplayLanguage("en");
  });

  it("keeps the final navigation order on desktop and mobile", () => {
    renderShell();

    const expectedLabels = [
      "New",
      "Search",
      "Inbox",
      "Today",
      "This Week",
      "View",
      "Area",
      "Trash",
      "Settings",
    ];

    for (const navigation of screen.getAllByRole("navigation", {
      name: "Primary navigation",
    })) {
      expect(
        Array.from(navigation.children, (child) =>
          child.textContent?.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(expectedLabels);
      expect(
        within(navigation).getByRole("button", { name: "New" }),
      ).toBeInTheDocument();
      expect(
        within(navigation).getByRole("button", { name: "Search" }),
      ).toBeInTheDocument();
      for (const [label, href] of navigationLinks.filter(
        ([label]) => label !== "View",
      )) {
        expect(
          within(navigation).getByRole("link", { name: label }),
        ).toHaveAttribute("href", href);
      }
    }
  });

  it("localizes shell metadata while keeping navigation English in Japanese mode", () => {
    renderShell(createShellRouter(), {
      ...testSnapshot,
      ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
    });

    expect(screen.getByText("個人用ワークスペース")).toBeInTheDocument();
    expect(screen.getByText("オーナーのタイムゾーン")).toBeInTheDocument();
    for (const brandName of screen.getAllByText("Taskseq", { exact: true })) {
      expect(brandName).toHaveAttribute("lang", "en");
    }
    for (const navigation of screen.getAllByRole("navigation", {
      name: "Primary navigation",
    })) {
      const labelId = navigation.getAttribute("aria-labelledby");
      expect(labelId).not.toBeNull();
      expect(document.getElementById(labelId ?? "")).toHaveAttribute(
        "lang",
        "en",
      );
    }
    expect(screen.getAllByText("Asia/Tokyo")[0]).toHaveAttribute("lang", "en");
  });

  it("localizes the 404 page in Japanese", () => {
    render(
      <BootstrapProvider
        initialSnapshot={{
          ...testSnapshot,
          ownerSettings: {
            ...testSnapshot.ownerSettings,
            displayLanguage: "ja",
          },
        }}
      >
        <MemoryRouter>
          <NotFoundPage />
        </MemoryRouter>
      </BootstrapProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("お探しのページは存在しないか、移動しました。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "今日へ戻る" })).toHaveAttribute(
      "href",
      "/today",
    );
  });

  it("localizes a route failure and retries the loader", async () => {
    let attempts = 0;
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("health unavailable");
            return null;
          },
          element: <output>Loaded settings</output>,
          errorElement: <RouteErrorBoundary />,
        },
      ],
      { initialEntries: ["/settings"] },
    );
    const user = userEvent.setup();

    render(
      <BootstrapProvider
        initialSnapshot={{
          ...testSnapshot,
          ownerSettings: {
            ...testSnapshot.ownerSettings,
            displayLanguage: "ja",
          },
        }}
      >
        <RouterProvider router={router} />
      </BootstrapProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "このページを読み込めませんでした。",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("接続を確認して、もう一度お試しください。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByText("Loaded settings")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("navigates desktop route links and opens the New Task dialog", async () => {
    const user = userEvent.setup();
    const router = createShellRouter();
    renderShell(router);

    const desktopNavigation = screen
      .getAllByRole("navigation", { name: "Primary navigation" })
      .find((navigation) =>
        within(navigation).queryByRole("link", { name: "View" }),
      );
    expect(desktopNavigation).toBeDefined();
    if (!desktopNavigation) throw new Error("Desktop navigation is missing");

    for (const [label, path] of navigationLinks) {
      await user.click(
        within(desktopNavigation).getByRole("link", { name: label }),
      );
      expect(router.state.location.pathname).toBe(path);
      await router.navigate("/today");
    }

    await user.click(
      within(desktopNavigation).getByRole("button", { name: "New" }),
    );
    expect(
      screen.getByRole("dialog", { name: "New Task" }),
    ).toBeInTheDocument();
  });

  it("navigates mobile route links and opens its independent entry points", async () => {
    const user = userEvent.setup();
    const router = createShellRouter();
    renderShell(router, { ...testSnapshot, views });

    const mobileNavigation = screen
      .getAllByRole("navigation", { name: "Primary navigation" })
      .find((navigation) =>
        within(navigation).queryByRole("button", {
          name: "Open View menu",
        }),
      );
    expect(mobileNavigation).toBeDefined();
    if (!mobileNavigation) throw new Error("Mobile navigation is missing");

    for (const [label, path] of navigationLinks.filter(
      ([label]) => label !== "View",
    )) {
      await user.click(
        within(mobileNavigation).getByRole("link", { name: label }),
      );
      expect(router.state.location.pathname).toBe(path);
      await router.navigate("/today");
    }

    await user.click(
      within(mobileNavigation).getByRole("button", { name: "Search" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Search Tasks" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(
      within(mobileNavigation).getByRole("button", {
        name: "Open View menu",
      }),
    );
    const viewMenu = screen.getByRole("dialog", { name: "View" });
    await user.click(within(viewMenu).getByRole("link", { name: "All Views" }));
    expect(router.state.location.pathname).toBe("/views");
    await router.navigate("/today");

    await user.click(
      within(mobileNavigation).getByRole("button", {
        name: "Open View menu",
      }),
    );
    const newViewMenu = screen.getByRole("dialog", { name: "View" });
    await user.click(
      within(newViewMenu).getByRole("link", { name: "New View" }),
    );
    expect(router.state.location.pathname).toBe("/views");
    expect(router.state.location.search).toBe("?new=1");
    await router.navigate("/today");

    await user.click(
      within(mobileNavigation).getByRole("button", {
        name: "Open View menu",
      }),
    );
    const namedViewMenu = screen.getByRole("dialog", { name: "View" });
    await user.click(
      within(namedViewMenu).getByRole("link", { name: "Alpha Tasks" }),
    );
    expect(router.state.location.pathname).toBe("/views/view-alpha");
    await router.navigate("/today");

    await user.click(
      within(mobileNavigation).getByRole("button", { name: "New" }),
    );
    expect(
      screen.getByRole("dialog", { name: "New Task" }),
    ).toBeInTheDocument();
  });

  it("shows the configured Owner timezone in desktop and mobile navigation", async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <AppShell />,
          children: [{ path: "today", element: <ShellContent /> }],
        },
      ],
      { initialEntries: ["/today"] },
    );

    renderShell(router);

    expect(screen.getAllByText("Asia/Tokyo")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Change timezone" }));
    expect(screen.getAllByText("America/Los_Angeles")).toHaveLength(2);
  });

  it("opens a name-sorted desktop View submenu without management actions", async () => {
    const user = userEvent.setup();
    const router = createShellRouter();
    renderShell(router, { ...testSnapshot, views });

    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/views",
    );
    await user.click(screen.getByRole("button", { name: "Open Views" }));

    const submenu = screen.getByRole("list", { name: "Views" });
    const links = within(submenu).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Alpha Tasks",
      "Zulu Tasks",
    ]);
    expect(
      within(submenu).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      within(submenu).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    await user.click(links[0] as HTMLElement);
    expect(router.state.location.pathname).toBe("/views/view-alpha");
  });

  it("opens All Views, New View, and name-sorted Views from the mobile bottom sheet", async () => {
    const user = userEvent.setup();
    renderShell(createShellRouter(), { ...testSnapshot, views });

    await user.click(screen.getByRole("button", { name: "Open View menu" }));
    const sheet = screen.getByRole("dialog", { name: "View" });
    const links = within(sheet).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "All Views",
      "New View",
      "Alpha Tasks",
      "Zulu Tasks",
    ]);
    expect(
      within(sheet).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the View submenu English and marks its text as English in Japanese mode", async () => {
    const user = userEvent.setup();
    renderShell(createShellRouter(), {
      ...testSnapshot,
      ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
      views: [],
    });

    await user.click(screen.getByRole("button", { name: "Open Views" }));
    expect(screen.getByText("No Views yet.")).toHaveAttribute("lang", "en");

    await user.click(screen.getByRole("button", { name: "Open Views" }));
    await user.click(screen.getByRole("button", { name: "Open View menu" }));
    const mobileMenu = screen.getByRole("dialog", { name: "View" });
    expect(
      within(mobileMenu).getByText(
        "保存したビューを開いたり管理したりします。",
      ),
    ).toBeInTheDocument();
    expect(
      within(mobileMenu).getByRole("button", { name: "閉じる" }),
    ).toBeInTheDocument();
    expect(
      within(mobileMenu).getByRole("heading", { name: "View" }),
    ).toHaveAttribute("lang", "en");
    expect(
      within(mobileMenu).getByRole("link", { name: "All Views" }),
    ).toHaveAttribute("lang", "en");
    expect(
      within(mobileMenu).getByRole("link", { name: "New View" }),
    ).toHaveAttribute("lang", "en");
  });

  it("keeps the View list label fixed in English without marking View names", async () => {
    const user = userEvent.setup();
    renderShell(createShellRouter(), {
      ...testSnapshot,
      ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
      views,
    });

    await user.click(screen.getByRole("button", { name: "Open Views" }));
    const submenu = screen.getByRole("list", { name: "Views" });
    const listLabelId = submenu.getAttribute("aria-labelledby");
    expect(listLabelId).not.toBeNull();
    expect(document.getElementById(listLabelId ?? "")).toHaveAttribute(
      "lang",
      "en",
    );
    expect(
      within(submenu).getByRole("link", { name: "Alpha Tasks" }),
    ).not.toHaveAttribute("lang", "en");
  });

  it("searches by Title without leaving the current route and opens Edit Task", async () => {
    const user = userEvent.setup();
    const searchTasks = vi
      .spyOn(api, "searchTasks")
      .mockImplementation(async (query) =>
        query.toLowerCase().includes("result")
          ? { tasks: [searchResult] }
          : { tasks: [] },
      );
    const router = createShellRouter("/today");
    renderShell(router);

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);

    const dialog = screen.getByRole("dialog", { name: "Search Tasks" });
    const input = within(dialog).getByRole("searchbox", {
      name: "Search by Title",
    });
    expect(input).toHaveClass("text-base", "min-[560px]:text-sm");
    expect(router.state.location.pathname).toBe("/today");
    expect(searchTasks).not.toHaveBeenCalled();
    expect(
      within(dialog).queryByRole("list", { name: "Search results" }),
    ).not.toBeInTheDocument();

    await user.click(input);
    await user.paste("result");
    await waitFor(() => expect(searchTasks).toHaveBeenLastCalledWith("result"));
    expect(await within(dialog).findByText("1 result")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Find the Search result" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Search Tasks" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Edit Task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Find the Search result",
    );
    expect(router.state.location.pathname).toBe("/today");
  });

  it("marks fixed Inbox in Search paths while Japanese is active", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "searchTasks").mockResolvedValue({
      tasks: [inboxSearchResult],
    });
    renderShell(createShellRouter("/today"), {
      ...testSnapshot,
      ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
    });

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const dialog = screen.getByRole("dialog", { name: "タスクを検索" });
    await user.type(
      within(dialog).getByRole("searchbox", { name: "タイトルで検索" }),
      "inbox",
    );

    const result = await within(dialog).findByRole("button", {
      name: inboxSearchResult.title,
    });
    const path = result.querySelector(
      '[data-slot="search-result-path"]',
    ) as HTMLElement;
    expect(path).toHaveTextContent("Inbox / Find the Inbox Search result");
    expect(path.querySelector('[lang="en"]')).toHaveTextContent("Inbox");
  });

  it("retries a failed Search with the same query and keeps loaded results", async () => {
    const user = userEvent.setup();
    let rejectRetry: ((reason?: unknown) => void) | undefined;
    const searchTasks = vi
      .spyOn(api, "searchTasks")
      .mockResolvedValueOnce({ tasks: [searchResult] })
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectRetry = reject;
          }),
      );
    renderShell(createShellRouter("/today"));

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Search Tasks" });
    const input = within(dialog).getByRole("searchbox", {
      name: "Search by Title",
    });

    await user.click(input);
    await user.paste("result");
    expect(
      await within(dialog).findByRole("button", {
        name: "Find the Search result",
      }),
    ).toBeInTheDocument();

    await user.paste(" unavailable");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Search could not be completed.",
    );
    expect(screen.queryByLabelText("Notifications")).not.toBeInTheDocument();
    expect(input).toHaveValue("result unavailable");
    expect(
      within(dialog).getByRole("button", { name: "Find the Search result" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveValue("result unavailable");
    expect(
      within(dialog).getByRole("button", { name: "Find the Search result" }),
    ).toBeInTheDocument();
    expect(searchTasks).toHaveBeenLastCalledWith("result unavailable");

    rejectRetry?.(new Error("still unavailable"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Search could not be completed.",
    );
  });

  it("localizes Search controls and results without changing Task data or route", async () => {
    const user = userEvent.setup();
    let resolveSearch: ((response: { tasks: Task[] }) => void) | undefined;
    const searchTasks = vi.spyOn(api, "searchTasks").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    const router = createShellRouter("/views/view-alpha");
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    const secondSearchResult = {
      ...searchResult,
      id: "search-result-2",
      title: "Second Search result",
      path: ["Develop", "Second Search result"],
    };
    renderShell(router, snapshot);

    expect(document.documentElement.lang).toBe("ja");
    expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);

    const dialog = screen.getByRole("dialog", { name: "タスクを検索" });
    expect(
      within(dialog).getByText(
        "このページを離れずに、タイトルからタスクを探します。",
      ),
    ).toBeInTheDocument();
    const input = within(dialog).getByRole("searchbox", {
      name: "タイトルで検索",
    });
    expect(input).toHaveAttribute("placeholder", "タイトルで検索");
    expect(
      within(dialog).getByRole("button", { name: "閉じる" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("検索するにはタイトルを入力してください。"),
    ).toBeInTheDocument();

    await user.paste("result");
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "検索しています…",
    );
    resolveSearch?.({ tasks: [searchResult, secondSearchResult] });

    expect(
      await within(dialog).findByText("2件の検索結果"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("list", { name: "検索結果" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Find the Search result" }),
    ).toBeInTheDocument();
    const searchResultPath = within(dialog)
      .getByRole("button", { name: "Find the Search result" })
      .querySelector('[data-slot="search-result-path"]');
    expect(searchResultPath).toBeInTheDocument();
    expect(searchResultPath).toHaveTextContent(
      "Develop / Find the Search result",
    );
    expect(searchTasks).toHaveBeenLastCalledWith("result");

    await user.click(
      within(dialog).getByRole("button", { name: "Find the Search result" }),
    );
    expect(
      screen.getByRole("dialog", { name: "タスクを編集" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/views/view-alpha");
  });

  it("keeps English Search loading and empty states available", async () => {
    const user = userEvent.setup();
    let resolveSearch: ((response: { tasks: Task[] }) => void) | undefined;
    vi.spyOn(api, "searchTasks").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );
    renderShell(createShellRouter("/today"));

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Search Tasks" });
    const input = within(dialog).getByRole("searchbox", {
      name: "Search by Title",
    });
    await user.paste("missing");

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "Searching…",
    );
    resolveSearch?.({ tasks: [] });
    expect(
      await within(dialog).findByText("No matching Tasks."),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("list", { name: "Search results" }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("missing");
  });

  it("localizes Search failure and Retry while hiding the English API detail", async () => {
    const user = userEvent.setup();
    let rejectRetry: ((reason?: unknown) => void) | undefined;
    const searchTasks = vi
      .spyOn(api, "searchTasks")
      .mockRejectedValueOnce(new Error("SEARCH_QUERY_INVALID: invalid query"))
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectRetry = reject;
          }),
      );
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    renderShell(createShellRouter("/today"), snapshot);

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const dialog = screen.getByRole("dialog", { name: "タスクを検索" });
    const input = within(dialog).getByRole("searchbox", {
      name: "タイトルで検索",
    });
    await user.paste("失敗");

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("検索を完了できませんでした。");
    expect(alert).not.toHaveTextContent("SEARCH_QUERY_INVALID");
    expect(
      within(alert).getByRole("button", { name: "再試行" }),
    ).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "再試行" }));
    expect(input).toHaveValue("失敗");
    expect(searchTasks).toHaveBeenLastCalledWith("失敗");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "検索しています…",
    );

    rejectRetry?.(new Error("SEARCH_QUERY_INVALID: still invalid"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "検索を完了できませんでした。",
    );
  });

  it("shows the Japanese Search empty state", async () => {
    const user = userEvent.setup();
    const searchTasks = vi
      .spyOn(api, "searchTasks")
      .mockResolvedValue({ tasks: [] });
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    renderShell(createShellRouter("/today"), snapshot);

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const dialog = screen.getByRole("dialog", { name: "タスクを検索" });
    await user.paste("見つからない");

    expect(
      await within(dialog).findByText("一致するタスクはありません。"),
    ).toBeInTheDocument();
    expect(searchTasks).toHaveBeenLastCalledWith("見つからない");
  });

  it("closes Search without changing the current View route", async () => {
    const user = userEvent.setup();
    const searchTasks = vi.spyOn(api, "searchTasks");
    const router = createShellRouter("/views/view-alpha");
    renderShell(router, { ...testSnapshot, views });

    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Search Tasks" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(
      screen.queryByRole("dialog", { name: "Search Tasks" }),
    ).not.toBeInTheDocument();
    expect(searchTasks).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/views/view-alpha");
  });
});

function createShellRouter(initialEntry = "/today") {
  return createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell />,
        children: [
          { path: "today", element: <ShellContent /> },
          { path: "week", element: <ShellContent /> },
          { path: "inbox", element: <ShellContent /> },
          { path: "views", element: <ShellContent /> },
          { path: "views/:viewId", element: <ShellContent /> },
          { path: "areas", element: <ShellContent /> },
          { path: "trash", element: <ShellContent /> },
          { path: "settings", element: <ShellContent /> },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
}

function renderShell(router = createShellRouter(), snapshot = testSnapshot) {
  return render(
    <BootstrapProvider initialSnapshot={snapshot}>
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>
    </BootstrapProvider>,
  );
}
