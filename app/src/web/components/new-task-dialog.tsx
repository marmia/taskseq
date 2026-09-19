import { zodResolver } from "@hookform/resolvers/zod";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDown,
  CornerDownRight,
  Layers3,
  LockKeyhole,
  Repeat2,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import { z } from "zod";
import { canHaveSubtask, type Task } from "../../domain/task";
import { localDateTimeToTaskValue } from "../../domain/task-date";
import { useBootstrap } from "../bootstrap-state";
import { useNotifications } from "../notification-center";
import type { TaskMutationResult } from "../router";
import {
  activeAreasInPositionOrder,
  systemManagedInbox,
  useAppSettings,
} from "../settings-store";
import { useTaskStore } from "../task-store";
import { RepeatSyntaxTooltip } from "./repeat-syntax-tooltip";
import { resolveTagInput, TagInput } from "./tag-input";
import { TaskDateTimePicker } from "./task-date-time-picker";
import {
  type TaskTimingMessageKey,
  taskTimingIssues,
} from "./task-form-validation";

type NewTaskValidationKey =
  | TaskTimingMessageKey
  | "taskAuthoring.validation.titleRequired";

function newTaskSchema(translate: (key: NewTaskValidationKey) => string) {
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
      recurrenceRule: z.string(),
      description: z.string(),
    })
    .superRefine((values, context) => {
      for (const issue of taskTimingIssues(values, translate)) {
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: [issue.field],
        });
      }
    });
}

type NewTaskForm = z.infer<ReturnType<typeof newTaskSchema>>;

function newTaskDefaultValues(
  inboxAreaId: number | undefined,
  parentTask?: Pick<Task, "id" | "areaId">,
): NewTaskForm {
  return {
    title: "",
    areaId: parentTask
      ? String(parentTask.areaId)
      : inboxAreaId
        ? String(inboxAreaId)
        : "",
    parentId: parentTask?.id ?? "",
    start: "",
    startTime: "",
    startTimeEnabled: false,
    due: "",
    dueTime: "",
    dueTimeEnabled: false,
    tags: "",
    recurrenceRule: "",
    description: "",
  };
}

export function NewTaskDialog({
  open,
  onOpenChange,
  parentTask,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentTask?: Pick<Task, "id" | "areaId" | "path">;
  onCreated?: () => void;
}) {
  if (!open) return null;
  return (
    <NewTaskDialogContent
      open={open}
      onOpenChange={onOpenChange}
      parentTask={parentTask}
      onCreated={onCreated}
    />
  );
}

