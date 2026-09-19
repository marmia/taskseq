import type { TFunction } from "i18next";
import { ApiRequestError } from "./api-client";

export type ViewMutationOperation =
  | "create"
  | "edit"
  | "delete"
  | "sort"
  | "columns";

export function viewMutationFailure(
  operation: ViewMutationOperation,
  target: string,
  error: unknown,
  t?: TFunction,
) {
  const rejected =
    error instanceof ApiRequestError &&
    error.status !== 401 &&
    error.status >= 400 &&
    error.status < 500;

  switch (operation) {
    case "create":
      return {
        type: rejected ? ("warning" as const) : ("error" as const),
        message: t
          ? t(
              rejected
                ? "viewManagement.errors.createRejected"
                : "viewManagement.errors.createFailed",
              { target },
            )
          : rejected
            ? `Could not create “${target}”. Review the View and try again from New View.`
            : `Could not create “${target}”. Try again from New View.`,
      };
    case "edit":
      return {
        type: rejected ? ("warning" as const) : ("error" as const),
        message: t
          ? t(
              rejected
                ? "viewManagement.errors.editRejected"
                : "viewManagement.errors.editFailed",
              { target },
            )
          : rejected
            ? `Could not save “${target}”. Review the latest View and try again from Edit View.`
            : `Could not save “${target}”. Try again from Edit View.`,
      };
    case "delete":
      return {
        type: rejected ? ("warning" as const) : ("error" as const),
        message: t
          ? t(
              rejected
                ? "viewManagement.errors.deleteRejected"
                : "viewManagement.errors.deleteFailed",
              { target },
            )
          : rejected
            ? `Could not delete “${target}”. Review the latest View and try again from Delete View.`
            : `Could not delete “${target}”. Try again from Delete View.`,
      };
    case "sort":
      return {
        type: rejected ? ("warning" as const) : ("error" as const),
        message: t
          ? t(
              rejected
                ? "viewManagement.errors.sortRejected"
                : "viewManagement.errors.sortFailed",
              { target },
            )
          : rejected
            ? `Could not save Sort for “${target}”. Review the latest View and try Sort again.`
            : `Could not save Sort for “${target}”. Try changing Sort again from this View.`,
      };
    case "columns":
      return {
        type: rejected ? ("warning" as const) : ("error" as const),
        message: t
          ? t(
              rejected
                ? "viewManagement.errors.columnsRejected"
                : "viewManagement.errors.columnsFailed",
              { target },
            )
          : rejected
            ? `Could not save Columns for “${target}”. Review the latest View and try Columns again.`
            : `Could not save Columns for “${target}”. Try changing Columns again from this View.`,
      };
  }
}
