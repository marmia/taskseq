import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type {
  TaskResultColumn,
  TaskSearchSortCondition,
  TaskSearchSortDirection,
  TaskSearchSortField,
  ViewColumn,
} from "../../shared/api-schema";
import { defaultViewColumns } from "../../shared/api-schema";
import { allTaskResultColumns } from "../task-result-columns";

const viewSortFields: TaskSearchSortField[] = [...allTaskResultColumns];

export function ViewSortDialog({
  open,
  sort,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  sort: TaskSearchSortCondition[];
  onOpenChange: (open: boolean) => void;
  onChange: (sort: TaskSearchSortCondition[]) => void;
}) {
  const { t } = useTranslation();
  const addSortCondition = () => {
    const field = viewSortFields.find(
      (candidate) => !sort.some((condition) => condition.field === candidate),
    );
    if (!field) return;
    onChange([...sort, { field, direction: "asc" }]);
  };

  const updateSortCondition = (
    index: number,
    update: Partial<TaskSearchSortCondition>,
  ) => {
    onChange(
      sort.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...update } : condition,
      ),
    );
  };

  const removeSortCondition = (index: number) => {
    onChange(sort.filter((_, conditionIndex) => conditionIndex !== index));
  };

  const moveSortCondition = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= sort.length) return;
    onChange(arrayMove(sort, index, nextIndex));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[80] max-h-[84vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-bold">
                {t("viewResults.sort.dialogTitle")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                {t("viewResults.sort.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              aria-label={t("viewResults.sort.close")}
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          <ol
            aria-label={t("viewResults.sort.listLabel")}
            className="mt-4 grid gap-2"
          >
            {sort.map((condition, index) => {
              const label = t(`viewResults.table.column.${condition.field}`);
              const choices = viewSortFields.filter(
                (field) =>
                  field === condition.field ||
                  !sort.some((candidate) => candidate.field === field),
              );
              return (
                <li
                  key={condition.field}
                  aria-label={t("viewResults.sort.condition", { label })}
                  className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 min-[560px]:grid-cols-[1fr_10rem_auto] min-[560px]:items-center"
                >
                  <select
                    aria-label={t("viewResults.sort.field", {
                      index: index + 1,
                    })}
                    value={condition.field}
                    onChange={(event) =>
                      updateSortCondition(index, {
                        field: event.target.value as TaskSearchSortField,
                      })
                    }
                    className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-500"
                  >
                    {choices.map((field) => (
                      <option key={field} value={field}>
                        {t(`viewResults.table.column.${field}`)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("viewResults.sort.direction", {
                      index: index + 1,
                    })}
                    value={condition.direction}
                    onChange={(event) =>
                      updateSortCondition(index, {
                        direction: event.target
                          .value as TaskSearchSortDirection,
                      })
                    }
                    className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-500"
                  >
                    <option value="asc">
                      {t("viewResults.sort.ascending")}
                    </option>
                    <option value="desc">
                      {t("viewResults.sort.descending")}
                    </option>
                  </select>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      aria-label={t("viewResults.sort.moveUp", { label })}
                      onClick={() => moveSortCondition(index, -1)}
                      disabled={index === 0}
                      className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("viewResults.sort.moveDown", { label })}
                      onClick={() => moveSortCondition(index, 1)}
                      disabled={index === sort.length - 1}
                      className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("viewResults.sort.remove", { label })}
                      onClick={() => removeSortCondition(index)}
                      className="grid size-9 place-items-center rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          {sort.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
              {t("viewResults.sort.empty")}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={addSortCondition}
              disabled={sort.length >= viewSortFields.length}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:border-slate-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={16} aria-hidden="true" />
              {t("viewResults.sort.add")}
            </button>
            <button
              type="button"
              aria-label={t("viewResults.sort.reset")}
              onClick={() => onChange([])}
              disabled={sort.length === 0}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={15} aria-hidden="true" />
              {t("viewResults.sort.reset")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ViewColumnsDialog({
  open,
  columns,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  columns: ViewColumn[];
  onOpenChange: (open: boolean) => void;
  onChange: (columns: ViewColumn[]) => void;
}) {
  const { t } = useTranslation();
  const columnLabel = (id: string | number) =>
    t(`viewResults.table.column.${id as ViewColumn}`);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || active.id === "title") return;
    const oldIndex = columns.indexOf(active.id as ViewColumn);
    const targetIndex = columns.indexOf(over.id as ViewColumn);
    if (oldIndex < 0 || targetIndex < 0) return;
    const nextIndex = Math.max(1, targetIndex);
    onChange(arrayMove(columns, oldIndex, nextIndex));
  };

  const toggleColumn = (column: TaskResultColumn, visible: boolean) => {
    if (column === "title") return;
    if (visible) {
      if (!columns.includes(column)) onChange([...columns, column]);
      return;
    }
    onChange(columns.filter((candidate) => candidate !== column));
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("viewResults.columns.dragStart", {
        label: columnLabel(active.id),
      }),
    onDragOver: ({ active, over }) =>
      over
        ? t("viewResults.columns.dragOver", {
            label: columnLabel(active.id),
            overLabel: columnLabel(over.id),
          })
        : t("viewResults.columns.dragOverOutside", {
            label: columnLabel(active.id),
          }),
    onDragEnd: ({ active, over }) =>
      over
        ? t("viewResults.columns.dragEnd", {
            label: columnLabel(active.id),
            overLabel: columnLabel(over.id),
          })
        : t("viewResults.columns.dragEndNoTarget", {
            label: columnLabel(active.id),
          }),
    onDragCancel: ({ active }) =>
      t("viewResults.columns.dragCancel", {
        label: columnLabel(active.id),
      }),
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[80] max-h-[84vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-bold">
                {t("viewResults.columns.dialogTitle")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                {t("viewResults.columns.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              aria-label={t("viewResults.columns.close")}
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              {t("viewResults.columns.visibility")}
            </legend>
            <div className="mt-2 grid gap-2 min-[560px]:grid-cols-2">
              {allTaskResultColumns.map((column) => (
                <label
                  key={column}
                  className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700"
                >
                  <input
                    type="checkbox"
                    aria-label={t("viewResults.columns.show", {
                      label: t(`viewResults.table.column.${column}`),
                    })}
                    checked={columns.includes(column)}
                    disabled={column === "title"}
                    onChange={(event) =>
                      toggleColumn(column, event.target.checked)
                    }
                    className="size-4 rounded border-slate-300"
                  />
                  {t(`viewResults.table.column.${column}`)}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5">
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              {t("viewResults.columns.order")}
            </h2>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              accessibility={{
                announcements,
                screenReaderInstructions: {
                  draggable: t("viewResults.columns.dragHint"),
                },
              }}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={columns}
                strategy={verticalListSortingStrategy}
              >
                <ol
                  aria-label={t("viewResults.columns.orderLabel")}
                  className="mt-2 grid gap-2"
                >
                  {columns.map((column) => (
                    <SortableColumn
                      key={column}
                      column={column}
                      disabled={column === "title"}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          </div>

          <div className="mt-4 flex justify-end border-t border-slate-200 pt-4">
            <button
              type="button"
              aria-label={t("viewResults.columns.reset")}
              onClick={() => onChange([...defaultColumns()])}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            >
              <RotateCcw size={15} aria-hidden="true" />
              {t("viewResults.columns.reset")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SortableColumn({
  column,
  disabled,
}: {
  column: ViewColumn;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-label={t(`viewResults.table.column.${column}`)}
      className={`flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <button
        type="button"
        aria-label={t("viewResults.columns.move", {
          label: t(`viewResults.table.column.${column}`),
        })}
        disabled={disabled}
        className="grid size-9 shrink-0 cursor-grab place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-default disabled:opacity-30"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={17} aria-hidden="true" />
      </button>
      <span className="text-sm font-medium text-slate-700">
        {t(`viewResults.table.column.${column}`)}
      </span>
      {column === "title" ? (
        <span className="ml-auto text-xs font-semibold text-slate-400">
          {t("viewResults.columns.fixedLeft")}
        </span>
      ) : null}
    </li>
  );
}

function defaultColumns(): ViewColumn[] {
  return [...defaultViewColumns];
}
