import { hc } from "hono/client";
import {
  bootstrapResponseSchema,
  type CreateAreaRequest,
  type CreateTaskRequest,
  type MoveTaskRequest,
  type RenameTagRequest,
  type ReorderAreasRequest,
  type ReorderTodayRequest,
  type TaskVersionRequest,
  taskSearchResponseSchema,
  titleSearchResponseSchema,
  type UpdateAreaRequest,
  type UpdateOwnerSettingsRequest,
  type UpdateTaskRequest,
  type UpdateTaskStatusRequest,
  type ViewCreateRequest,
  type ViewUpdateRequest,
} from "../shared/api-schema";
import type { AppType } from "../worker";

export const apiClient = hc<AppType>("/");

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

function validationFieldErrors(error: object) {
  let issues: unknown = "issues" in error ? error.issues : undefined;
  if (!Array.isArray(issues) && "message" in error) {
    try {
      issues = JSON.parse(String(error.message));
    } catch {
      return {};
    }
  }
  if (!Array.isArray(issues)) return {};

  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const path = "path" in issue && Array.isArray(issue.path) ? issue.path : [];
    const field = path[0];
    const message = "message" in issue ? issue.message : undefined;
    if (
      typeof field === "string" &&
      typeof message === "string" &&
      !(field in fieldErrors)
    ) {
      fieldErrors[field] = message;
    }
  }
  return fieldErrors;
}

function apiErrorDetails(body: unknown) {
  if (
    !body ||
    typeof body !== "object" ||
    !("error" in body) ||
    !body.error ||
    typeof body.error !== "object"
  ) {
    return {};
  }
  return {
    code:
      "code" in body.error && typeof body.error.code === "string"
        ? body.error.code
        : undefined,
    message:
      "message" in body.error && typeof body.error.message === "string"
        ? body.error.message
        : undefined,
    fieldErrors: validationFieldErrors(body.error),
  };
}

export async function loadBootstrap() {
  const response = await apiClient.api.v1.bootstrap.$get();
  if (!response.ok) {
    throw new Error("Bootstrap request failed");
  }

  return bootstrapResponseSchema.parse(await response.json());
}

export async function searchTasks(query: string) {
  const response = await apiClient.api.v1.tasks.search.$get({
    query: { q: query.trim() },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const { message } = apiErrorDetails(body);
    throw new ApiRequestError(
      response.status,
      message ?? "Task Search request failed",
    );
  }

  return titleSearchResponseSchema.parse(await response.json());
}

export async function loadViewTasks(viewId: string, cursor?: string) {
  const response = await apiClient.api.v1.views[":id"].tasks.$get({
    param: { id: viewId },
    query: cursor ? { cursor } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const { code, message } = apiErrorDetails(body);
    throw new ApiRequestError(
      response.status,
      message ?? "View results request failed",
      code,
    );
  }

  return taskSearchResponseSchema.parse(await response.json());
}

export async function createTask(input: CreateTaskRequest) {
  return mutationSnapshot(
    apiClient.api.v1.tasks.$post({ json: input }),
    "Task creation request failed",
  );
}

export async function updateTask(id: string, input: UpdateTaskRequest) {
  return mutationSnapshot(
    apiClient.api.v1.tasks[":id"].$put({
      param: { id },
      json: input,
    }),
    "Task update request failed",
  );
}

export async function updateTaskStatus(
  id: string,
  input: UpdateTaskStatusRequest,
) {
  const response = await apiClient.api.v1.tasks[":id"].status.$patch({
    param: { id },
    json: input,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const { code, message } = apiErrorDetails(body);
    throw new ApiRequestError(
      response.status,
      message ?? "Task status request failed",
      code,
    );
  }

  return bootstrapResponseSchema.parse(await response.json());
}

async function mutationSnapshot(
  response: Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>,
  message: string,
) {
  const resolved = await response;
  if (!resolved.ok) {
    const body = await resolved.json().catch(() => null);
    const { code, message: errorMessage, fieldErrors } = apiErrorDetails(body);
    throw new ApiRequestError(
      resolved.status,
      errorMessage ?? message,
      code,
      fieldErrors,
    );
  }
  return bootstrapResponseSchema.parse(await resolved.json());
}

export function createArea(input: CreateAreaRequest) {
  return mutationSnapshot(
    apiClient.api.v1.areas.$post({ json: input }),
    "Area creation request failed",
  );
}

export function updateArea(id: number, input: UpdateAreaRequest) {
  return mutationSnapshot(
    apiClient.api.v1.areas[":id"].$put({
      param: { id: String(id) },
      json: input,
    }),
    "Area update request failed",
  );
}

export function reorderAreas(input: ReorderAreasRequest) {
  return mutationSnapshot(
    apiClient.api.v1.areas.order.$put({ json: input }),
    "Area reorder request failed",
  );
}

export function trashArea(id: number) {
  return mutationSnapshot(
    apiClient.api.v1.areas[":id"].$delete({ param: { id: String(id) } }),
    "Area Trash request failed",
  );
}

export function restoreArea(id: number) {
  return mutationSnapshot(
    apiClient.api.v1.areas[":id"].restore.$post({ param: { id: String(id) } }),
    "Area restoration request failed",
  );
}

export function trashTask(id: string, input: TaskVersionRequest) {
  return mutationSnapshot(
    apiClient.api.v1.tasks[":id"].trash.$post({ param: { id }, json: input }),
    "Task Trash request failed",
  );
}

export function restoreTask(id: string, input: TaskVersionRequest) {
  return mutationSnapshot(
    apiClient.api.v1.tasks[":id"].restore.$post({
      param: { id },
      json: input,
    }),
    "Task restoration request failed",
  );
}

export function updateOwnerSettings(input: UpdateOwnerSettingsRequest) {
  return mutationSnapshot(
    apiClient.api.v1["owner-settings"].$put({ json: input }),
    "Owner settings update request failed",
  );
}

export function renameTag(id: number, input: RenameTagRequest) {
  return mutationSnapshot(
    apiClient.api.v1.tags[":id"].$put({
      param: { id: String(id) },
      json: input,
    }),
    "Tag rename request failed",
  );
}

export function deleteTag(id: number) {
  return mutationSnapshot(
    apiClient.api.v1.tags[":id"].$delete({ param: { id: String(id) } }),
    "Tag delete request failed",
  );
}

export function moveTask(input: MoveTaskRequest) {
  return mutationSnapshot(
    apiClient.api.v1.tasks.move.$put({ json: input }),
    "Task move request failed",
  );
}

export function reorderToday(input: ReorderTodayRequest) {
  return mutationSnapshot(
    apiClient.api.v1.today.order.$put({ json: input }),
    "Today reorder request failed",
  );
}

export function createView(input: ViewCreateRequest) {
  return mutationSnapshot(
    apiClient.api.v1.views.$post({ json: input }),
    "View creation request failed",
  );
}

export function updateView(id: string, input: ViewUpdateRequest) {
  return mutationSnapshot(
    apiClient.api.v1.views[":id"].$put({
      param: { id },
      json: input,
    }),
    "View update request failed",
  );
}

export function deleteView(id: string) {
  return mutationSnapshot(
    apiClient.api.v1.views[":id"].$delete({ param: { id } }),
    "View deletion request failed",
  );
}

export async function loadApiHealth() {
  try {
    const response = await apiClient.api.v1.health.$get();
    if (!response.ok) {
      return { status: "unavailable" as const };
    }
    const data = await response.json();
    return { status: "ready" as const, data };
  } catch {
    return { status: "unavailable" as const };
  }
}
