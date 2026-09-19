import { zodResolver } from "@hookform/resolvers/zod";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  CornerDownRight,
  Layers3,
  Repeat2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { z } from "zod";
import {
  canHaveSubtask,
  MAX_TASK_DEPTH,
  type Task,
  taskDepth,
} from "../../domain/task";
import {
  localDateTimeToTaskValue,
  taskValueToLocalDateTime,
} from "../../domain/task-date";
import { useBootstrap } from "../bootstrap-state";
import { useNotifications } from "../notification-center";
import type { TaskMutationResult } from "../router";
import {
  activeAreasInPositionOrder,
  systemManagedInbox,
  useAppSettings,
} from "../settings-store";
import { descendantTaskIds, useTaskStore } from "../task-store";
import { RepeatSyntaxTooltip } from "./repeat-syntax-tooltip";
import { resolveTagInput, TagInput } from "./tag-input";
import { TaskDateTimePicker } from "./task-date-time-picker";
import {
  type TaskTimingMessageKey,
  taskTimingIssues,
} from "./task-form-validation";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

type EditTaskValidationKey =
  | TaskTimingMessageKey
  | "taskAuthoring.validation.titleRequired"
  | "taskAuthoring.validation.subtaskRecurrence";

function editTaskSchema(
  hasSubtasks: boolean,
  translate: (key: EditTaskValidationKey) => string,
) {
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1, translate("taskAuthoring.validation.titleRequired")),
      areaId: z.string(),
      parentId: z.string(),
      start: z.string(),
      startTime: z.string(),
      startTimeEnabled: z.boolean(),
      due: z.string(),
      dueTime: z.string(),
      dueTimeEnabled: z.boolean(),
      tags: z.string(),
      description: z.string(),
      workNotes: z.string(),
      recurrenceRule: z.string(),
    })
    .superRefine((values, context) => {
      for (const issue of taskTimingIssues(values, translate)) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: [issue.field],
        });
      }
      if (hasSubtasks && values.recurrenceRule.trim()) {
        context.addIssue({
          code: "custom",
          message: translate("taskAuthoring.validation.subtaskRecurrence"),
          path: ["recurrenceRule"],
        });
      }
    });
}

type EditTaskForm = z.infer<ReturnType<typeof editTaskSchema>>;

function taskFormValues(task: Task, ownerTimeZone: string): EditTaskForm {
  const start = task.start
    ? taskValueToLocalDateTime(task.start, ownerTimeZone)
    : "";
  const due = task.due ? taskValueToLocalDateTime(task.due, ownerTimeZone) : "";

  return {
    title: task.title,
    areaId: task.areaId === null ? "" : String(task.areaId),
    parentId: task.parentId ?? "",
    start: start.slice(0, 10),
    startTime: dateOnlyPattern.test(task.start ?? "") ? "" : start.slice(11),
    startTimeEnabled: Boolean(task.start && !dateOnlyPattern.test(task.start)),
    due: due.slice(0, 10),
    dueTime: dateOnlyPattern.test(task.due ?? "") ? "" : due.slice(11),
    dueTimeEnabled: Boolean(task.due && !dateOnlyPattern.test(task.due)),
    tags: task.tags.map((tag) => tag.name).join(", "),
    description: task.description,
    workNotes: task.workNotes,
    recurrenceRule: task.recurrenceRule ?? "",
  };
}

