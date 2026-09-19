import { useTranslation } from "react-i18next";
import {
  type ActionFunctionArgs,
  createBrowserRouter,
  Navigate,
  useRevalidator,
  useRouteError,
} from "react-router";
import type {
  BootstrapResponse,
  CreateTaskRequest,
  UpdateTaskRequest,
} from "../shared/api-schema";
import {
  ApiRequestError,
  createTask,
  loadApiHealth,
  loadBootstrap,
  updateTask,
} from "./api-client";
import { AppShell } from "./components/app-shell";
import { i18n } from "./i18n";
import {
  AreaDetailPage,
  AreasPage,
  InboxPage,
  NotFoundPage,
  SettingsPage,
  TodayPage,
  TrashPage,
  ViewManagementPage,
  ViewPage,
  WeekPage,
} from "./pages";

function HydrateFallback() {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-dvh place-items-center text-sm text-slate-500">
      {t("common.route.loading")}
    </div>
  );
}

export function RouteErrorBoundary() {
  useRouteError();
  const { revalidate } = useRevalidator();
  const { t } = useTranslation();

  return (
    <main className="grid min-h-[60vh] place-items-center p-6" role="alert">
      <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-base font-semibold">
          {t("common.route.errorTitle")}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("common.route.errorDescription")}
        </p>
        <button
          type="button"
          onClick={revalidate}
          className="mt-5 rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white"
        >
          {t("common.route.retry")}
        </button>
      </div>
    </main>
  );
}

export type TaskMutationField =
  | "title"
  | "areaId"
  | "parentId"
  | "start"
  | "due"
  | "tags"
  | "recurrenceRule"
  | "description"
  | "workNotes";

export type TaskMutationFailure =
  | {
      type: "validation";
      fieldErrors: Partial<Record<TaskMutationField, string>>;
    }
  | { type: "error" | "warning"; message: string };

export type TaskMutationResult =
  | { snapshot: BootstrapResponse; failure?: TaskMutationFailure }
  | { failure: TaskMutationFailure };

function taskMutationMessages(
  language: string,
  operation: FormDataEntryValue | null,
  title: string,
) {
  const t = i18n.getFixedT(language);
  return operation === "create"
    ? {
        system: t("common.taskMutation.create.system", { title }),
        rejected: t("common.taskMutation.create.rejected", { title }),
        conflict: t("common.taskMutation.create.conflict", { title }),
        reload: t("common.taskMutation.create.reload"),
      }
    : {
        system: t("common.taskMutation.update.system", { title }),
        rejected: t("common.taskMutation.update.rejected", { title }),
        conflict: t("common.taskMutation.update.conflict", { title }),
        reload: t("common.taskMutation.update.reload"),
      };
}

const taskMutationFieldMap: Record<string, TaskMutationField | undefined> = {
  title: "title",
  areaId: "areaId",
  parentId: "parentId",
  start: "start",
  due: "due",
  tagIds: "tags",
  newTagNames: "tags",
  recurrenceRule: "recurrenceRule",
  description: "description",
  workNotes: "workNotes",
};

function taskMutationFieldErrors(fieldErrors: Record<string, string>) {
  const mapped: Partial<Record<TaskMutationField, string>> = {};
  for (const [apiField, message] of Object.entries(fieldErrors)) {
    const formField = taskMutationFieldMap[apiField];
    if (formField && !mapped[formField]) mapped[formField] = message;
  }
  return mapped;
}

export async function taskMutationAction({
  request,
}: ActionFunctionArgs): Promise<TaskMutationResult> {
  const formData = await request.formData();
  const operation = formData.get("operation");
  const payload = formData.get("payload");
  if (typeof payload !== "string") {
    return {
      failure: {
        type: "error",
        message: i18n.t("common.taskMutation.invalidRequest"),
      },
    };
  }

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(payload);
  } catch {
    return {
      failure: {
        type: "error",
        message: i18n.t("common.taskMutation.invalidRequest"),
      },
    };
  }
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : "this Task";
  const currentTaskMutationMessages = taskMutationMessages(
    i18n.language,
    operation,
    title,
  );

  try {
    if (operation === "create") {
      return { snapshot: await createTask(input as CreateTaskRequest) };
    }
    if (operation === "update") {
      const { id, ...updateInput } = input;
      if (typeof id !== "string") {
        return {
          failure: {
            type: "error",
            message: i18n.t("common.taskMutation.invalidRequest"),
          },
        };
      }
      return {
        snapshot: await updateTask(id, updateInput as UpdateTaskRequest),
      };
    }
    return {
      failure: {
        type: "error",
        message: i18n.t("common.taskMutation.unknownOperation"),
      },
    };
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      Object.keys(error.fieldErrors).length > 0
    ) {
      const fieldErrors = taskMutationFieldErrors(error.fieldErrors);
      if (Object.keys(fieldErrors).length > 0) {
        return {
          failure: { type: "validation", fieldErrors },
        };
      }
    }
    if (error instanceof ApiRequestError && error.status === 409) {
      try {
        const latestSnapshot = await loadBootstrap();
        return {
          snapshot: latestSnapshot,
          failure: {
            type: "warning",
            message: taskMutationMessages(
              latestSnapshot.ownerSettings.displayLanguage,
              operation,
              title,
            ).conflict,
          },
        };
      } catch {
        return {
          failure: {
            type: "error",
            message: currentTaskMutationMessages.reload,
          },
        };
      }
    }
    if (
      error instanceof ApiRequestError &&
      error.status !== 401 &&
      error.status >= 400 &&
      error.status < 500
    ) {
      return {
        failure: {
          type: "warning",
          message: currentTaskMutationMessages.rejected,
        },
      };
    }
    return {
      failure: { type: "error", message: currentTaskMutationMessages.system },
    };
  }
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    HydrateFallback,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: "task-mutations", action: taskMutationAction },
      { path: "new", element: <Navigate to="/today" replace /> },
      { path: "today", element: <TodayPage /> },
      { path: "week", element: <WeekPage /> },
      { path: "inbox", element: <InboxPage /> },
      { path: "views", element: <ViewManagementPage /> },
      { path: "views/:viewId", element: <ViewPage /> },
      { path: "areas", element: <AreasPage /> },
      { path: "areas/:areaId", element: <AreaDetailPage /> },
      { path: "trash", element: <TrashPage /> },
      {
        path: "settings",
        loader: loadApiHealth,
        element: <SettingsPage />,
        errorElement: <RouteErrorBoundary />,
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
