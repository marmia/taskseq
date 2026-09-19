import { zodResolver } from "@hookform/resolvers/zod";
import * as Dialog from "@radix-ui/react-dialog";
import type { TFunction } from "i18next";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  defaultViewColumns,
  defaultViewSort,
  normalizeAreaConditionNames,
  normalizeTagConditionNames,
  type View,
  type ViewConditionField,
  type ViewDefinitionBase,
  viewCreateRequestSchema,
  viewDefinitionBaseSchema,
  viewUpdateRequestSchema,
} from "../../shared/api-schema";
import { ApiRequestError } from "../api-client";
import { useNotifications } from "../notification-center";
import { useAppSettings } from "../settings-store";
import { viewMutationFailure } from "../view-mutation-errors";
import {
  createViewConditionDraft,
  type ViewConditionDraft,
  ViewConditionEditor,
  viewConditionFields,
} from "./view-condition-editor";

type ValidationIssue = {
  path: PropertyKey[];
  message: string;
  language?: "en";
};

export function ViewDefinitionDialog({
  open,
  onOpenChange,
  view,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view?: View;
  onCreated?: (view: View) => void;
  onUpdated?: (view: View) => void;
}) {
  if (!open) return null;
  return (
    <ViewDefinitionDialogContent
      open={open}
      onOpenChange={onOpenChange}
      view={view}
      onCreated={onCreated}
      onUpdated={onUpdated}
    />
  );
}

