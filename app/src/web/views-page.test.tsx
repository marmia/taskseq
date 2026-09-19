import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../domain/task";
import {
  defaultViewColumns,
  defaultViewSort,
  type View,
} from "../shared/api-schema";
import * as api from "./api-client";
import { BootstrapProvider } from "./bootstrap-state";
import { ViewManagementPage, ViewPage } from "./pages";
import { AppSettingsProvider } from "./settings-store";
import { TaskStoreProvider } from "./task-store";
import { testAreaIds, testSnapshot } from "./test/providers";

vi.unmock("./api-client");

const viewDates = {
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

function makeViewFixture(overrides: Partial<View> = {}): View {
  return {
    id: "view-alpha",
    name: "Alpha Tasks",
    allTasks: true,
    conditions: [],
    sort: [...defaultViewSort],
    columns: [...defaultViewColumns],
    version: 1,
    ...viewDates,
    ...overrides,
  };
}

describe("View management", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("localizes View management and definition controls in Japanese without translating View data", async () => {
    const user = userEvent.setup();
    const view = makeViewFixture({
      allTasks: false,
      conditions: [
        { field: "title", operator: "contains", value: "Owner phrase" },
      ],
    });
    renderViews({
      ...testSnapshot,
      ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
      views: [view],
    });

    expect(screen.getByRole("heading", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByText("ワークスペース")).toBeInTheDocument();
    expect(
      screen.getByText(
        "名前を付けたタスク一覧を管理します。ビューを削除してもタスクは削除されません。",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "編集" }));

    const dialog = screen.getByRole("dialog", { name: "ビューを編集" });
    expect(
      within(dialog).getByText("このビューの名前や条件を更新します。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "ビュー名" }),
    ).toHaveValue("Alpha Tasks");
    expect(
      within(dialog).getByRole("checkbox", { name: "すべてのタスク" }),
    ).not.toBeChecked();
    expect(
      within(dialog).getByRole("region", { name: "ビュー条件" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("list", { name: "ビュー条件一覧" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("listitem", { name: "タイトル" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "タイトルの条件の値" }),
    ).toHaveValue("Owner phrase");
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("localizes View validation and date calendar controls in Japanese", async () => {
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
    try {
      const user = userEvent.setup();
      renderViews({
        ...testSnapshot,
        ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
      });

      await user.click(screen.getByRole("button", { name: "新しいビュー" }));
      const dialog = screen.getByRole("dialog", { name: "新しいビュー" });
      await user.click(
        within(dialog).getByRole("checkbox", { name: "すべてのタスク" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "保存" }));
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "ビュー名は必須です",
      );
      await user.click(
        within(dialog).getByRole("checkbox", { name: "すべてのタスク" }),
      );

      const nameInput = within(dialog).getByRole("textbox", {
        name: "ビュー名",
      });
      await user.type(nameInput, "Date View");
      await user.click(
        within(dialog).getByRole("button", { name: "ビュー条件を追加" }),
      );
      const condition = within(dialog).getByRole("listitem", {
        name: "タイトル",
      });
      await user.selectOptions(
        within(condition).getByRole("combobox", { name: "条件の項目" }),
        "start",
      );
      const startCondition = within(dialog).getByRole("listitem", {
        name: "開始",
      });
      expect(
        within(startCondition).getByRole("combobox", {
          name: "開始の条件演算子",
        }),
      ).toHaveDisplayValue("=");
      await user.click(
        within(startCondition).getByRole("button", { name: "開始の日付" }),
      );

      const calendar = screen.getByRole("dialog", { name: "開始カレンダー" });
      expect(calendar).toHaveTextContent("2026年9月");
      expect(
        within(calendar).getByRole("button", { name: "前月へ移動" }),
      ).toBeInTheDocument();
      expect(
        within(calendar).getByRole("button", { name: "今月へ移動" }),
      ).toBeInTheDocument();
      expect(
        within(calendar).getByRole("button", { name: "翌月へ移動" }),
      ).toBeInTheDocument();
      expect(
        within(calendar).getByRole("button", { name: /2026年9月15日/ }),
      ).toBeInTheDocument();
      expect(
        within(calendar).getByRole("button", {
          name: /今日、2026年9月12日/,
        }),
      ).toBeInTheDocument();
      await user.click(
        within(calendar).getByRole("button", { name: /2026年9月15日/ }),
      );
      await user.click(within(calendar).getByRole("button", { name: "完了" }));
      expect(
        within(startCondition).getByRole("button", { name: "開始の日付" }),
      ).toHaveTextContent("2026/09/15");
    } finally {
      vi.useRealTimers();
    }
  });

  it("localizes View mutation recovery guidance while keeping API error details hidden", async () => {
    const user = userEvent.setup();
    const japaneseSnapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
    };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(japaneseSnapshot);
    vi.spyOn(api, "createView").mockRejectedValue(
      new api.ApiRequestError(500, "raw server response"),
    );
    renderLiveViews();

    await user.click(
      await screen.findByRole("button", { name: "新しいビュー" }),
    );
    const dialog = screen.getByRole("dialog", { name: "新しいビュー" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "ビュー名" }),
      "Japanese failure",
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "すべてのタスク" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(
      await screen.findByLabelText(
        "エラー通知: ビュー「Japanese failure」を作成できませんでした。新しいビューからもう一度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw server response")).not.toBeInTheDocument();
  });

  it("localizes View results while keeping Owner-authored Task data unchanged", async () => {
    const task = makeTaskFixture({
      id: "japanese-view-task",
      title: "Owner-authored Task",
      path: ["Develop", "Owner-authored Task"],
    });
    const view = makeViewFixture({
      allTasks: false,
      conditions: [
        { field: "title", operator: "contains", value: "Owner-authored" },
      ],
      columns: ["title", "area", "path", "description"],
    });
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [task],
      nextCursor: null,
    });

    renderViews(
      {
        ...testSnapshot,
        ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
        views: [view],
      },
      ["/views/view-alpha"],
    );

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    expect(screen.getByText("ビュー")).toBeInTheDocument();
    expect(screen.getByText("1件の条件")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ビュー条件を開く" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "並べ替えを開く" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "表示カラムを開く" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
    expect(screen.getByText("1件のタスク")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "ビューの結果一覧" });
    expect(table).toBeInTheDocument();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["タイトル", "エリア", "パス", "説明"]);
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.getAttribute("aria-label")),
    ).toEqual(["タイトル", "エリア", "パス", "説明"]);
    expect(within(table).getAllByText("Owner-authored Task")).not.toHaveLength(
      0,
    );
  });

  it("localizes Japanese Sort and Columns controls with their ARIA labels", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    renderViews(
      {
        ...testSnapshot,
        ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
        views: [makeViewFixture()],
      },
      ["/views/view-alpha"],
    );

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "並べ替えを開く" }));
    const sortDialog = screen.getByRole("dialog", { name: "ビューの並べ替え" });
    expect(
      within(sortDialog).getByText(
        "最初の条件が最も優先されます。未設定の値は最後に表示されます。",
      ),
    ).toBeInTheDocument();
    expect(
      within(sortDialog).getByRole("list", { name: "並べ替え条件一覧" }),
    ).toBeInTheDocument();
    expect(
      within(sortDialog).getByRole("listitem", {
        name: "並べ替え条件: 更新日時",
      }),
    ).toBeInTheDocument();
    expect(
      within(sortDialog).getByRole("combobox", { name: "並べ替え方向1" }),
    ).toHaveDisplayValue("降順");
    expect(
      within(sortDialog).getByRole("button", { name: "並べ替え条件を追加" }),
    ).toBeInTheDocument();
    expect(
      within(sortDialog).getByRole("button", { name: "並べ替えをリセット" }),
    ).toBeInTheDocument();

    await user.click(
      within(sortDialog).getByRole("button", { name: "閉じる" }),
    );
    await user.click(screen.getByRole("button", { name: "表示カラムを開く" }));
    const columnsDialog = screen.getByRole("dialog", { name: "表示カラム" });
    expect(
      within(columnsDialog).getByText(
        "タイトルは左側に表示されます。ドラッグまたはキーボードで、ほかのカラムの順序を変更できます。",
      ),
    ).toBeInTheDocument();
    expect(within(columnsDialog).getByText("表示／非表示")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "カラムを移動するにはスペースキーを押します。移動中は矢印キーで移動します。もう一度スペースキーを押すと新しい位置に配置し、Escキーを押すとキャンセルします。",
      ),
    ).toBeInTheDocument();
    expect(
      within(columnsDialog).getByRole("checkbox", { name: "タイトルを表示" }),
    ).toBeDisabled();
    expect(
      within(columnsDialog).getByRole("list", { name: "表示カラムの順序" }),
    ).toBeInTheDocument();
    expect(
      within(columnsDialog).getByRole("button", {
        name: "表示カラムをリセット",
      }),
    ).toBeInTheDocument();
  });

  it("localizes View result content actions while preserving fixed and Owner data", async () => {
    const user = userEvent.setup();
    const task = makeTaskFixture({
      id: "japanese-view-content-task",
      title: "Owner-authored Task",
      areaId: testAreaIds.inbox,
      path: ["Inbox", "Owner-authored Task"],
      description: "Owner-authored description",
      workNotes: "Owner-authored work notes",
    });
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [task],
      nextCursor: null,
    });

    renderViews(
      {
        ...testSnapshot,
        ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
        tasks: [task],
        views: [makeViewFixture({ columns: ["title", "area", "description"] })],
      },
      ["/views/view-alpha"],
    );

    const table = await screen.findByRole("table", {
      name: "ビューの結果一覧",
    });
    expect(
      within(table).getByRole("button", {
        name: "Owner-authored Taskを編集",
      }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", {
        name: "Owner-authored Taskの操作",
      }),
    ).toBeInTheDocument();
    expect(
      within(table)
        .getAllByText("Inbox")
        .some((element) => element.getAttribute("lang") === "en"),
    ).toBe(true);

    await user.click(
      within(table).getByRole("button", {
        name: "Owner-authored Taskの説明を開く",
      }),
    );
    const viewer = screen.getByRole("dialog", { name: "説明" });
    expect(viewer).toHaveTextContent("Owner-authored description");
    expect(
      within(viewer).getByRole("button", { name: "説明を閉じる" }),
    ).toBeInTheDocument();
  });

  it("localizes View result loading, recovery, pagination, and empty states", async () => {
    const user = userEvent.setup();
    let rejectInitial!: (error: unknown) => void;
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectInitial = reject;
          }),
      )
      .mockResolvedValueOnce({ tasks: [], nextCursor: "100" })
      .mockRejectedValueOnce(new api.ApiRequestError(500, "raw page detail"))
      .mockResolvedValueOnce({ tasks: [], nextCursor: null });

    renderViews(
      {
        ...testSnapshot,
        ownerSettings: { ...testSnapshot.ownerSettings, displayLanguage: "ja" },
        views: [makeViewFixture()],
      },
      ["/views/view-alpha"],
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "ビューの結果を読み込んでいます…",
    );
    rejectInitial(new Error("raw initial detail"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "このビューを読み込めませんでした。もう一度お試しください。",
    );
    expect(screen.queryByText("raw initial detail")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByText("0件のタスク")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "さらに読み込む" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "タスクを追加で読み込めませんでした。もう一度お試しください。",
    );
    expect(screen.queryByText("raw page detail")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(
      await screen.findByText("このビューに一致するタスクはありません。"),
    ).toBeInTheDocument();
    expect(loadViewTasks).toHaveBeenNthCalledWith(4, "view-alpha", "100");
  });

  it("localizes automatic View result setting failures without exposing API details", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      ownerSettings: {
        ...testSnapshot.ownerSettings,
        displayLanguage: "ja" as const,
      },
      views: [makeViewFixture()],
    };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    vi.spyOn(api, "updateView").mockRejectedValue(
      new api.ApiRequestError(500, "raw Sort API detail"),
    );

    renderLiveViews(["/views/view-alpha"]);
    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "並べ替えを開く" }));
    const dialog = screen.getByRole("dialog", { name: "ビューの並べ替え" });
    await user.click(
      within(dialog).getByRole("button", { name: "並べ替えをリセット" }),
    );

    expect(
      await screen.findByLabelText(
        "エラー通知: ビュー「Alpha Tasks」の並べ替えを保存できませんでした。このビューから並べ替えを変更して、もう一度お試しください。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw Sort API detail")).not.toBeInTheDocument();
  });

  it("shows the empty state and New View entry point", () => {
    renderViews();

    expect(screen.getByRole("heading", { name: "Views" })).toBeInTheDocument();
    expect(screen.getByText("No Views yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New View" })).toBeVisible();
  });

  it("lists Views by name and supports creating an explicit All Tasks View", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    const router = renderViews({
      ...testSnapshot,
      views: [
        makeViewFixture({ id: "view-zulu", name: "Zulu Tasks" }),
        makeViewFixture(),
      ],
    });

    const rows = screen.getByRole("list", { name: "Views" });
    const names = within(rows).getAllByRole("heading", { level: 2 });
    expect(names.map((heading) => heading.textContent)).toEqual([
      "Alpha Tasks",
      "Zulu Tasks",
    ]);

    await user.click(screen.getByRole("button", { name: "New View" }));
    const dialog = screen.getByRole("dialog", { name: "New View" });
    expect(
      within(dialog).getByRole("textbox", { name: "View name" }),
    ).toHaveClass("text-base", "min-[560px]:text-sm");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.type(
      within(dialog).getByRole("textbox", { name: "View name" }),
      "All Tasks",
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "All Tasks" }),
    );
    expect(save).toBeEnabled();
    await user.click(save);

    expect(router.state.location.pathname).toMatch(/^\/views\//);
    expect(
      await screen.findByRole("heading", { name: "All Tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /notification/i }),
    ).not.toBeInTheDocument();
  });

  it("opens a View from its Title while keeping management actions independent", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    const router = renderViews({
      ...testSnapshot,
      views: [makeViewFixture()],
    });
    const row = screen.getByRole("listitem", { name: "Alpha Tasks" });

    const titleLink = within(row).getByRole("link", { name: "Alpha Tasks" });
    expect(titleLink).toHaveAttribute("href", "/views/view-alpha");
    expect(
      within(row).queryByRole("link", { name: "Open" }),
    ).not.toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Edit" }));
    expect(router.state.location.pathname).toBe("/views");
    await user.click(
      within(screen.getByRole("dialog", { name: "Edit View" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );

    await user.click(titleLink);
    expect(router.state.location.pathname).toBe("/views/view-alpha");
    expect(
      await screen.findByRole("heading", { name: "Alpha Tasks" }),
    ).toBeInTheDocument();
  });

  it("adds View conditions in order, prevents duplicate fields, and clears them for All Tasks", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderViews();

    await user.click(screen.getByRole("button", { name: "New View" }));
    const dialog = screen.getByRole("dialog", { name: "New View" });
    expect(
      within(dialog).queryByText(
        "Define the named Task list to keep in your workspace.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        "All conditions match together. Add each field once.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Excludes Trash"),
    ).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: "View name" }),
      "Conditional View",
    );

    const addCondition = within(dialog).getByRole("button", {
      name: "Add View condition",
    });
    await user.click(addCondition);

    const conditions = within(dialog).getByRole("list", {
      name: "View condition list",
    });
    const firstCondition = within(conditions).getByRole("listitem", {
      name: "Title",
    });
    expect(firstCondition).toBeInTheDocument();
    const firstField = within(firstCondition).getByRole("combobox", {
      name: "Condition field",
    });
    expect(firstField).toHaveValue("title");
    expect(firstField).toHaveDisplayValue("Title");
    await user.selectOptions(firstField, "description");
    expect(
      within(conditions).getByRole("listitem", { name: "Description" }),
    ).toBeInTheDocument();
    await user.click(addCondition);
    const titleCondition = within(conditions).getByRole("listitem", {
      name: "Title",
    });
    await user.selectOptions(
      within(titleCondition).getByRole("combobox", {
        name: "Condition field",
      }),
      "area",
    );
    const areaCondition = within(conditions).getByRole("listitem", {
      name: "Area",
    });
    const areaValues = within(areaCondition).getByRole("combobox", {
      name: "Areas",
    });
    expect(areaValues).toHaveClass("text-base", "min-[560px]:text-sm");
    await user.click(areaValues);
    const areaOption = screen.getByRole("button", { name: "AI/IT" });
    await user.click(areaOption);
    expect(areaValues).toHaveValue("AI/IT");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();

    await user.click(
      within(dialog).getByRole("checkbox", { name: "All Tasks" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "Turn on All Tasks and remove all current conditions?",
    );
    expect(
      within(dialog).queryByRole("list", { name: "View condition list" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("checkbox", { name: "All Tasks" }),
    ).toBeChecked();

    await user.click(
      within(dialog).getByRole("checkbox", { name: "All Tasks" }),
    );
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("uses case-insensitive Area suggestions, excludes trashed Areas, and accepts unregistered names", async () => {
    const user = userEvent.setup();
    const createView = vi.spyOn(api, "createView").mockResolvedValue({
      ...testSnapshot,
      views: [
        makeViewFixture({
          id: "view-area",
          name: "Area View",
          allTasks: false,
          conditions: [
            {
              field: "area",
              operator: "isAnyOf",
              value: ["Develop", "Future Area", "develop"],
            },
          ],
        }),
      ],
    });
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    const trashedArea = {
      id: 999,
      name: "Archived Area",
      color: "gray" as const,
      position: 8,
      isSystemManaged: false,
      trashedAt: "2026-08-01T00:00:00.000Z",
    };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue({
      ...testSnapshot,
      areas: [...testSnapshot.areas, trashedArea],
    });
    renderLiveViews();

    await user.click(await screen.findByRole("button", { name: "New View" }));
    const dialog = screen.getByRole("dialog", { name: "New View" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "View name" }),
      "Area View",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add View condition" }),
    );
    const conditionList = within(dialog).getByRole("list", {
      name: "View condition list",
    });
    const titleCondition = within(conditionList).getByRole("listitem", {
      name: "Title",
    });
    await user.selectOptions(
      within(titleCondition).getByRole("combobox", {
        name: "Condition field",
      }),
      "area",
    );
    const areaCondition = within(conditionList).getByRole("listitem", {
      name: "Area",
    });
    const areaInput = within(areaCondition).getByRole("combobox", {
      name: "Areas",
    });

    await user.click(areaInput);
    expect(screen.getByRole("button", { name: "Inbox" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Archived Area" }),
    ).not.toBeInTheDocument();
    await user.type(areaInput, "dEv");
    expect(screen.getByRole("button", { name: "Develop" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Develop" }));
    expect(areaInput).toHaveValue("Develop");

    await user.clear(areaInput);
    await user.type(areaInput, " Develop, Future Area, develop, , Develop ");
    expect(areaInput).toHaveValue(" Develop, Future Area, develop, , Develop ");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(createView).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: [
          {
            field: "area",
            operator: "isAnyOf",
            value: ["Develop", "Future Area", "develop"],
          },
        ],
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Area View" }),
    ).toBeInTheDocument();
  });

  it("uses tag autocomplete for a Tag condition", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    renderViews({
      ...testSnapshot,
      tags: [...testSnapshot.tags, { id: 100, name: "CloudOps" }],
    });

    await user.click(screen.getByRole("button", { name: "New View" }));
    const dialog = screen.getByRole("dialog", { name: "New View" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "View name" }),
      "Tag View",
    );

    const addCondition = within(dialog).getByRole("button", {
      name: "Add View condition",
    });
    await user.click(addCondition);
    const conditionList = within(dialog).getByRole("list", {
      name: "View condition list",
    });
    const titleCondition = within(conditionList).getByRole("listitem", {
      name: "Title",
    });
    await user.selectOptions(
      within(titleCondition).getByRole("combobox", {
        name: "Condition field",
      }),
      "tag",
    );

    const tagCondition = within(conditionList).getByRole("listitem", {
      name: "Tag",
    });
    const tags = within(tagCondition).getByRole("combobox", {
      name: "Tags",
    });
    await user.click(tags);
    await user.type(tags, "ops");
    expect(screen.getByRole("button", { name: "CloudOps" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "CloudOps" }));
    await user.clear(tags);
    await user.type(tags, "clo");
    await user.click(screen.getByRole("button", { name: "cloudflare" }));

    expect(tags).toHaveValue("cloudflare");
    expect(tags).toHaveClass("min-h-9", "py-1", "max-[559px]:text-base");
    const operator = within(tagCondition).getByRole("combobox", {
      name: "Tag condition operator",
    });
    expect(operator).toHaveValue("containsAll");
    await user.selectOptions(operator, "containsNone");
    expect(tags).toHaveValue("cloudflare");
    await user.clear(tags);
    await user.type(tags, "future");
    expect(tags).toHaveValue("future");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Tag View" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Back" }));
    await screen.findByRole("heading", { name: "Views" });
    await user.click(
      within(screen.getByRole("listitem", { name: "Tag View" })).getByRole(
        "button",
        { name: "Edit" },
      ),
    );
    expect(
      within(screen.getByRole("dialog", { name: "Edit View" })).getByRole(
        "combobox",
        { name: "Tags" },
      ),
    ).toHaveValue("future");
  });

  it("supports date operators and selects a date-only range with the custom calendar", async () => {
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
    try {
      const user = userEvent.setup();
      renderViews();

      await user.click(screen.getByRole("button", { name: "New View" }));
      const dialog = screen.getByRole("dialog", { name: "New View" });
      await user.type(
        within(dialog).getByRole("textbox", { name: "View name" }),
        "Date View",
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Add View condition" }),
      );

      const conditionList = within(dialog).getByRole("list", {
        name: "View condition list",
      });
      const titleCondition = within(conditionList).getByRole("listitem", {
        name: "Title",
      });
      await user.selectOptions(
        within(titleCondition).getByRole("combobox", {
          name: "Condition field",
        }),
        "start",
      );
      const startCondition = within(conditionList).getByRole("listitem", {
        name: "Start",
      });
      const operator = within(startCondition).getByRole("combobox", {
        name: "Start condition operator",
      });
      expect(operator).toHaveValue("equals");
      expect(within(operator).getAllByRole("option")).toHaveLength(7);

      await user.click(
        within(startCondition).getByRole("button", { name: "Start date" }),
      );
      const calendar = screen.getByRole("dialog", { name: "Start calendar" });
      expect(calendar).toHaveTextContent("September 2026");
      await user.click(
        within(calendar).getByRole("button", { name: /September 15/ }),
      );
      await user.click(within(calendar).getByRole("button", { name: "Done" }));
      expect(
        within(startCondition).getByRole("button", { name: "Start date" }),
      ).toHaveTextContent("2026/09/15");

      await user.selectOptions(operator, "between");
      expect(
        within(startCondition).getByRole("button", { name: "Start from" }),
      ).toHaveTextContent("2026/09/15");
      expect(
        within(startCondition).getByRole("button", { name: "Start to" }),
      ).toHaveTextContent("To");

      await user.click(
        within(startCondition).getByRole("button", { name: "Start from" }),
      );
      const rangeCalendar = screen.getByRole("dialog", {
        name: "Start calendar",
      });
      await user.click(
        within(rangeCalendar).getByRole("button", { name: "Clear" }),
      );
      await user.click(
        within(startCondition).getByRole("button", { name: "Start from" }),
      );
      const restartedRangeCalendar = screen.getByRole("dialog", {
        name: "Start calendar",
      });
      await user.click(
        within(restartedRangeCalendar).getByRole("button", {
          name: /September 20/,
        }),
      );
      await user.click(
        within(restartedRangeCalendar).getByRole("button", {
          name: /September 10/,
        }),
      );
      await user.click(
        within(restartedRangeCalendar).getByRole("button", { name: "Done" }),
      );
      expect(
        within(startCondition).getByRole("button", { name: "Start from" }),
      ).toHaveTextContent("2026/09/10");
      expect(
        within(startCondition).getByRole("button", { name: "Start to" }),
      ).toHaveTextContent("2026/09/20");

      await user.click(
        within(startCondition).getByRole("button", { name: "Start from" }),
      );
      const restartedCalendar = screen.getByRole("dialog", {
        name: "Start calendar",
      });
      await user.click(
        within(restartedCalendar).getByRole("button", { name: /September 25/ }),
      );
      await user.click(
        within(restartedCalendar).getByRole("button", { name: /September 25/ }),
      );
      await user.click(
        within(restartedCalendar).getByRole("button", { name: "Done" }),
      );
      expect(
        within(startCondition).getByRole("button", { name: "Start from" }),
      ).toHaveTextContent("2026/09/25");
      expect(
        within(startCondition).getByRole("button", { name: "Start to" }),
      ).toHaveTextContent("2026/09/25");

      await user.click(
        within(startCondition).getByRole("button", { name: "Start from" }),
      );
      const restartedSameDayCalendar = screen.getByRole("dialog", {
        name: "Start calendar",
      });
      await user.click(
        within(restartedSameDayCalendar).getByRole("button", {
          name: /September 25/,
        }),
      );
      expect(
        within(startCondition).getByRole("button", { name: "Start from" }),
      ).toHaveTextContent("2026/09/25");
      expect(
        within(startCondition).getByRole("button", { name: "Start to" }),
      ).toHaveTextContent("To");
      await user.click(
        within(restartedSameDayCalendar).getByRole("button", { name: "Done" }),
      );

      await user.selectOptions(operator, "before");
      expect(
        within(startCondition).getByRole("button", { name: "Start date" }),
      ).toHaveTextContent("2026/09/25");
      await user.selectOptions(operator, "isUnset");
      expect(
        within(startCondition).queryByRole("button", { name: "Start date" }),
      ).not.toBeInTheDocument();
      await user.selectOptions(operator, "equals");
      expect(
        within(startCondition).getByRole("button", { name: "Start date" }),
      ).toHaveTextContent("Add date");
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  it("shows all incomplete condition errors at once and keeps the dialog draft", async () => {
    const user = userEvent.setup();
    renderViews();

    await user.click(screen.getByRole("button", { name: "New View" }));
    const dialog = screen.getByRole("dialog", { name: "New View" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "View name" }),
      "Incomplete View",
    );
    const addCondition = within(dialog).getByRole("button", {
      name: "Add View condition",
    });
    await user.click(addCondition);
    await user.click(addCondition);
    const conditionList = within(dialog).getByRole("list", {
      name: "View condition list",
    });
    const descriptionCondition = within(conditionList).getByRole("listitem", {
      name: "Description",
    });
    await user.selectOptions(
      within(descriptionCondition).getByRole("combobox", {
        name: "Condition field",
      }),
      "start",
    );
    expect(
      within(descriptionCondition).getByRole("combobox", {
        name: "Condition field",
      }),
    ).toHaveClass("text-base", "min-[560px]:text-sm");
    await user.selectOptions(
      within(dialog).getByRole("combobox", {
        name: "Start condition operator",
      }),
      "between",
    );
    expect(
      within(dialog).getByRole("combobox", {
        name: "Start condition operator",
      }),
    ).toHaveClass("text-base", "min-[560px]:text-sm");
    expect(
      within(dialog).getByRole("button", { name: "Start from" }),
    ).toHaveTextContent("From");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(within(dialog).getAllByRole("alert").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      within(dialog).getByRole("textbox", { name: "Title condition value" }),
    ).toHaveValue("");
    expect(
      within(dialog).getByRole("button", { name: "Start from" }),
    ).toHaveTextContent("From");
    expect(
      screen.getByRole("dialog", { name: "New View" }),
    ).toBeInTheDocument();

    await user.type(
      within(dialog).getByRole("textbox", { name: "Title condition value" }),
      "title",
    );
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(
      within(dialog).getByRole("button", { name: "Start from" }),
    ).toHaveTextContent("From");

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "New View" }));
    expect(
      within(screen.getByRole("dialog", { name: "New View" })).queryAllByRole(
        "alert",
      ),
    ).toHaveLength(0);
  });

  it("enables Edit Save only for a changed name and deletes a View after confirmation", async () => {
    const user = userEvent.setup();
    renderViews({ ...testSnapshot, views: [makeViewFixture()] });
    const row = screen.getByRole("listitem", { name: "Alpha Tasks" });

    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit View" });
    const save = within(editDialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const nameInput = within(editDialog).getByRole("textbox", {
      name: "View name",
    });
    await user.clear(nameInput);
    await user.type(nameInput, "  Alpha Tasks  ");
    expect(save).toBeDisabled();
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Tasks");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(
      await screen.findByRole("heading", { name: "Renamed Tasks" }),
    ).toBeInTheDocument();

    const renamedRow = screen.getByRole("listitem", { name: "Renamed Tasks" });
    await user.click(
      within(renamedRow).getByRole("button", { name: "Delete" }),
    );
    const confirmation = screen.getByRole("dialog", { name: "Delete View" });
    expect(confirmation).toHaveTextContent("Renamed Tasks");
    expect(confirmation).toHaveTextContent("Tasks are not deleted");
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );
    expect(screen.getByText("No Views yet.")).toBeInTheDocument();
  });

  it("returns from a missing View route with a one-time Info notification", async () => {
    const router = renderViews(testSnapshot, ["/views/missing-view"]);

    expect(
      await screen.findByRole("heading", { name: "Views" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Info notification: View was not found."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/views");
    expect(router.state.location.state).toBeNull();

    await router.navigate("/views");
    expect(
      screen.getAllByLabelText("Info notification: View was not found."),
    ).toHaveLength(1);
    cleanup();
    renderViews(testSnapshot, ["/views"]);
    expect(
      screen.queryByLabelText("Info notification: View was not found."),
    ).not.toBeInTheDocument();
  });

  it("loads an All Tasks result table with its count and initial columns", async () => {
    const tasks = testSnapshot.tasks
      .filter((task) => !task.trashedAt)
      .slice(0, 2);
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks,
      nextCursor: null,
    });
    renderViews({ ...testSnapshot, views: [makeViewFixture()] }, [
      "/views/view-alpha",
    ]);

    expect(
      await screen.findByRole("heading", { name: "Alpha Tasks" }),
    ).toBeInTheDocument();
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("2 Tasks")).toBeInTheDocument();

    const controls = screen.getByRole("toolbar", {
      name: "View result controls",
    });
    expect(
      within(controls)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["All", "Sort", "Columns", "Delete"]);
    expect(controls).toHaveTextContent(/2 Tasks.*All.*Sort.*Columns.*Delete/);
    expect(
      within(controls).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(controls.querySelector(".ml-auto")).not.toBeNull();

    const table = await screen.findByRole("table", {
      name: "View results table",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Title", "Area", "Path", "Start", "Due", "Updated"]);
    expect(
      within(table).getAllByText(tasks[0]?.title ?? "").length,
    ).toBeGreaterThan(0);
    expect(
      within(table).getAllByRole("button", {
        name: /^(?:Complete|Reopen) /,
      }),
    ).toHaveLength(tasks.length);
    expect(
      within(table).getAllByRole("button", { name: / actions$/ }),
    ).toHaveLength(tasks.length);
    expect(
      within(table).queryByRole("button", { name: /を並べ替え$/ }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole("button", { name: "Add column" }),
    ).not.toBeInTheDocument();
  });

  it("loads the next View result page and appends tasks", async () => {
    const user = userEvent.setup();
    const firstTask = testSnapshot.tasks[0];
    const secondTask = testSnapshot.tasks[1];
    if (!firstTask || !secondTask) throw new Error("Test tasks are missing");
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockResolvedValueOnce({ tasks: [firstTask], nextCursor: "100" })
      .mockResolvedValueOnce({ tasks: [secondTask], nextCursor: null });
    renderViews({ ...testSnapshot, views: [makeViewFixture()] }, [
      "/views/view-alpha",
    ]);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByText(secondTask.title)).toBeInTheDocument();
    expect(loadViewTasks).toHaveBeenNthCalledWith(1, "view-alpha");
    expect(loadViewTasks).toHaveBeenNthCalledWith(2, "view-alpha", "100");
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("retries a failed next View result page from the same cursor without losing loaded tasks", async () => {
    const user = userEvent.setup();
    const firstTask = testSnapshot.tasks[0];
    const secondTask = testSnapshot.tasks[1];
    if (!firstTask || !secondTask) throw new Error("Test tasks are missing");
    let resolveRetry:
      | ((result: { tasks: Task[]; nextCursor: string | null }) => void)
      | undefined;
    const retryResult = new Promise<{
      tasks: Task[];
      nextCursor: string | null;
    }>((resolve) => {
      resolveRetry = resolve;
    });
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockResolvedValueOnce({ tasks: [firstTask], nextCursor: "100" })
      .mockRejectedValueOnce(new Error("network failure"))
      .mockImplementationOnce(() => retryResult);
    renderViews({ ...testSnapshot, views: [makeViewFixture()] }, [
      "/views/view-alpha",
    ]);

    await user.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load more Tasks. Try again.",
    );
    const table = screen.getByRole("table", { name: "View results table" });
    expect(within(table).getAllByText(firstTask.title).length).toBeGreaterThan(
      0,
    );
    expect(within(table).queryByText(secondTask.title)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Retry$/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Retry$/ }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Loading…$/ })).toBeDisabled();
    resolveRetry?.({ tasks: [secondTask], nextCursor: null });

    expect(
      (await within(table).findAllByText(secondTask.title)).length,
    ).toBeGreaterThan(0);
    expect(loadViewTasks).toHaveBeenNthCalledWith(1, "view-alpha");
    expect(loadViewTasks).toHaveBeenNthCalledWith(2, "view-alpha", "100");
    expect(loadViewTasks).toHaveBeenNthCalledWith(3, "view-alpha", "100");
    expect(
      screen.queryByRole("button", { name: /^Retry$/ }),
    ).not.toBeInTheDocument();
  });

  it("returns to the View list after deleting the current View", async () => {
    const user = userEvent.setup();
    const snapshot = { ...testSnapshot, views: [makeViewFixture()] };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);
    vi.spyOn(api, "deleteView").mockResolvedValue({
      ...snapshot,
      views: [],
    });
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    const router = renderLiveViews(["/views/view-alpha"]);
    const navigate = vi.spyOn(router, "navigate");

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("dialog", { name: "Delete View" });
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Views" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/views");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]?.[0]).toBe("/views");
  });

  it("keeps missing View notices for another route during deletion", async () => {
    const user = userEvent.setup();
    const snapshot = {
      ...testSnapshot,
      views: [
        makeViewFixture(),
        makeViewFixture({ id: "view-beta", name: "Beta Tasks" }),
      ],
    };
    const deletedSnapshot = {
      ...snapshot,
      views: [makeViewFixture({ id: "view-beta", name: "Beta Tasks" })],
    };
    let resolveDelete: ((nextSnapshot: typeof snapshot) => void) | undefined;
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    vi.spyOn(api, "deleteView").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const router = renderLiveViews(["/views/view-alpha"]);
    const navigate = vi.spyOn(router, "navigate");

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("dialog", { name: "Delete View" });
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );
    expect(api.deleteView).toHaveBeenCalledWith("view-alpha");
    await router.navigate("/views/missing-view");

    expect(
      await screen.findByRole("heading", { name: "Views" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Info notification: View was not found."),
    ).toBeInTheDocument();
    const navigationCountBeforeDeleteResolution = navigate.mock.calls.length;
    resolveDelete?.(deletedSnapshot);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigate.mock.calls).toHaveLength(
      navigationCountBeforeDeleteResolution,
    );
    expect(
      await screen.findByLabelText("Info notification: View was not found."),
    ).toBeInTheDocument();
  });

  it("ignores a stale result 404 while deleting the current View", async () => {
    const user = userEvent.setup();
    const snapshot = { ...testSnapshot, views: [makeViewFixture()] };
    let rejectViewTasks: ((error: unknown) => void) | undefined;
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);
    vi.spyOn(api, "loadViewTasks").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectViewTasks = reject;
        }),
    );
    vi.spyOn(api, "deleteView").mockImplementation(async () => {
      if (!rejectViewTasks) throw new Error("View results did not start");
      rejectViewTasks(
        new api.ApiRequestError(404, "View was not found", "VIEW_NOT_FOUND"),
      );
      return { ...snapshot, views: [] };
    });
    const router = renderLiveViews(["/views/view-alpha"]);

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("dialog", { name: "Delete View" });
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Views" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/views");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an empty state after retrying a failed View result request", async () => {
    const user = userEvent.setup();
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockRejectedValueOnce(new Error("network failure"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ tasks: [], nextCursor: null }), 0);
          }),
      );
    renderViews({ ...testSnapshot, views: [makeViewFixture()] }, [
      "/views/view-alpha",
    ]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load this View.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open View filters" }),
    ).toHaveTextContent("All");
    expect(
      await screen.findByText("No Tasks in this View."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 Tasks")).toBeInTheDocument();
    expect(loadViewTasks).toHaveBeenNthCalledWith(1, "view-alpha");
    expect(loadViewTasks).toHaveBeenNthCalledWith(2, "view-alpha");
  });

  it("shows the initial View result error again when Retry fails", async () => {
    const user = userEvent.setup();
    let rejectRetry: ((reason?: unknown) => void) | undefined;
    const retryResult = new Promise<{
      tasks: Task[];
      nextCursor: string | null;
    }>((_resolve, reject) => {
      rejectRetry = reject;
    });
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockRejectedValueOnce(new Error("first network failure"))
      .mockImplementationOnce(() => retryResult);
    renderViews({ ...testSnapshot, views: [makeViewFixture()] }, [
      "/views/view-alpha",
    ]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load this View.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rejectRetry?.(new Error("second network failure"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load this View.",
    );
    expect(loadViewTasks).toHaveBeenNthCalledWith(1, "view-alpha");
    expect(loadViewTasks).toHaveBeenNthCalledWith(2, "view-alpha");
  });

  it("redirects a missing View result to the View list with an Info notification", async () => {
    vi.spyOn(api, "loadViewTasks").mockRejectedValue(
      new api.ApiRequestError(404, "View was not found", "VIEW_NOT_FOUND"),
    );
    const router = renderViews(
      { ...testSnapshot, views: [makeViewFixture()] },
      ["/views/view-alpha"],
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/views");
    });
    expect(
      await screen.findByRole("heading", { name: "Views" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Info notification: View was not found."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.state.location.state).toBeNull();
  });

  it("redirects a missing View during pagination with an Info notification", async () => {
    const user = userEvent.setup();
    const firstTask = testSnapshot.tasks[0];
    if (!firstTask) throw new Error("Test task is missing");
    vi.spyOn(api, "loadViewTasks")
      .mockResolvedValueOnce({ tasks: [firstTask], nextCursor: "100" })
      .mockRejectedValueOnce(
        new api.ApiRequestError(404, "View was not found", "VIEW_NOT_FOUND"),
      );
    const router = renderViews(
      { ...testSnapshot, views: [makeViewFixture()] },
      ["/views/view-alpha"],
    );

    await user.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/views");
    });
    expect(
      await screen.findByLabelText("Info notification: View was not found."),
    ).toBeInTheDocument();
    expect(router.state.location.state).toBeNull();
  });

  it("reports a failed create as an Error, keeps the draft, and retries from Save", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(testSnapshot);
    const createView = vi
      .spyOn(api, "createView")
      .mockRejectedValueOnce(
        new api.ApiRequestError(500, "raw server response"),
      )
      .mockResolvedValueOnce({
        ...testSnapshot,
        views: [
          makeViewFixture({ id: "view-created", name: "Duplicate View" }),
        ],
      });
    renderLiveViews();

    await user.click(await screen.findByRole("button", { name: "New View" }));
    const dialog = screen.getByRole("dialog", { name: "New View" });
    const nameInput = within(dialog).getByRole("textbox", {
      name: "View name",
    });
    await user.type(nameInput, "Duplicate View");
    await user.click(
      within(dialog).getByRole("checkbox", { name: "All Tasks" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByLabelText(
        "Error notification: Could not create “Duplicate View”. Try again from New View.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("raw server response")).not.toBeInTheDocument();
    expect(nameInput).toHaveValue("Duplicate View");
    expect(
      screen.getByRole("dialog", { name: "New View" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("heading", { name: "Duplicate View" }),
    ).toBeInTheDocument();
    expect(createView).toHaveBeenCalledTimes(2);
  });

  it("maps View API validation to the field and clears it when corrected", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(testSnapshot);
    vi.spyOn(api, "createView").mockRejectedValue(
      new api.ApiRequestError(400, "raw API response", "VIEW_VALIDATION", {
        name: "View name is already used.",
      }),
    );
    renderLiveViews();

    await user.click(await screen.findByRole("button", { name: "New View" }));
    const dialog = screen.getByRole("dialog", { name: "New View" });
    const nameInput = within(dialog).getByRole("textbox", {
      name: "View name",
    });
    await user.type(nameInput, "Duplicate View");
    await user.click(
      within(dialog).getByRole("checkbox", { name: "All Tasks" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("View name is already used."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /notification/i }),
    ).not.toBeInTheDocument();

    await user.clear(nameInput);
    await user.type(nameInput, "Available View");
    expect(
      within(dialog).queryByText("View name is already used."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "New View" }),
    ).toBeInTheDocument();
  });

  it("keeps edited input and reloads the latest View after a conflict", async () => {
    const user = userEvent.setup();
    const initialSnapshot = {
      ...testSnapshot,
      views: [makeViewFixture()],
    };
    const latestSnapshot = {
      ...testSnapshot,
      views: [makeViewFixture({ name: "Server View", version: 2 })],
    };
    vi.spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValue(latestSnapshot);
    vi.spyOn(api, "updateView").mockRejectedValue(
      new api.ApiRequestError(
        409,
        "View changed elsewhere",
        "VIEW_VERSION_CONFLICT",
      ),
    );
    renderLiveViews();

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit View" });
    const nameInput = within(dialog).getByRole("textbox", {
      name: "View name",
    });
    await user.clear(nameInput);
    await user.type(nameInput, "Client View");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByLabelText(
        "Warning notification: Could not save “Client View”. Review the latest View and try again from Edit View.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(nameInput).toHaveValue("Client View");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByRole("listitem", { name: "Server View" }),
    ).toBeInTheDocument();
  });

  it("enables conditional View Save only for a changed definition and reloads results at the same URL", async () => {
    const user = userEvent.setup();
    const initialView = makeViewFixture({
      allTasks: false,
      conditions: [{ field: "title", operator: "contains", value: "alpha" }],
    });
    const updatedView = {
      ...initialView,
      conditions: [
        {
          field: "title" as const,
          operator: "contains" as const,
          value: "beta",
        },
      ],
      version: 2,
    };
    const initialSnapshot = { ...testSnapshot, views: [initialView] };
    const latestSnapshot = { ...testSnapshot, views: [updatedView] };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(initialSnapshot);
    vi.spyOn(api, "updateView").mockResolvedValue(latestSnapshot);
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockResolvedValue({ tasks: [], nextCursor: null });
    const router = renderLiveViews(["/views/view-alpha"]);

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    expect(screen.getByText("1 filter")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open View filters" }));
    const dialog = screen.getByRole("dialog", { name: "Edit View" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    const titleValue = within(dialog).getByRole("textbox", {
      name: "Title condition value",
    });
    await user.clear(titleValue);
    await user.type(titleValue, "  alpha  ");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(titleValue);
    await user.type(titleValue, "beta");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("heading", { name: "Alpha Tasks" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/views/view-alpha");
    expect(loadViewTasks.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(loadViewTasks.mock.calls.at(-1)).toEqual(["view-alpha"]);
  });

  it("auto-saves Sort changes, supports reset, and reloads View results", async () => {
    const user = userEvent.setup();
    const initialView = makeViewFixture();
    let currentView = initialView;
    const initialSnapshot = { ...testSnapshot, views: [initialView] };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(initialSnapshot);
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockResolvedValue({ tasks: [], nextCursor: null });
    const updateView = vi
      .spyOn(api, "updateView")
      .mockImplementation(async (_id, input) => {
        currentView = {
          ...currentView,
          ...input,
          version: input.version + 1,
          updatedAt: "2026-08-15T01:00:00.000Z",
        };
        return { ...testSnapshot, views: [currentView] };
      });

    renderLiveViews(["/views/view-alpha"]);
    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Open View sort" }));

    const dialog = screen.getByRole("dialog", { name: "View sort" });
    await user.click(
      within(dialog).getByRole("button", { name: "Add sort condition" }),
    );
    expect(
      await within(dialog).findByRole("listitem", {
        name: "Sort condition: Title",
      }),
    ).toBeInTheDocument();
    expect(updateView).toHaveBeenLastCalledWith("view-alpha", {
      name: "Alpha Tasks",
      allTasks: true,
      conditions: [],
      sort: [
        { field: "updated", direction: "desc" },
        { field: "title", direction: "asc" },
      ],
      columns: defaultViewColumns,
      version: 1,
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Reset sort" }),
    );
    expect(updateView).toHaveBeenLastCalledWith("view-alpha", {
      name: "Alpha Tasks",
      allTasks: true,
      conditions: [],
      sort: [],
      columns: defaultViewColumns,
      version: 2,
    });
    expect(currentView.sort).toEqual([]);
    expect(loadViewTasks.mock.calls.at(-1)).toEqual(["view-alpha"]);
  });

  it("auto-saves Columns visibility, keeps Title fixed, and resets the default order", async () => {
    const user = userEvent.setup();
    const initialView = makeViewFixture();
    let currentView = initialView;
    vi.spyOn(api, "loadBootstrap").mockResolvedValue({
      ...testSnapshot,
      views: [initialView],
    });
    const updateView = vi
      .spyOn(api, "updateView")
      .mockImplementation(async (_id, input) => {
        currentView = {
          ...currentView,
          ...input,
          version: input.version + 1,
        };
        return { ...testSnapshot, views: [currentView] };
      });
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    renderLiveViews(["/views/view-alpha"]);
    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Open View columns" }));

    const dialog = screen.getByRole("dialog", { name: "View columns" });
    const title = within(dialog).getByRole("checkbox", { name: "Show Title" });
    expect(title).toBeChecked();
    expect(title).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Show Tags" }),
    );
    expect(updateView).toHaveBeenLastCalledWith("view-alpha", {
      name: "Alpha Tasks",
      allTasks: true,
      conditions: [],
      sort: defaultViewSort,
      columns: [...defaultViewColumns, "tags"],
      version: 1,
    });

    await user.click(
      within(dialog).getByRole("button", { name: "Reset columns" }),
    );
    expect(updateView).toHaveBeenLastCalledWith("view-alpha", {
      name: "Alpha Tasks",
      allTasks: true,
      conditions: [],
      sort: defaultViewSort,
      columns: defaultViewColumns,
      version: 2,
    });
    expect(currentView.columns).toEqual(defaultViewColumns);
  });

  it("reports a failed Columns save, rolls back, and retries from Columns", async () => {
    const user = userEvent.setup();
    const initialView = makeViewFixture();
    vi.spyOn(api, "loadBootstrap").mockResolvedValue({
      ...testSnapshot,
      views: [initialView],
    });
    const updateView = vi
      .spyOn(api, "updateView")
      .mockRejectedValueOnce(
        new api.ApiRequestError(500, "raw settings response"),
      )
      .mockResolvedValueOnce({
        ...testSnapshot,
        views: [
          makeViewFixture({
            columns: [...defaultViewColumns, "tags"],
            version: 2,
          }),
        ],
      });
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    renderLiveViews(["/views/view-alpha"]);
    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Open View columns" }));
    const dialog = screen.getByRole("dialog", { name: "View columns" });
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Show Tags" }),
    );

    expect(
      await screen.findByLabelText(
        "Error notification: Could not save Columns for “Alpha Tasks”. Try changing Columns again from this View.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw settings response")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "View columns" })).getByRole(
        "checkbox",
        { name: "Show Tags" },
      ),
    ).not.toBeChecked();

    await user.click(
      within(screen.getByRole("dialog", { name: "View columns" })).getByRole(
        "checkbox",
        { name: "Show Tags" },
      ),
    );
    expect(
      within(screen.getByRole("dialog", { name: "View columns" })).getByRole(
        "checkbox",
        { name: "Show Tags" },
      ),
    ).toBeChecked();
    expect(updateView).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected Sort save as a Warning, rolls back, and retries from Sort", async () => {
    const user = userEvent.setup();
    const initialView = makeViewFixture();
    vi.spyOn(api, "loadBootstrap").mockResolvedValue({
      ...testSnapshot,
      views: [initialView],
    });
    const updateView = vi
      .spyOn(api, "updateView")
      .mockRejectedValueOnce(
        new api.ApiRequestError(422, "raw sort response", "VIEW_SORT_INVALID"),
      )
      .mockResolvedValueOnce({
        ...testSnapshot,
        views: [makeViewFixture({ sort: [], version: 2 })],
      });
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });

    renderLiveViews(["/views/view-alpha"]);
    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Open View sort" }));
    const dialog = screen.getByRole("dialog", { name: "View sort" });

    await user.click(
      within(dialog).getByRole("button", { name: "Reset sort" }),
    );
    expect(
      await screen.findByLabelText(
        "Warning notification: Could not save Sort for “Alpha Tasks”. Review the latest View and try Sort again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw sort response")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("listitem", { name: "Sort condition: Updated" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Reset sort" }),
    );
    expect(
      await within(dialog).findByText(/No sort conditions\./),
    ).toBeInTheDocument();
    expect(updateView).toHaveBeenCalledTimes(2);
  });

  it("reports a failed View deletion, keeps the dialog, and retries from Delete", async () => {
    const user = userEvent.setup();
    const snapshot = { ...testSnapshot, views: [makeViewFixture()] };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);
    const deleteView = vi
      .spyOn(api, "deleteView")
      .mockRejectedValueOnce(
        new api.ApiRequestError(500, "raw delete response"),
      )
      .mockResolvedValueOnce({ ...snapshot, views: [] });
    renderLiveViews();

    const row = await screen.findByRole("listitem", { name: "Alpha Tasks" });
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete View" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByLabelText(
        "Error notification: Could not delete “Alpha Tasks”. Try again from Delete View.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Delete View" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "Alpha Tasks", hidden: true }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(screen.getByText("No Views yet.")).toBeInTheDocument();
    expect(deleteView).toHaveBeenCalledTimes(2);
  });

  it("keeps the View-page delete dialog after a failed optimistic delete", async () => {
    const user = userEvent.setup();
    const snapshot = { ...testSnapshot, views: [makeViewFixture()] };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    const deleteView = vi
      .spyOn(api, "deleteView")
      .mockRejectedValueOnce(
        new api.ApiRequestError(500, "raw delete response"),
      )
      .mockResolvedValueOnce({ ...snapshot, views: [] });
    const router = renderLiveViews(["/views/view-alpha"]);

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete View" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByLabelText(
        "Error notification: Could not delete “Alpha Tasks”. Try again from Delete View.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Delete View" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No Views yet.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/views");
    expect(deleteView).toHaveBeenCalledTimes(2);
  });

  it("rebases a queued Columns save after the preceding save fails", async () => {
    const user = userEvent.setup();
    const snapshot = { ...testSnapshot, views: [makeViewFixture()] };
    vi.spyOn(api, "loadBootstrap").mockResolvedValue(snapshot);
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    let rejectFirst!: (error: unknown) => void;
    let secondVersion: number | undefined;
    const updateView = vi
      .spyOn(api, "updateView")
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(async (_id, input) => {
        secondVersion = input.version;
        return {
          ...snapshot,
          views: [
            makeViewFixture({
              columns: [...defaultViewColumns, "tags", "description"],
              version: 2,
            }),
          ],
        };
      });
    renderLiveViews(["/views/view-alpha"]);

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Open View columns" }));
    const dialog = screen.getByRole("dialog", { name: "View columns" });
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Show Tags" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Show Description" }),
    );

    rejectFirst(new api.ApiRequestError(500, "raw first response"));
    expect(
      await screen.findByLabelText(
        "Error notification: Could not save Columns for “Alpha Tasks”. Try changing Columns again from this View.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(updateView).toHaveBeenCalledTimes(2));
    expect(secondVersion).toBe(1);
    expect(
      within(screen.getByRole("dialog", { name: "View columns" })).getByRole(
        "checkbox",
        { name: "Show Description" },
      ),
    ).toBeChecked();
  });

  it("supports View result editing, Markdown, subtask, and Trash actions", async () => {
    const user = userEvent.setup();
    const sourceTask = testSnapshot.tasks.find(
      (task) => task.id === "task-vault-review",
    );
    if (!sourceTask) throw new Error("View action fixture is missing");
    const task = {
      ...sourceTask,
      description: "[Important](https://example.com)\n\n**safe**",
      workNotes: "[Work note](https://example.com/notes)",
    };
    const view = makeViewFixture({
      columns: ["title", "description", "workNotes"],
    });
    const snapshot = {
      ...testSnapshot,
      tasks: testSnapshot.tasks.map((candidate) =>
        candidate.id === task.id ? task : candidate,
      ),
      views: [view],
    };
    const loadViewTasks = vi
      .spyOn(api, "loadViewTasks")
      .mockResolvedValueOnce({ tasks: [task], nextCursor: null })
      .mockResolvedValueOnce({ tasks: [], nextCursor: null });
    renderViews(snapshot, ["/views/view-alpha"]);

    const table = await screen.findByRole("table", {
      name: "View results table",
    });
    await user.click(
      within(table).getByRole("button", { name: `Edit ${task.title}` }),
    );
    expect(
      screen.getByRole("dialog", { name: "Edit Task" }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog", { name: "Edit Task" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );

    for (const label of ["Description", "Work Notes"]) {
      await user.click(
        within(table).getByRole("button", {
          name: `Open ${label} for ${task.title}`,
        }),
      );
      const viewer = screen.getByRole("dialog", { name: label });
      expect(viewer).toContainElement(
        screen.getByRole("link", {
          name: label === "Description" ? "Important" : "Work note",
        }),
      );
      await user.click(
        within(viewer).getByRole("button", { name: `Close ${label}` }),
      );
    }

    await user.click(
      within(table).getByRole("button", { name: `${task.title} actions` }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Add Subtask" }));
    expect(
      screen.getByRole("dialog", { name: "Add Subtask" }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog", { name: "Add Subtask" })).getByRole(
        "button",
        { name: "Close" },
      ),
    );

    await user.click(
      within(table).getByRole("button", { name: `${task.title} actions` }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    expect(
      await screen.findByText("No Tasks in this View."),
    ).toBeInTheDocument();
    expect(loadViewTasks).toHaveBeenLastCalledWith("view-alpha");
  });

  it("uses the existing cascade completion rule for View results", async () => {
    const user = userEvent.setup();
    const parent = makeTaskFixture({
      id: "view-parent",
      title: "View parent",
      path: ["Develop", "View parent"],
    });
    const child = makeTaskFixture({
      id: "view-child",
      title: "View child",
      path: ["Develop", "View parent", "View child"],
      parentId: parent.id,
    });
    const snapshot = {
      ...testSnapshot,
      tasks: [parent, child],
      views: [makeViewFixture()],
    };
    const completedSnapshot = {
      ...snapshot,
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        status: "COMPLETED" as const,
        completedAt: "2026-08-15T02:00:00.000Z",
        version: 2,
      })),
    };
    const updateTaskStatus = vi
      .spyOn(api, "updateTaskStatus")
      .mockResolvedValue(completedSnapshot);
    vi.spyOn(api, "loadViewTasks")
      .mockResolvedValueOnce({ tasks: [parent], nextCursor: null })
      .mockResolvedValueOnce({ tasks: [], nextCursor: null });
    renderViews(snapshot, ["/views/view-alpha"]);

    await user.click(
      await screen.findByRole("button", { name: "Complete View parent" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("View child");
    await user.click(
      within(dialog).getByRole("button", { name: "Complete 2 Tasks" }),
    );

    expect(updateTaskStatus).toHaveBeenCalledWith("view-parent", {
      status: "COMPLETED",
      version: 1,
      cascadeDescendants: true,
      descendantVersions: { "view-child": 1 },
      ancestorVersions: {},
    });
    expect(
      await screen.findByText("No Tasks in this View."),
    ).toBeInTheDocument();
  });

  it("reports an Error when the latest View cannot be loaded after a conflict", async () => {
    const user = userEvent.setup();
    const snapshot = { ...testSnapshot, views: [makeViewFixture()] };
    vi.spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error("raw reload response"));
    vi.spyOn(api, "updateView").mockRejectedValue(
      new api.ApiRequestError(
        409,
        "raw conflict response",
        "VIEW_VERSION_CONFLICT",
      ),
    );
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    renderLiveViews(["/views/view-alpha"]);

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Open View columns" }));
    const dialog = screen.getByRole("dialog", { name: "View columns" });
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Show Tags" }),
    );

    expect(
      await screen.findByLabelText(
        "Error notification: Could not save Columns for “Alpha Tasks”. Try changing Columns again from this View.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw conflict response")).not.toBeInTheDocument();
    expect(screen.queryByText("raw reload response")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("checkbox", { name: "Show Tags" }),
    ).not.toBeChecked();
  });

  it("reloads the latest View after an automatic-save conflict", async () => {
    const user = userEvent.setup();
    const initialView = makeViewFixture();
    const latestView = makeViewFixture({
      columns: ["title", "description"],
      version: 2,
    });
    vi.spyOn(api, "loadBootstrap")
      .mockResolvedValueOnce({ ...testSnapshot, views: [initialView] })
      .mockResolvedValue({ ...testSnapshot, views: [latestView] });
    vi.spyOn(api, "updateView").mockRejectedValue(
      new api.ApiRequestError(
        409,
        "View changed elsewhere",
        "VIEW_VERSION_CONFLICT",
      ),
    );
    vi.spyOn(api, "loadViewTasks").mockResolvedValue({
      tasks: [],
      nextCursor: null,
    });
    renderLiveViews(["/views/view-alpha"]);

    await screen.findByRole("heading", { name: "Alpha Tasks" });
    await user.click(screen.getByRole("button", { name: "Open View columns" }));
    const dialog = screen.getByRole("dialog", { name: "View columns" });
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Show Tags" }),
    );

    expect(
      await screen.findByLabelText(
        "Warning notification: Could not save Columns for “Alpha Tasks”. Review the latest View and try Columns again.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("checkbox", { name: "Show Description" }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", { name: "Show Tags" }),
    ).not.toBeChecked();
  });
});

function renderViews(snapshot = testSnapshot, initialEntries = ["/views"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/views",
        element: <ViewManagementPage />,
      },
      {
        path: "/views/:viewId",
        element: <ViewPage />,
      },
    ],
    { initialEntries },
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

function renderLiveViews(initialEntries = ["/views"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/views",
        element: <ViewManagementPage />,
      },
      {
        path: "/views/:viewId",
        element: <ViewPage />,
      },
    ],
    { initialEntries },
  );

  render(
    <BootstrapProvider>
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>
    </BootstrapProvider>,
  );
  return router;
}

function makeTaskFixture(overrides: Partial<Task>): Task {
  const baseTask = testSnapshot.tasks[0];
  if (!baseTask) throw new Error("Task fixture is missing");
  return {
    ...baseTask,
    id: "view-task",
    title: "View task",
    path: ["Develop", "View task"],
    parentId: undefined,
    status: "OPEN",
    start: null,
    due: null,
    completedAt: null,
    updatedAt: "2026-08-15T00:00:00.000Z",
    tags: [],
    description: "",
    workNotes: "",
    trashedAt: null,
    version: 1,
    ...overrides,
  };
}
