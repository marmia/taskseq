import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTranslation } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBootstrap } from "./api-client";
import { BootstrapProvider, useBootstrap } from "./bootstrap-state";
import { applyDisplayLanguage } from "./i18n";

vi.mock("./api-client", () => ({
  loadBootstrap: vi.fn(),
}));

const mockedLoadBootstrap = vi.mocked(loadBootstrap);

function SnapshotContent() {
  const { snapshot } = useBootstrap();

  return <output>{snapshot.ownerSettings.timeZone}</output>;
}

function TranslationContent() {
  const { t } = useTranslation();

  return <output>{t("common.bootstrap.loading")}</output>;
}

describe("BootstrapProvider", () => {
  afterEach(() => {
    mockedLoadBootstrap.mockReset();
    applyDisplayLanguage("en");
  });

  it("shows loading until the initial snapshot is available", async () => {
    let resolveBootstrap:
      | ((snapshot: Awaited<ReturnType<typeof loadBootstrap>>) => void)
      | undefined;
    mockedLoadBootstrap.mockReturnValue(
      new Promise((resolve) => {
        resolveBootstrap = resolve;
      }),
    );

    render(
      <BootstrapProvider>
        <SnapshotContent />
      </BootstrapProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading workspace…");
    expect(document.documentElement.lang).toBe("en");

    if (!resolveBootstrap) {
      throw new Error("Bootstrap resolver was not initialized");
    }

    resolveBootstrap({
      areas: [],
      ownerSettings: {
        displayLanguage: "en",
        timeZone: "Asia/Tokyo",
        weekStartsOn: 0,
        trashRetentionDays: 30,
        version: 1,
      },
      tags: [],
      tasks: [],
      areaTaskOrders: {},
      inboxOrder: [],
      todayOrders: {},
      views: [],
    });

    expect(await screen.findByText("Asia/Tokyo")).toBeInTheDocument();
  });

  it("applies the saved language before rendering the main UI", () => {
    render(
      <BootstrapProvider
        initialSnapshot={{
          areas: [],
          ownerSettings: {
            displayLanguage: "ja",
            timeZone: "Asia/Tokyo",
            weekStartsOn: 0,
            trashRetentionDays: 30,
            version: 1,
          },
          tags: [],
          tasks: [],
          areaTaskOrders: {},
          inboxOrder: [],
          todayOrders: {},
          views: [],
        }}
      >
        <TranslationContent />
      </BootstrapProvider>,
    );

    expect(document.documentElement.lang).toBe("ja");
    expect(
      screen.getByText("ワークスペースを読み込んでいます…"),
    ).toBeInTheDocument();
  });

  it("shows an API error and retries the snapshot request", async () => {
    const user = userEvent.setup();
    mockedLoadBootstrap
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({
        areas: [],
        ownerSettings: {
          displayLanguage: "en",
          timeZone: "Asia/Tokyo",
          weekStartsOn: 0,
          trashRetentionDays: 30,
          version: 1,
        },
        tags: [],
        tasks: [],
        areaTaskOrders: {},
        inboxOrder: [],
        todayOrders: {},
        views: [],
      });

    render(
      <BootstrapProvider>
        <SnapshotContent />
      </BootstrapProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load your workspace.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Asia/Tokyo");
    expect(mockedLoadBootstrap).toHaveBeenCalledTimes(2);
  });

  it("keeps bootstrap failure text in English when the saved language is unknown", async () => {
    applyDisplayLanguage("ja");
    mockedLoadBootstrap.mockRejectedValue(new Error("unavailable"));

    render(
      <BootstrapProvider>
        <SnapshotContent />
      </BootstrapProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load your workspace.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.queryByText("ワークスペースを読み込めませんでした。"),
    ).not.toBeInTheDocument();
  });

  it("clears the workspace error while retrying and restores it after another failure", async () => {
    const user = userEvent.setup();
    let rejectRetry: ((reason?: unknown) => void) | undefined;
    mockedLoadBootstrap
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectRetry = reject;
          }),
      );

    render(
      <BootstrapProvider>
        <SnapshotContent />
      </BootstrapProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load your workspace.",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading workspace…");

    rejectRetry?.(new Error("still unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load your workspace.",
    );
    expect(mockedLoadBootstrap).toHaveBeenCalledTimes(2);
  });
});
