import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { readBootstrapSnapshot } from "../data/bootstrap-repository";
import { verifyDatabase } from "../data/health-repository";
import {
  ManualOrderError,
  reorderToday,
} from "../data/manual-order-repository";
import {
  SearchQueryError,
  searchTasks,
  searchViewTasks,
} from "../data/search-repository";
import {
  AreaHasTasksError,
  AreaNotFoundError,
  AreaOrderError,
  createArea,
  deleteTag,
  OwnerSettingsConflictError,
  renameTag,
  reorderAreas,
  restoreArea,
  TagNotFoundError,
  trashArea,
  updateArea,
  updateOwnerSettings,
} from "../data/settings-repository";
import { moveTask } from "../data/task-move-repository";
import {
  createTask,
  RecurrenceReopenConflictError,
  RecurrenceRuleError,
  restoreTask,
  TaskConflictError,
  TaskHasOpenDescendantsError,
  TaskHasOpenRecurringDescendantsError,
  TaskNotFoundError,
  TaskTagNotFoundError,
  TaskTreeError,
  trashTask,
  updateTask,
  updateTaskStatus,
} from "../data/task-repository";
import { deleteExpiredTrash } from "../data/trash-retention-repository";
import {
  createView,
  deleteView,
  readView,
  updateView,
  ViewNameConflictError,
  ViewNotFoundError,
  ViewVersionConflictError,
} from "../data/view-repository";
import {
  areaIdParamSchema,
  bootstrapResponseSchema,
  createAreaRequestSchema,
  createTaskRequestSchema,
  healthResponseSchema,
  moveTaskRequestSchema,
  renameTagRequestSchema,
  reorderAreasRequestSchema,
  reorderTodayRequestSchema,
  tagIdParamSchema,
  taskHasOpenRecurringDescendantsResponseSchema,
  taskSearchResponseSchema,
  taskVersionRequestSchema,
  titleSearchQuerySchema,
  titleSearchResponseSchema,
  updateAreaRequestSchema,
  updateOwnerSettingsRequestSchema,
  updateTaskRequestSchema,
  updateTaskStatusRequestSchema,
  viewCreateRequestSchema,
  viewIdParamSchema,
  viewResultsQuerySchema,
  viewUpdateRequestSchema,
} from "../shared/api-schema";
import { authenticateAccessRequest } from "./access-auth";

type Bindings = {
  DB: D1Database;
  AUTH_MODE?: string;
  ACCESS_JWT_AUD?: string;
  ACCESS_JWT_TEAM_DOMAIN?: string;
};

