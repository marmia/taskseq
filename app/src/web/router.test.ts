import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDisplayLanguage } from "./i18n";
import { router, taskMutationAction } from "./router";

function taskMutationRequest(
  operation: "create" | "update",
  payload: Record<string, unknown>,
) {
  const formData = new FormData();
  formData.set("operation", operation);
  formData.set("payload", JSON.stringify(payload));
  return new Request("http://localhost/task-mutations", {
    method: "POST",
    body: formData,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  applyDisplayLanguage("en");
});

describe("app routes", () => {
  it("loads Local Worker health data before rendering Settings", () => {
    const rootRoute = router.routes[0];
    const settingsRoute = rootRoute.children?.find(
      (route) => route.path === "settings",
    );

    expect(settingsRoute?.loader).toBeTypeOf("function");
  });

  it("maps API validation issues to Task form fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            success: false,
            error: {
              name: "ZodError",
              message: JSON.stringify([
                {
                  code: "too_small",
                  path: ["title"],
                  message: "Title is required.",
                },
                {
                  code: "invalid_type",
                  path: ["tagIds"],
                  message: "Select valid Tags.",
                },
              ]),
            },
          },
          { status: 400 },
        ),
      ),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("create", { title: "Draft" }),
    } as never);

    expect(result).toEqual({
      failure: {
        type: "validation",
        fieldErrors: {
          title: "Title is required.",
          tags: "Select valid Tags.",
        },
      },
    });
  });

  it("maps new Tag API validation to the Task Tags field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            success: false,
            error: {
              name: "ZodError",
              message: JSON.stringify([
                {
                  code: "custom",
                  path: ["newTagNames"],
                  message: "Tag name is already used.",
                },
              ]),
            },
          },
          { status: 400 },
        ),
      ),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("create", {
        title: "Draft",
        newTagNames: ["existing"],
      }),
    } as never);

    expect(result).toEqual({
      failure: {
        type: "validation",
        fieldErrors: { tags: "Tag name is already used." },
      },
    });
  });

  it("classifies a runtime domain rejection as a Warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "RECURRENCE_RULE_INVALID",
              message: "A Recurring Task requires a date-only Start.",
            },
          },
          { status: 422 },
        ),
      ),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("create", { title: "Daily review" }),
    } as never);

    expect(result).toEqual({
      failure: {
        type: "warning",
        message:
          "Could not create “Daily review”. Review the Task and try again from Add Task.",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("classifies an authentication failure as an Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "UNAUTHENTICATED",
              message: "Authentication required.",
            },
          },
          { status: 401 },
        ),
      ),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("create", { title: "Daily review" }),
    } as never);

    expect(result).toEqual({
      failure: {
        type: "error",
        message: "Could not create “Daily review”. Try again from Add Task.",
      },
    });
  });

  it("reloads the latest snapshot once for a version conflict", async () => {
    const latestSnapshot = {
      areas: [],
      ownerSettings: {
        displayLanguage: "en",
        timeZone: "Asia/Tokyo",
        weekStartsOn: 1 as const,
        trashRetentionDays: 30,
        version: 1,
      },
      tags: [],
      tasks: [],
      areaTaskOrders: {},
      inboxOrder: [],
      todayOrders: {},
      views: [],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "TASK_VERSION_CONFLICT",
                message: "Task version conflict",
              },
            },
            { status: 409 },
          ),
        )
        .mockResolvedValueOnce(Response.json(latestSnapshot)),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("update", {
        id: "task-1",
        title: "Conflict draft",
      }),
    } as never);

    expect(result).toEqual({
      snapshot: latestSnapshot,
      failure: {
        type: "warning",
        message:
          "“Conflict draft” changed elsewhere. Review the latest Task before saving again.",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the latest saved display language for conflict guidance", async () => {
    applyDisplayLanguage("en");
    const latestSnapshot = {
      areas: [],
      ownerSettings: {
        displayLanguage: "ja",
        timeZone: "Asia/Tokyo",
        weekStartsOn: 1 as const,
        trashRetentionDays: 30,
        version: 1,
      },
      tags: [],
      tasks: [],
      areaTaskOrders: {},
      inboxOrder: [],
      todayOrders: {},
      views: [],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "TASK_VERSION_CONFLICT",
                message: "Task version conflict",
              },
            },
            { status: 409 },
          ),
        )
        .mockResolvedValueOnce(Response.json(latestSnapshot)),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("update", {
        id: "task-1",
        title: "Conflict draft",
      }),
    } as never);

    expect(result).toEqual({
      snapshot: latestSnapshot,
      failure: {
        type: "warning",
        message:
          "「Conflict draft」が別の場所で変更されました。最新のタスクを確認してから、もう一度保存してください。",
      },
    });
  });

  it("classifies a server failure as an Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 503 })),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("update", {
        id: "task-1",
        title: "Edited Task",
      }),
    } as never);

    expect(result).toEqual({
      failure: {
        type: "error",
        message:
          "Could not save changes to “Edited Task”. Try again from Save Changes.",
      },
    });
  });

  it("localizes common Task mutation recovery guidance", async () => {
    applyDisplayLanguage("ja");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 503 })),
    );

    const result = await taskMutationAction({
      request: taskMutationRequest("create", { title: "Daily review" }),
    } as never);

    expect(result).toEqual({
      failure: {
        type: "error",
        message:
          "「Daily review」を作成できませんでした。タスクの追加からもう一度お試しください。",
      },
    });
  });
});