export function EditTaskDialog({
  task,
  open,
  onOpenChange,
  onSaved,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  if (!open) return null;
  return (
    <EditTaskDialogContent
      task={task}
      open={open}
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />
  );
}

function EditTaskDialogContent({
  task,
  open,
  onOpenChange,
  onSaved,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const fetcher = useFetcher<TaskMutationResult>();
  const { t } = useTranslation();
  const { replaceSnapshot } = useBootstrap();
  const { addNotification } = useNotifications();
  const { areas, ownerTimeZone, tags, weekStartsOn } = useAppSettings();
  const { tasks } = useTaskStore();
  const movedTaskIds = descendantTaskIds(tasks, task.id);
  const hasSubtasks = tasks.some(
    (candidate) =>
      candidate.id !== task.id &&
      movedTaskIds.has(candidate.id) &&
      !candidate.trashedAt,
  );
  const activeAreas = activeAreasInPositionOrder(areas);
  const inbox = systemManagedInbox(areas);
  const contentRef = useRef<HTMLDivElement>(null);
  const handledResult = useRef<TaskMutationResult | undefined>(undefined);
  const validationSchema = useMemo(
    () => editTaskSchema(hasSubtasks, (key) => t(key)),
    [hasSubtasks, t],
  );
  const {
    register,
    watch,
    getValues,
    setValue,
    control,
    handleSubmit,
    clearErrors,
    setError,
    trigger,
    formState: { errors },
  } = useForm<EditTaskForm>({
    resolver: zodResolver(validationSchema),
    defaultValues: taskFormValues(task, ownerTimeZone),
  });
  const selectedAreaId = watch("areaId");
  const selectedParentId = watch("parentId");
  const description = watch("description");
  const [workNotesExpanded, setWorkNotesExpanded] = useState(false);
  const destinationAreaId = selectedAreaId ? Number(selectedAreaId) : null;
  const isAreaMove = destinationAreaId !== task.areaId;
  const movedSubtreeDepth = Math.max(
    1,
    ...tasks
      .filter((candidate) => movedTaskIds.has(candidate.id))
      .map((candidate) => taskDepth(candidate) - taskDepth(task) + 1),
  );
  const parentCandidates =
    destinationAreaId === null
      ? []
      : tasks.filter(
          (candidate) =>
            candidate.areaId === destinationAreaId &&
            !candidate.trashedAt &&
            !movedTaskIds.has(candidate.id) &&
            (candidate.id === task.parentId ||
              (candidate.status === "OPEN" &&
                !candidate.recurrenceRule &&
                canHaveSubtask(candidate) &&
                taskDepth(candidate) + movedSubtreeDepth <= MAX_TASK_DEPTH)),
        );
  const selectedAreaName =
    areas.find((area) => String(area.id) === selectedAreaId)?.name ?? "";
  const selectedParentPath =
    parentCandidates
      .find((candidate) => candidate.id === selectedParentId)
      ?.path.slice(1)
      .join(" / ") ?? t("taskAuthoring.field.areaRoot");
  const areaField = register("areaId");
  const descriptionField = register("description");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  register("startTimeEnabled");
  register("dueTimeEnabled");

  useEffect(() => {
    const textarea = descriptionRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const lineHeight =
      Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 20;
    const maxHeight = lineHeight * 3;
    const contentHeight =
      description.length === 0
        ? lineHeight
        : Math.max(textarea.scrollHeight, lineHeight);
    textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [description]);

  const onSubmit = (values: EditTaskForm) => {
    fetcher.submit(
      {
        operation: "update",
        payload: JSON.stringify({
          id: task.id,
          title: values.title.trim(),
          ...(isAreaMove ? { areaId: destinationAreaId } : {}),
          parentId: values.parentId || null,
          start: values.start
            ? values.startTimeEnabled
              ? localDateTimeToTaskValue(
                  `${values.start}T${values.startTime}`,
                  ownerTimeZone,
                )
              : values.start
            : null,
          due: values.due
            ? values.dueTimeEnabled
              ? localDateTimeToTaskValue(
                  `${values.due}T${values.dueTime}`,
                  ownerTimeZone,
                )
              : values.due
            : null,
          ...resolveTagInput(values.tags, tags),
          description: values.description,
          workNotes: values.workNotes,
          version: task.version ?? 1,
          recurrenceRule: values.recurrenceRule.trim() || null,
        }),
      },
      { action: "/task-mutations", method: "post" },
    );
  };

  useEffect(() => {
    const result = fetcher.data;
    if (!result || result === handledResult.current) return;
    handledResult.current = result;
    if ("snapshot" in result) replaceSnapshot(result.snapshot);
    if (result.failure?.type === "validation") {
      for (const [field, message] of Object.entries(
        result.failure.fieldErrors,
      )) {
        if (message && field in getValues()) {
          setError(field as keyof EditTaskForm, { type: "server", message });
        }
      }
      return;
    }
    if (result.failure) {
      addNotification(result.failure);
      return;
    }

    onSaved?.();
    onOpenChange(false);
  }, [
    addNotification,
    fetcher.data,
    getValues,
    onOpenChange,
    onSaved,
    replaceSnapshot,
    setError,
  ]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content
          ref={contentRef}
          onEscapeKeyDown={(event) => {
            const target = event.target as Element;
            if (
              target.closest('[data-custom-calendar="true"]') ||
              target.closest('[role="combobox"][aria-expanded="true"]')
            ) {
              event.preventDefault();
              return;
            }
            if (target !== contentRef.current) {
              event.preventDefault();
              contentRef.current?.focus();
            }
          }}
          tabIndex={-1}
          className="fixed inset-x-4 top-[8vh] z-[80] mx-auto flex max-h-[84vh] max-w-[480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <Dialog.Title className="sr-only">
            {t("taskAuthoring.dialog.editTitle")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("taskAuthoring.dialog.editDescription")}
          </Dialog.Description>

          <form
            className="flex min-h-0 flex-1 flex-col"
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.ctrlKey) {
                event.preventDefault();
                void handleSubmit(onSubmit)();
              }
            }}
            onSubmit={handleSubmit(onSubmit)}
          >
            <div className="shrink-0 border-b border-slate-100 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <input
                    {...register("title")}
                    aria-label={t("taskAuthoring.field.title.label")}
                    className="min-h-11 w-full border-0 p-0 text-lg font-bold outline-none placeholder:text-slate-300"
                    placeholder={t("taskAuthoring.field.title.placeholder")}
                  />
                  {errors.title ? (
                    <span className="mt-1 block text-xs text-rose-600">
                      <span
                        lang={errors.title.type === "server" ? "en" : undefined}
                      >
                        {errors.title.message}
                      </span>
                    </span>
                  ) : null}
                </div>
                <Dialog.Close
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                  aria-label={t("taskAuthoring.action.close")}
                >
                  <X size={16} />
                </Dialog.Close>
              </div>
              <textarea
                {...descriptionField}
                ref={(element) => {
                  descriptionField.ref(element);
                  descriptionRef.current = element;
                }}
                aria-label={t("taskAuthoring.field.description.label")}
                rows={1}
                className="mt-2 min-h-5 w-full resize-none overflow-y-hidden border-0 p-0 text-base leading-5 text-slate-600 outline-none placeholder:text-slate-300 min-[560px]:text-sm"
                placeholder={t("taskAuthoring.field.description.placeholder")}
              />
              {errors.description ? (
                <span
                  className="mt-1 block text-xs text-rose-600"
                  lang={errors.description.type === "server" ? "en" : undefined}
                >
                  {errors.description.message}
                </span>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
              <div>
                <div className="relative flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm focus-within:border-slate-500">
                  <Layers3
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none shrink-0 text-slate-400"
                  />
                  <select
                    {...areaField}
                    aria-label={t("taskAuthoring.field.area")}
                    title={selectedAreaName}
                    onChange={(event) => {
                      areaField.onChange(event);
                      setValue("parentId", "", { shouldDirty: true });
                    }}
                    className="min-w-0 flex-1 truncate appearance-none bg-transparent px-2 py-2 text-sm font-medium outline-none disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    {inbox ? (
                      <option value={inbox.id} lang="en">
                        Inbox
                      </option>
                    ) : null}
                    {activeAreas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className="pointer-events-none shrink-0 text-slate-400"
                  />
                </div>
                {errors.areaId ? (
                  <span
                    className="mt-1 block text-xs text-rose-600"
                    lang={errors.areaId.type === "server" ? "en" : undefined}
                  >
                    {errors.areaId.message}
                  </span>
                ) : null}
              </div>

              <div>
                <div className="relative flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm focus-within:border-slate-500">
                  <CornerDownRight
                    size={15}
                    aria-hidden="true"
                    className="shrink-0 text-slate-400"
                  />
                  <select
                    {...register("parentId")}
                    aria-label={t("taskAuthoring.field.taskPath")}
                    title={selectedParentPath}
                    disabled={destinationAreaId === null}
                    className="min-w-0 flex-1 truncate appearance-none bg-transparent px-2 py-2 text-sm font-medium outline-none disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    <option value="">
                      {t("taskAuthoring.field.areaRoot")}
                    </option>
                    {parentCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.path.slice(1).join(" / ")}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className="pointer-events-none shrink-0 text-slate-400"
                  />
                </div>
                {errors.parentId ? (
                  <span
                    className="mt-1 block text-xs text-rose-600"
                    lang={errors.parentId.type === "server" ? "en" : undefined}
                  >
                    {errors.parentId.message}
                  </span>
                ) : null}
              </div>

              <div>
                <TaskDateTimePicker
                  label="Start"
                  date={watch("start")}
                  time={watch("startTime") || "00:00"}
                  timeEnabled={watch("startTimeEnabled")}
                  ownerTimeZone={ownerTimeZone}
                  weekStartsOn={weekStartsOn}
                  onDateChange={(value) =>
                    setValue("start", value, { shouldDirty: true })
                  }
                  onTimeChange={(value) => {
                    setValue("startTime", value, { shouldDirty: true });
                  }}
                  onTimeEnabledChange={(enabled) => {
                    setValue("startTime", getValues("startTime") || "00:00", {
                      shouldDirty: true,
                    });
                    setValue("startTimeEnabled", enabled, {
                      shouldDirty: true,
                    });
                    if (!enabled) clearErrors("start");
                    if (errors.start) {
                      window.setTimeout(() => void trigger("start"), 0);
                    }
                  }}
                />
                {errors.start ? (
                  <span
                    className="mt-1 block text-[10px] text-rose-600"
                    lang={errors.start.type === "server" ? "en" : undefined}
                  >
                    {errors.start.message}
                  </span>
                ) : null}
              </div>
              <div>
                <TaskDateTimePicker
                  label="Due"
                  date={watch("due")}
                  time={watch("dueTime") || "00:00"}
                  timeEnabled={watch("dueTimeEnabled")}
                  ownerTimeZone={ownerTimeZone}
                  weekStartsOn={weekStartsOn}
                  onDateChange={(value) =>
                    setValue("due", value, { shouldDirty: true })
                  }
                  onTimeChange={(value) => {
                    setValue("dueTime", value, { shouldDirty: true });
                  }}
                  onTimeEnabledChange={(enabled) => {
                    setValue("dueTime", getValues("dueTime") || "00:00", {
                      shouldDirty: true,
                    });
                    setValue("dueTimeEnabled", enabled, {
                      shouldDirty: true,
                    });
                    if (!enabled) clearErrors("due");
                    if (errors.due) {
                      window.setTimeout(() => void trigger("due"), 0);
                    }
                  }}
                />
                {errors.due ? (
                  <span
                    className="mt-1 block text-[10px] text-rose-600"
                    lang={errors.due.type === "server" ? "en" : undefined}
                  >
                    {errors.due.message}
                  </span>
                ) : null}
              </div>

              <div>
                <div className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-slate-500">
                  <Repeat2
                    size={15}
                    aria-hidden="true"
                    className="shrink-0 text-slate-400"
                  />
                  <input
                    {...register("recurrenceRule")}
                    aria-label={t("taskAuthoring.field.repeat.label")}
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base outline-none placeholder:text-slate-300 min-[560px]:text-sm"
                    placeholder={t("taskAuthoring.field.repeat.placeholder")}
                  />
                  <RepeatSyntaxTooltip />
                </div>
                {errors.recurrenceRule ? (
                  <span
                    className="mt-1 block text-xs text-rose-600"
                    lang={
                      errors.recurrenceRule.type === "server" ? "en" : undefined
                    }
                  >
                    {errors.recurrenceRule.message}
                  </span>
                ) : null}
              </div>

              <div>
                <Controller
                  name="tags"
                  control={control}
                  render={({ field }) => (
                    <TagInput
                      value={field.value}
                      onChange={field.onChange}
                      ariaLabel={t("taskAuthoring.field.tags.label")}
                      listLabel={t("taskAuthoring.field.tags.existing")}
                      placeholder={t("taskAuthoring.field.tags.placeholder")}
                      containerClassName="mt-0 rounded-xl border border-slate-200 focus-within:border-slate-500"
                      inputClassName="min-h-11 rounded-xl border-0 bg-transparent py-2 max-[559px]:text-base"
                    />
                  )}
                />
                {errors.tags ? (
                  <span
                    className="mt-1 block text-xs text-rose-600"
                    lang={errors.tags.type === "server" ? "en" : undefined}
                  >
                    {errors.tags.message}
                  </span>
                ) : null}
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    {t("taskAuthoring.field.workNotes")}
                  </span>
                  <button
                    type="button"
                    aria-label={
                      workNotesExpanded
                        ? t("taskAuthoring.action.collapseWorkNotes")
                        : t("taskAuthoring.action.expandWorkNotes")
                    }
                    onClick={() =>
                      setWorkNotesExpanded((expanded) => !expanded)
                    }
                    className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {workNotesExpanded
                      ? t("taskAuthoring.action.collapse")
                      : t("taskAuthoring.action.expand")}
                  </button>
                </div>
                <textarea
                  {...register("workNotes")}
                  aria-label={t("taskAuthoring.field.workNotes")}
                  rows={workNotesExpanded ? 8 : 3}
                  className="mt-1.5 w-full resize-none overflow-y-auto rounded-xl border border-slate-200 px-3 py-2 text-base leading-5 outline-none focus:border-slate-500 min-[560px]:text-sm"
                />
                {errors.workNotes ? (
                  <span
                    className="mt-1 block text-xs text-rose-600"
                    lang={errors.workNotes.type === "server" ? "en" : undefined}
                  >
                    {errors.workNotes.message}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <span className="mr-auto text-[10px] text-slate-500">
                {t("taskAuthoring.action.shortcutSave")}
              </span>
              <Dialog.Close className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white">
                {t("taskAuthoring.action.cancel")}
              </Dialog.Close>
              <button
                type="submit"
                disabled={fetcher.state !== "idle"}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {t("taskAuthoring.action.saveChanges")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