const app = new Hono<{ Bindings: Bindings }>()
  .use("/api/*", async (context, next) => {
    const rejection = await authenticateAccessRequest(
      context.req.raw,
      context.env,
    );
    if (rejection) return rejection;
    await next();
  })
  .get("/api/v1/bootstrap", async (context) => {
    const snapshot = await readBootstrapSnapshot(context.env.DB);

    return context.json(bootstrapResponseSchema.parse(snapshot));
  })
  .get(
    "/api/v1/tasks/search",
    zValidator("query", titleSearchQuerySchema),
    async (context) => {
      try {
        const result = await searchTasks(
          context.env.DB,
          context.req.valid("query"),
        );
        return context.json(titleSearchResponseSchema.parse(result));
      } catch (error) {
        if (error instanceof SearchQueryError) {
          return context.json(
            { error: { code: "SEARCH_QUERY_INVALID", message: error.message } },
            400,
          );
        }
        throw error;
      }
    },
  )
  .get(
    "/api/v1/views/:id/tasks",
    zValidator("param", viewIdParamSchema),
    zValidator("query", viewResultsQuerySchema),
    async (context) => {
      const view = await readView(
        context.env.DB,
        context.req.valid("param").id,
      );
      if (!view) {
        return context.json(
          { error: { code: "VIEW_NOT_FOUND", message: "View was not found" } },
          404,
        );
      }

      try {
        const result = await searchViewTasks(
          context.env.DB,
          view,
          context.req.valid("query").cursor,
        );
        return context.json(taskSearchResponseSchema.parse(result));
      } catch (error) {
        if (error instanceof SearchQueryError) {
          return context.json(
            { error: { code: "VIEW_RESULTS_INVALID", message: error.message } },
            400,
          );
        }
        throw error;
      }
    },
  )
  .post(
    "/api/v1/views",
    zValidator("json", viewCreateRequestSchema),
    async (context) => {
      try {
        await createView(context.env.DB, context.req.valid("json"));
      } catch (error) {
        if (error instanceof ViewNameConflictError) {
          return context.json(
            {
              error: { code: "VIEW_NAME_CONFLICT", message: error.message },
            },
            409,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
        201,
      );
    },
  )
  .put(
    "/api/v1/views/:id",
    zValidator("param", viewIdParamSchema),
    zValidator("json", viewUpdateRequestSchema),
    async (context) => {
      try {
        await updateView(
          context.env.DB,
          context.req.valid("param").id,
          context.req.valid("json"),
        );
      } catch (error) {
        if (error instanceof ViewNotFoundError) {
          return context.json(
            { error: { code: "VIEW_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof ViewNameConflictError) {
          return context.json(
            {
              error: { code: "VIEW_NAME_CONFLICT", message: error.message },
            },
            409,
          );
        }
        if (error instanceof ViewVersionConflictError) {
          return context.json(
            {
              error: { code: "VIEW_VERSION_CONFLICT", message: error.message },
            },
            409,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .delete(
    "/api/v1/views/:id",
    zValidator("param", viewIdParamSchema),
    async (context) => {
      try {
        await deleteView(context.env.DB, context.req.valid("param").id);
      } catch (error) {
        if (error instanceof ViewNotFoundError) {
          return context.json(
            { error: { code: "VIEW_NOT_FOUND", message: error.message } },
            404,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .post(
    "/api/v1/areas",
    zValidator("json", createAreaRequestSchema),
    async (context) => {
      await createArea(context.env.DB, context.req.valid("json"));
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
        201,
      );
    },
  )
  .put(
    "/api/v1/today/order",
    zValidator("json", reorderTodayRequestSchema),
    async (context) => {
      try {
        await reorderToday(context.env.DB, context.req.valid("json"));
      } catch (error) {
        if (error instanceof ManualOrderError) {
          return context.json(
            { error: { code: "TODAY_ORDER_INVALID", message: error.message } },
            422,
          );
        }
        throw error;
      }

      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .put(
    "/api/v1/tasks/move",
    zValidator("json", moveTaskRequestSchema),
    async (context) => {
      try {
        await moveTask(context.env.DB, context.req.valid("json"));
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return context.json(
            { error: { code: "TASK_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskConflictError) {
          return context.json(
            {
              error: { code: "TASK_VERSION_CONFLICT", message: error.message },
            },
            409,
          );
        }
        if (error instanceof TaskTreeError) {
          return context.json(
            { error: { code: "TASK_MOVE_INVALID", message: error.message } },
            422,
          );
        }
        if (error instanceof RecurrenceRuleError) {
          return context.json(
            { error: { code: "TASK_MOVE_INVALID", message: error.message } },
            422,
          );
        }
        throw error;
      }

      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .put(
    "/api/v1/areas/order",
    zValidator("json", reorderAreasRequestSchema),
    async (context) => {
      try {
        await reorderAreas(context.env.DB, context.req.valid("json"));
      } catch (error) {
        if (error instanceof AreaOrderError) {
          return context.json(
            { error: { code: "AREA_ORDER_INVALID", message: error.message } },
            422,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .put(
    "/api/v1/areas/:id",
    zValidator("param", areaIdParamSchema),
    zValidator("json", updateAreaRequestSchema),
    async (context) => {
      try {
        await updateArea(
          context.env.DB,
          context.req.valid("param").id,
          context.req.valid("json"),
        );
      } catch (error) {
        if (error instanceof AreaNotFoundError) {
          return context.json(
            { error: { code: "AREA_NOT_FOUND", message: error.message } },
            404,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .delete(
    "/api/v1/areas/:id",
    zValidator("param", areaIdParamSchema),
    async (context) => {
      try {
        await trashArea(context.env.DB, context.req.valid("param").id);
      } catch (error) {
        if (error instanceof AreaNotFoundError) {
          return context.json(
            { error: { code: "AREA_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof AreaHasTasksError) {
          return context.json(
            { error: { code: "AREA_HAS_TASKS", message: error.message } },
            409,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .post(
    "/api/v1/areas/:id/restore",
    zValidator("param", areaIdParamSchema),
    async (context) => {
      try {
        await restoreArea(context.env.DB, context.req.valid("param").id);
      } catch (error) {
        if (error instanceof AreaNotFoundError) {
          return context.json(
            { error: { code: "AREA_NOT_FOUND", message: error.message } },
            404,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .put(
    "/api/v1/owner-settings",
    zValidator("json", updateOwnerSettingsRequestSchema),
    async (context) => {
      try {
        await updateOwnerSettings(context.env.DB, context.req.valid("json"));
      } catch (error) {
        if (error instanceof OwnerSettingsConflictError) {
          return context.json(
            {
              error: {
                code: "OWNER_SETTINGS_VERSION_CONFLICT",
                message: error.message,
              },
            },
            409,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .put(
    "/api/v1/tags/:id",
    zValidator("param", tagIdParamSchema),
    zValidator("json", renameTagRequestSchema),
    async (context) => {
      try {
        await renameTag(
          context.env.DB,
          context.req.valid("param").id,
          context.req.valid("json"),
        );
      } catch (error) {
        if (error instanceof TagNotFoundError) {
          return context.json(
            { error: { code: "TAG_NOT_FOUND", message: error.message } },
            404,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .delete(
    "/api/v1/tags/:id",
    zValidator("param", tagIdParamSchema),
    async (context) => {
      try {
        await deleteTag(context.env.DB, context.req.valid("param").id);
      } catch (error) {
        if (error instanceof TagNotFoundError) {
          return context.json(
            { error: { code: "TAG_NOT_FOUND", message: error.message } },
            404,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .post(
    "/api/v1/tasks",
    zValidator("json", createTaskRequestSchema),
    async (context) => {
      try {
        await createTask(context.env.DB, context.req.valid("json"));
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return context.json(
            { error: { code: "AREA_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskTagNotFoundError) {
          return context.json(
            { error: { code: "TAG_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskTreeError) {
          return context.json(
            { error: { code: "TASK_TREE_INVALID", message: error.message } },
            422,
          );
        }
        if (error instanceof RecurrenceRuleError) {
          return context.json(
            {
              error: {
                code: "RECURRENCE_RULE_INVALID",
                message: error.message,
              },
            },
            422,
          );
        }
        throw error;
      }

      const snapshot = await readBootstrapSnapshot(context.env.DB);
      return context.json(bootstrapResponseSchema.parse(snapshot), 201);
    },
  )
  .post(
    "/api/v1/tasks/:id/trash",
    zValidator("json", taskVersionRequestSchema),
    async (context) => {
      try {
        await trashTask(
          context.env.DB,
          context.req.param("id"),
          context.req.valid("json"),
        );
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return context.json(
            { error: { code: "TASK_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskConflictError) {
          return context.json(
            {
              error: { code: "TASK_VERSION_CONFLICT", message: error.message },
            },
            409,
          );
        }
        if (error instanceof RecurrenceRuleError) {
          return context.json(
            {
              error: {
                code: "RECURRENCE_RULE_INVALID",
                message: error.message,
              },
            },
            422,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .post(
    "/api/v1/tasks/:id/restore",
    zValidator("json", taskVersionRequestSchema),
    async (context) => {
      try {
        await restoreTask(
          context.env.DB,
          context.req.param("id"),
          context.req.valid("json"),
        );
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return context.json(
            { error: { code: "TASK_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskConflictError) {
          return context.json(
            {
              error: { code: "TASK_VERSION_CONFLICT", message: error.message },
            },
            409,
          );
        }
        throw error;
      }
      return context.json(
        bootstrapResponseSchema.parse(
          await readBootstrapSnapshot(context.env.DB),
        ),
      );
    },
  )
  .put(
    "/api/v1/tasks/:id",
    zValidator("json", updateTaskRequestSchema),
    async (context) => {
      try {
        await updateTask(
          context.env.DB,
          context.req.param("id"),
          context.req.valid("json"),
        );
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return context.json(
            { error: { code: "TASK_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskTagNotFoundError) {
          return context.json(
            { error: { code: "TAG_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskConflictError) {
          return context.json(
            {
              error: { code: "TASK_VERSION_CONFLICT", message: error.message },
            },
            409,
          );
        }
        if (error instanceof TaskTreeError) {
          return context.json(
            { error: { code: "TASK_TREE_INVALID", message: error.message } },
            422,
          );
        }
        if (error instanceof RecurrenceRuleError) {
          return context.json(
            {
              error: {
                code: "RECURRENCE_RULE_INVALID",
                message: error.message,
              },
            },
            422,
          );
        }
        throw error;
      }

      const snapshot = await readBootstrapSnapshot(context.env.DB);
      return context.json(bootstrapResponseSchema.parse(snapshot));
    },
  )
  .patch(
    "/api/v1/tasks/:id/status",
    zValidator("json", updateTaskStatusRequestSchema),
    async (context) => {
      try {
        await updateTaskStatus(
          context.env.DB,
          context.req.param("id"),
          context.req.valid("json"),
        );
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return context.json(
            { error: { code: "TASK_NOT_FOUND", message: error.message } },
            404,
          );
        }
        if (error instanceof TaskConflictError) {
          return context.json(
            {
              error: { code: "TASK_VERSION_CONFLICT", message: error.message },
            },
            409,
          );
        }
        if (error instanceof TaskHasOpenDescendantsError) {
          return context.json(
            {
              error: {
                code: "TASK_HAS_OPEN_DESCENDANTS",
                message: error.message,
              },
            },
            409,
          );
        }
        if (error instanceof TaskHasOpenRecurringDescendantsError) {
          return context.json(
            taskHasOpenRecurringDescendantsResponseSchema.parse({
              error: {
                code: "TASK_HAS_OPEN_RECURRING_DESCENDANTS",
                message: error.message,
                taskIds: error.taskIds,
              },
            }),
            409,
          );
        }
        if (error instanceof RecurrenceReopenConflictError) {
          return context.json(
            {
              error: {
                code: "RECURRING_TASK_REOPEN_CONFLICT",
                message: error.message,
              },
            },
            409,
          );
        }
        throw error;
      }

      const snapshot = await readBootstrapSnapshot(context.env.DB);
      return context.json(bootstrapResponseSchema.parse(snapshot));
    },
  )
  .get("/api/v1/health", async (context) => {
    await verifyDatabase(context.env.DB);

    return context.json(
      healthResponseSchema.parse({
        ok: true,
        service: "taskseq",
        database: "ready",
      }),
    );
  });

app.notFound((context) =>
  context.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "The requested API route does not exist.",
      },
    },
    404,
  ),
);

app.onError((error, context) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "request_failed",
      method: context.req.method,
      path: context.req.path,
      error: error.name,
    }),
  );

  return context.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
      },
    },
    500,
  );
});

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    environment: Bindings,
    context: ExecutionContext,
  ) {
    context.waitUntil(
      deleteExpiredTrash(environment.DB, new Date(controller.scheduledTime)),
    );
  },
};