function ViewDefinitionDialogContent({
  open,
  onOpenChange,
  view,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view?: View;
  onCreated?: (view: View) => void;
  onUpdated?: (view: View) => void;
}) {
  const { t } = useTranslation();
  const { addNotification } = useNotifications();
  const { areas, ownerTimeZone, weekStartsOn, createView, updateView } =
    useAppSettings();
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>(
    [],
  );
  const [validationAttempted, setValidationAttempted] = useState(false);
  const isEditing = Boolean(view);
  const {
    register,
    watch,
    setValue,
    getValues,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ViewDefinitionBase>({
    resolver: zodResolver(viewDefinitionBaseSchema),
    defaultValues: {
      name: view?.name ?? "",
      allTasks: view?.allTasks ?? false,
    },
  });
  const [conditions, setConditions] = useState<ViewConditionDraft[]>(() =>
    view?.conditions ? [...view.conditions] : [],
  );
  const allTasks = watch("allTasks");
  const name = watch("name");
  const definitionChanged =
    !view ||
    JSON.stringify({
      name: name.trim(),
      allTasks,
      conditions: normalizeViewConditions(conditions),
    }) !==
      JSON.stringify({
        name: view.name.trim(),
        allTasks: view.allTasks,
        conditions: normalizeViewConditions(view.conditions),
      });
  const saveDisabled =
    isSubmitting ||
    (isEditing ? !definitionChanged : !allTasks && conditions.length === 0);

  function parseViewDefinition(
    values: ViewDefinitionBase,
    nextConditions = conditions,
  ) {
    const parsed = viewCreateRequestSchema.safeParse({
      ...values,
      conditions: normalizeViewConditions(nextConditions),
      sort: view?.sort ?? [...defaultViewSort],
      columns: view?.columns ?? [...defaultViewColumns],
    });
    if (!parsed.success) {
      setValidationIssues(localizeViewValidationIssues(parsed.error.issues, t));
      return null;
    }
    setValidationIssues([]);
    return parsed.data;
  }

  function revalidateName(nextName: string) {
    if (!validationAttempted) return;
    const parsed = viewDefinitionBaseSchema.shape.name.safeParse(nextName);
    setValidationIssues((current) => [
      ...current.filter((issue) => issue.path[0] !== "name"),
      ...(parsed.success
        ? []
        : localizeViewValidationIssues(parsed.error.issues, t)),
    ]);
  }

  function revalidateConditions(
    nextConditions: ViewConditionDraft[],
    nextAllTasks = allTasks,
  ) {
    if (!validationAttempted) return;
    const parsed = viewCreateRequestSchema.safeParse({
      name: getValues("name"),
      allTasks: nextAllTasks,
      conditions: normalizeViewConditions(nextConditions),
      sort: view?.sort ?? [...defaultViewSort],
      columns: view?.columns ?? [...defaultViewColumns],
    });
    setValidationIssues((current) => [
      ...current.filter((issue) => issue.path[0] !== "conditions"),
      ...(parsed.success
        ? []
        : localizeViewValidationIssues(
            parsed.error.issues.filter(
              (issue) => issue.path[0] === "conditions",
            ),
            t,
          )),
    ]);
  }

  async function onSubmit(values: ViewDefinitionBase) {
    setValidationAttempted(true);
    const parsed = parseViewDefinition(values);
    if (!parsed) return;

    try {
      if (view) {
        const input = viewUpdateRequestSchema.parse({
          ...parsed,
          version: view.version,
        });
        const snapshot = await updateView(view.id, input);
        const updated = snapshot.views.find(
          (candidate) => candidate.id === view.id,
        );
        if (!updated)
          throw new Error("Updated View was not returned by the server");
        onUpdated?.(updated);
      } else {
        const snapshot = await createView(parsed);
        const created = snapshot.views.find(
          (candidate) => candidate.name === parsed.name,
        );
        if (!created)
          throw new Error("Created View was not returned by the server");
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (caughtError) {
      const fieldIssues = viewApiValidationIssues(caughtError);
      if (fieldIssues.length > 0) {
        setValidationIssues(fieldIssues);
        return;
      }
      addNotification(
        viewMutationFailure(
          view ? "edit" : "create",
          parsed.name,
          caughtError,
          t,
        ),
      );
    }
  }

  function onInvalid() {
    setValidationAttempted(true);
    parseViewDefinition(getValues());
  }

  function handleAllTasksChange(checked: boolean) {
    let nextConditions = conditions;
    if (checked && conditions.length > 0) {
      const confirmed = window.confirm(
        t("viewManagement.confirmation.allTasks"),
      );
      if (!confirmed) return;
      nextConditions = [];
      setConditions(nextConditions);
    }
    setValue("allTasks", checked, { shouldDirty: true });
    revalidateConditions(nextConditions, checked);
  }

  function addCondition() {
    const nextField =
      viewConditionFields.find(
        (field) => !conditions.some((condition) => condition.field === field),
      ) ?? "start";
    if (!nextField) return;
    const nextConditions = [...conditions, createViewConditionDraft(nextField)];
    setConditions(nextConditions);
    revalidateConditions(nextConditions);
  }

  function changeConditionField(index: number, field: ViewConditionField) {
    const nextConditions = conditions.map((condition, conditionIndex) =>
      conditionIndex === index ? createViewConditionDraft(field) : condition,
    );
    setConditions(nextConditions);
    revalidateConditions(nextConditions);
  }

  function updateCondition(index: number, condition: ViewConditionDraft) {
    const nextConditions = conditions.map((candidate, candidateIndex) =>
      candidateIndex === index ? condition : candidate,
    );
    setConditions(nextConditions);
    revalidateConditions(nextConditions);
  }

  function removeCondition(index: number) {
    const nextConditions = conditions.filter((_, i) => i !== index);
    setConditions(nextConditions);
    revalidateConditions(nextConditions);
  }

  function errorsForCondition(index: number) {
    return Array.from(
      new Set(
        validationIssues
          .filter(
            (issue) =>
              issue.path[0] === "conditions" && issue.path[1] === index,
          )
          .map((issue) => issue.message),
      ),
    );
  }

  const nameErrors = validationIssues.filter(
    (issue) => issue.path[0] === "name",
  );
  const generalConditionErrors = validationIssues.filter(
    (issue) =>
      issue.path[0] === "conditions" && typeof issue.path[1] !== "number",
  );
  const nameRegistration = register("name");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content
          data-view-definition-dialog="true"
          className="fixed left-1/2 top-3 z-[80] flex max-h-[calc(100dvh-3rem)] w-[calc(100%-1rem)] max-w-3xl -translate-x-1/2 overflow-visible rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl min-[640px]:top-[4vh] min-[640px]:w-[calc(100%-2rem)] min-[640px]:p-4"
        >
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-bold">
                  {t(
                    isEditing
                      ? "viewManagement.dialog.editTitle"
                      : "viewManagement.dialog.newTitle",
                  )}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-slate-500">
                  {t(
                    isEditing
                      ? "viewManagement.dialog.editDescription"
                      : "viewManagement.dialog.newDescription",
                  )}
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                aria-label={t("viewManagement.action.close")}
              >
                <X size={16} />
              </Dialog.Close>
            </div>

            <form className="mt-3" onSubmit={handleSubmit(onSubmit, onInvalid)}>
              <label className="grid gap-1.5 min-[640px]:grid-cols-[7rem_1fr] min-[640px]:items-center">
                <span className="text-xs font-semibold text-slate-500">
                  {t("viewManagement.field.nameLabel")}
                </span>
                <input
                  {...nameRegistration}
                  aria-label={t("viewManagement.field.nameLabel")}
                  autoComplete="off"
                  onChange={(event) => {
                    nameRegistration.onChange(event);
                    revalidateName(event.target.value);
                  }}
                  className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base outline-none focus:border-slate-500 focus:bg-white min-[560px]:text-sm"
                  placeholder={t("viewManagement.field.namePlaceholder")}
                />
              </label>
              {nameErrors.map((issue) => (
                <p
                  className="mt-1.5 text-sm text-rose-600"
                  role="alert"
                  key={issue.message}
                  lang={issue.language}
                >
                  {issue.message}
                </p>
              ))}

              <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  {...register("allTasks")}
                  type="checkbox"
                  aria-label={t("viewManagement.field.allTasks")}
                  checked={allTasks}
                  onChange={(event) =>
                    handleAllTasksChange(event.target.checked)
                  }
                  className="size-4 rounded border-slate-300"
                />
                <span>{t("viewManagement.field.allTasks")}</span>
              </label>

              <section
                aria-label={t("viewManagement.conditions.heading")}
                className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-2 min-[640px]:p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200 pb-2">
                  <h2 className="text-sm font-bold">
                    {t("viewManagement.conditions.heading")}
                  </h2>
                  <button
                    type="button"
                    aria-label={t("viewManagement.conditions.add")}
                    onClick={addCondition}
                    disabled={allTasks}
                    className="grid size-9 place-items-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 outline-none hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus aria-hidden="true" size={16} />
                  </button>
                </div>

                {generalConditionErrors.map((issue) => (
                  <p
                    className="mt-2 text-sm text-rose-600"
                    role="alert"
                    key={issue.message}
                    lang={issue.language}
                  >
                    {issue.message}
                  </p>
                ))}

                {conditions.length > 0 ? (
                  <ol
                    className="mt-2 grid gap-1.5"
                    aria-label={t("viewManagement.conditions.listLabel")}
                  >
                    {conditions.map((condition, index) => (
                      <ViewConditionEditor
                        key={conditionKey(condition, conditions)}
                        condition={condition}
                        fieldOptions={viewConditionFields.filter(
                          (field) =>
                            field === condition.field ||
                            field === "start" ||
                            field === "due" ||
                            !conditions.some(
                              (candidate) => candidate.field === field,
                            ),
                        )}
                        areas={areas}
                        ownerTimeZone={ownerTimeZone}
                        weekStartsOn={weekStartsOn}
                        errors={errorsForCondition(index)}
                        onChange={(next) => updateCondition(index, next)}
                        onFieldChange={(field) =>
                          changeConditionField(index, field)
                        }
                        onRemove={() => removeCondition(index)}
                      />
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    {allTasks
                      ? t("viewManagement.conditions.allTasksSelected")
                      : t("viewManagement.conditions.empty")}
                  </p>
                )}
              </section>

              <div className="sticky bottom-0 z-10 -mx-3 mt-3 flex justify-end gap-2 border-t border-slate-200 bg-white/95 px-3 pt-3 backdrop-blur min-[640px]:-mx-4 min-[640px]:px-4">
                <Dialog.Close className="min-h-9 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                  {t("viewManagement.action.cancel")}
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={saveDisabled}
                  className="min-h-9 rounded-lg bg-slate-950 px-4 py-1.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("viewManagement.action.save")}
                </button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteViewDialog({
  view,
  open,
  onOpenChange,
  onDeleteStart,
  onDeleteFailed,
  onDeleted,
}: {
  view: View;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteStart?: (id: string) => void;
  onDeleteFailed?: (id: string) => void;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const { deleteView } = useAppSettings();
  const { addNotification } = useNotifications();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      onDeleteStart?.(view.id);
      await deleteView(view.id);
      onDeleted?.();
      onOpenChange(false);
    } catch (caughtError) {
      onDeleteFailed?.(view.id);
      addNotification(viewMutationFailure("delete", view.name, caughtError, t));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <Dialog.Title className="text-base font-bold">
            {t("viewManagement.dialog.deleteTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">
            {t("viewManagement.dialog.deleteDescription", {
              target: view.name,
            })}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              {t("viewManagement.action.cancel")}
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="min-h-10 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("viewManagement.delete")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function viewApiValidationIssues(error: unknown): ValidationIssue[] {
  if (!(error instanceof ApiRequestError)) return [];
  return Object.entries(error.fieldErrors).flatMap(([field, message]) => {
    if ((field !== "name" && field !== "conditions") || message.length === 0) {
      return [];
    }
    return [{ path: [field], message, language: "en" }];
  });
}

function localizeViewValidationIssues(
  issues: ReadonlyArray<{
    code: string;
    path: PropertyKey[];
    message: string;
  }>,
  t: TFunction,
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path,
    message: viewValidationMessage(issue, t),
  }));
}

function viewValidationMessage(
  issue: {
    code: string;
    path: PropertyKey[];
    message: string;
  },
  t: TFunction,
) {
  if (issue.path[0] === "name") {
    if (issue.code === "too_small")
      return t("viewManagement.validation.nameRequired");
    if (issue.code === "too_big")
      return t("viewManagement.validation.nameTooLong");
  }

  switch (issue.message) {
    case "Select All Tasks or add at least one View condition":
      return t("viewManagement.validation.conditionsRequired");
    case "All Tasks Views cannot have conditions":
      return t("viewManagement.validation.allTasksWithConditions");
    case "View condition fields must be unique":
      return t("viewManagement.validation.conditionFieldUnique");
    case "Date range must be in ascending order":
      return t("viewManagement.validation.dateRangeAscending");
    case "View date conditions require a valid date-only value":
      return t("viewManagement.validation.dateRequired");
    default:
      return t("viewManagement.validation.invalidCondition");
  }
}

function normalizeViewConditions(conditions: ViewConditionDraft[]) {
  return conditions.map((condition) => {
    if (
      condition.field === "title" ||
      condition.field === "description" ||
      condition.field === "workNotes"
    ) {
      return {
        ...condition,
        value:
          typeof condition.value === "string"
            ? condition.value.trim().split(/\s+/).filter(Boolean).join(" ")
            : condition.value,
      };
    }
    if (
      condition.field === "tag" &&
      Array.isArray(condition.value) &&
      condition.value.every((name) => typeof name === "string")
    ) {
      return {
        ...condition,
        value: normalizeTagConditionNames(condition.value),
      };
    }
    if (
      condition.field === "area" &&
      Array.isArray(condition.value) &&
      condition.value.every((name) => typeof name === "string")
    ) {
      return {
        ...condition,
        value: normalizeAreaConditionNames(condition.value),
      };
    }
    return condition;
  });
}

function conditionKey(
  condition: ViewConditionDraft,
  conditions: ViewConditionDraft[],
) {
  const occurrence = conditions
    .slice(0, conditions.indexOf(condition))
    .filter((candidate) => candidate.field === condition.field).length;
  return `${condition.field}-${occurrence}`;
}
