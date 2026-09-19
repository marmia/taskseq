import type { TFunction } from "i18next";
import type { DisplayLanguage } from "../shared/api-schema";
import { ApiRequestError } from "./api-client";

export type SettingsMutationOperation =
  | "create-area"
  | "edit-area"
  | "delete-area"
  | "restore-area"
  | "reorder-areas"
  | "rename-tag"
  | "delete-tag"
  | "update-owner-time-zone"
  | "update-week-start"
  | "update-trash-retention"
  | "update-display-language";

export class OwnerSettingsConflictReloadError extends Error {}

export class OwnerSettingsConflictError extends ApiRequestError {
  constructor(
    original: ApiRequestError,
    readonly latestDisplayLanguage: DisplayLanguage,
  ) {
    super(
      original.status,
      original.message,
      original.code,
      original.fieldErrors,
    );
  }
}

export function settingsMutationFailure(
  operation: SettingsMutationOperation,
  target: string,
  error: unknown,
  t?: TFunction,
) {
  const translate = t as
    | ((key: string, options?: Record<string, unknown>) => string)
    | undefined;
  const localize = (
    key: string,
    fallback: string,
    options?: Record<string, unknown>,
  ) => (translate ? translate(key, options) : fallback);
  const rejected =
    error instanceof ApiRequestError &&
    error.status !== 401 &&
    error.status >= 400 &&
    error.status < 500;
  const failure = (
    rejectedKey: string,
    rejectedMessage: string,
    fallbackKey: string,
    fallbackMessage: string,
  ) => ({
    type: rejected ? ("warning" as const) : ("error" as const),
    message: rejected
      ? localize(rejectedKey, rejectedMessage, { target })
      : localize(fallbackKey, fallbackMessage, { target }),
  });
  const areaHasTasks =
    operation === "delete-area" &&
    error instanceof ApiRequestError &&
    error.code === "AREA_HAS_TASKS";
  const areaNameRejected =
    operation === "create-area" &&
    error instanceof ApiRequestError &&
    Boolean(error.fieldErrors.name);

  switch (operation) {
    case "create-area":
      if (areaNameRejected) {
        return {
          type: "warning" as const,
          message: localize(
            "organization.errors.createAreaRejected",
            `Could not create “${target}”. The Area name was rejected. Try adding the Area again.`,
            { target },
          ),
        };
      }
      return failure(
        "organization.errors.createAreaRejected",
        `Could not create “${target}”. The Area name was rejected. Try adding the Area again.`,
        "organization.errors.createAreaFailed",
        `Could not create “${target}”. Try again from Add Area.`,
      );
    case "edit-area":
      return failure(
        "organization.errors.editAreaRejected",
        `Could not save “${target}”. Review the latest Area and try saving it again.`,
        "organization.errors.editAreaFailed",
        `Could not save “${target}”. Try saving the Area again.`,
      );
    case "delete-area":
      if (areaHasTasks) {
        return {
          type: "warning" as const,
          message: localize(
            "organization.errors.deleteAreaHasTasks",
            `Could not move “${target}” to Trash because it still has Tasks. Move every Task to another Area, then try again from Delete Area.`,
            { target },
          ),
        };
      }
      return failure(
        "organization.errors.deleteAreaRejected",
        `Could not move “${target}” to Trash. Review the latest Area and try again from Delete Area.`,
        "organization.errors.deleteAreaFailed",
        `Could not move “${target}” to Trash. Try again from Delete Area.`,
      );
    case "restore-area":
      return failure(
        "organization.errors.restoreAreaRejected",
        `Could not restore “${target}”. Review the latest Area and try again from Trash.`,
        "organization.errors.restoreAreaFailed",
        `Could not restore “${target}”. Try again from Trash.`,
      );
    case "reorder-areas":
      return failure(
        "organization.errors.reorderAreasRejected",
        "Could not save Area order. Review the current Areas and try moving an Area again.",
        "organization.errors.reorderAreasFailed",
        "Could not save Area order. Try moving an Area again.",
      );
    case "rename-tag":
      return failure(
        "organization.errors.renameTagRejected",
        `Could not rename “${target}”. Review the latest Tag and try again from the Tag field.`,
        "organization.errors.renameTagFailed",
        `Could not rename “${target}”. Try again from the Tag field.`,
      );
    case "delete-tag":
      return failure(
        "organization.errors.deleteTagRejected",
        `Could not delete “${target}”. Review the latest Tag and try again from Delete Tag.`,
        "organization.errors.deleteTagFailed",
        `Could not delete “${target}”. Try again from Delete Tag.`,
      );
    case "update-owner-time-zone":
    case "update-week-start":
    case "update-trash-retention":
    case "update-display-language": {
      const details = {
        "update-owner-time-zone": {
          target: "Owner timezone",
          changedTarget: "Owner timezone",
          retry: "changing Owner timezone",
          rejectedKey: "settings.errors.timeZone.rejected",
          failedKey: "settings.errors.timeZone.failed",
          conflictKey: "settings.errors.timeZone.conflict",
          reloadKey: "settings.errors.timeZone.reload",
        },
        "update-week-start": {
          target: "Week starts on",
          changedTarget: "Week start",
          retry: "changing Week starts on",
          rejectedKey: "settings.errors.weekStartsOn.rejected",
          failedKey: "settings.errors.weekStartsOn.failed",
          conflictKey: "settings.errors.weekStartsOn.conflict",
          reloadKey: "settings.errors.weekStartsOn.reload",
        },
        "update-trash-retention": {
          target: "Trash retention",
          changedTarget: "Trash retention",
          retry: "saving Trash retention",
          rejectedKey: "settings.errors.trashRetention.rejected",
          failedKey: "settings.errors.trashRetention.failed",
          conflictKey: "settings.errors.trashRetention.conflict",
          reloadKey: "settings.errors.trashRetention.reload",
        },
        "update-display-language": {
          target: "Display language",
          changedTarget: "Display language",
          retry: "changing Display language",
          rejectedKey: "settings.errors.displayLanguage.rejected",
          failedKey: "settings.errors.displayLanguage.failed",
          conflictKey: "settings.errors.displayLanguage.conflict",
          reloadKey: "settings.errors.displayLanguage.reload",
        },
      }[operation];
      if (error instanceof OwnerSettingsConflictReloadError) {
        return {
          type: "error" as const,
          message: localize(
            details.reloadKey,
            `Could not refresh ${details.target} after a version conflict. Reload the page, then try ${details.retry} again.`,
          ),
        };
      }
      if (error instanceof ApiRequestError && error.status === 409) {
        return {
          type: "warning" as const,
          message: localize(
            details.conflictKey,
            `${details.changedTarget} changed elsewhere. Review the latest setting before ${details.retry} again.`,
          ),
        };
      }
      return failure(
        details.rejectedKey,
        `Could not save ${details.target}. Review the latest setting before ${details.retry} again.`,
        details.failedKey,
        `Could not save ${details.target}. Try ${details.retry} again.`,
      );
    }
  }
}