function NewTaskDialogContent({
  open,
  onOpenChange,
  parentTask,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentTask?: Pick<Task, "id" | "areaId" | "path">;
  onCreated?: () => void;
}) {
  const fetcher = useFetcher<TaskMutationResult>();
  const { t } = useTranslation();
  const { replaceSnapshot } = useBootstrap();
  const { addNotification } = useNotifications();
  const { areas, ownerTimeZone, tags, weekStartsOn } = useAppSettings();
  const { tasks } = useTaskStore();
  const activeAreas = activeAreasInPositionOrder(areas);
  const inbox = systemManagedInbox(areas);
  const contentRef = useRef<HTMLDivElement>(null);
  const handledResult = useRef<TaskMutationResult | undefined>(undefined);
  const {
    register,
    watch,
    reset,
    getValues,
    setValue,
    control,
    handleSubmit,
    clearErrors,
    setError,
    trigger,
    formState: { errors, isDirty },
  } = useForm<NewTaskForm>({
    resolver: zodResolver(newTaskSchema((key) => t(key))),
    defaultValues: newTaskDefaultValues(inbox?.id, parentTask),
  });
  const selectedAreaId = watch("areaId");
  const selectedParentId = watch("parentId");
  const description = watch("description");
  const areaId =
    parentTask?.areaId ?? (selectedAreaId ? Number(selectedAreaId) : null);
  const parentIsFixed = Boolean(parentTask);
  const parentCandidates = tasks.filter(
    (task) =>
      task.areaId === areaId &&
      task.status === "OPEN" &&
      !task.trashedAt &&
      !task.recurrenceRule &&
      canHaveSubtask(task),
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

  useEffect(() => {
    if (!open || isDirty) return;

    reset(newTaskDefaultValues(inbox?.id, parentTask));
  }, [inbox?.id, isDirty, open, parentTask, reset]);

  const clearDialog = () => {
    reset(newTaskDefaultValues(inbox?.id, parentTask));
  };

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen) clearDialog();
    onOpenChange(nextOpen);
  };

  const onSubmit = async (values: NewTaskForm) => {
    const submittedAreaId = parentTask?.areaId ?? areaId;
    const submittedParentId = parentTask?.id ?? (values.parentId || null);
    fetcher.submit(
      {
        operation: "create",
        payload: JSON.stringify({
          title: values.title.trim(),
          areaId: submittedAreaId,
          parentId: submittedParentId,
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
          recurrenceRule: values.recurrenceRule.trim() || null,
          description: values.description,
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
          setError(field as keyof NewTaskForm, { type: "server", message });
        }
      }
      return;
    }
    if (result.failure) {
      addNotification(result.failure);
      return;
    }

    onCreated?.();
    onOpenChange(false);
  }, [
    addNotification,
    fetcher.data,
    getValues,
    onCreated,
    onOpenChange,
    replaceSnapshot,
    setError,
  ]);

  const fixedParentPath =
    parentTask?.path.slice(1).join(" / ") ?? t("taskAuthoring.field.areaRoot");

  return (
    <Dialog.Root open={open} onOpenChange={handleDialogChange}>
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
            {parentTask
              ? t("taskAuthoring.dialog.subtaskTitle")
              : t("taskAuthoring.dialog.newTitle")}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {parentTask
              ? t("taskAuthoring.dialog.subtaskDescription", {
                  title: parentTask.path.at(-1) ?? "",
                })
              : t("taskAuthoring.dialog.newDescription")}
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
                    disabled={parentIsFixed}
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
                    {activeAreas.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  {parentIsFixed ? (
                    <LockKeyhole
                      size={15}
                      aria-hidden="true"
                      className="pointer-events-none shrink-0 text-slate-400"
                    />
                  ) : (
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className="pointer-events-none shrink-0 text-slate-400"
                    />
                  )}
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
                    title={parentIsFixed ? fixedParentPath : selectedParentPath}
                    disabled={areaId === null || parentIsFixed}
                    className="min-w-0 flex-1 truncate appearance-none bg-transparent px-2 py-2 text-sm font-medium outline-none disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    {parentIsFixed ? (
                      <option value={parentTask?.id}>{fixedParentPath}</option>
                    ) : (
                      <>
                        <option value="">
                          {t("taskAuthoring.field.areaRoot")}
                        </option>
                        {parentCandidates.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.path.slice(1).join(" / ")}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  {parentIsFixed ? (
                    <LockKeyhole
                      size={15}
                      aria-hidden="true"
                      className="pointer-events-none shrink-0 text-slate-400"
                    />
                  ) : (
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className="pointer-events-none shrink-0 text-slate-400"
                    />
                  )}
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
                      window.setTimeout(() => {
                        void trigger("start");
                      }, 0);
                    }
                  }}
                />
                {errors.start ? (
                  <span
                    className="mt-1 block text-xs text-rose-600"
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
                    className="mt-1 block text-xs text-rose-600"
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
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <span className="mr-auto text-[10px] text-slate-500">
                {t("taskAuthoring.action.shortcutAdd")}
              </span>
              <Dialog.Close className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white">
                {t("taskAuthoring.action.cancel")}
              </Dialog.Close>
              <button
                type="submit"
                disabled={fetcher.state !== "idle"}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {t("taskAuthoring.action.addTask")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
