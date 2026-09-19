import { TZDate } from "@date-fns/tz";
import { DayPicker } from "@daypicker/react";
import { enUS, ja } from "@daypicker/react/locale";
import { addMonths, format } from "date-fns";
import type { TFunction } from "i18next";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MapPin,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Area } from "../../domain/task";
import { ownerToday } from "../../domain/task-date";
import {
  normalizeAreaConditionNames,
  normalizeTagConditionNames,
  type ViewConditionField,
  type ViewDateOperator,
  viewDateOperatorSchema,
} from "../../shared/api-schema";
import type { WeekStartsOn } from "../settings-store";
import { TagInput, tagSegments } from "./tag-input";

export type ViewConditionDraft = {
  field: ViewConditionField;
  operator: string;
  value: unknown;
};

export const viewConditionFields: ViewConditionField[] = [
  "title",
  "description",
  "workNotes",
  "start",
  "due",
  "status",
  "area",
  "tag",
];

export function createViewConditionDraft(
  field: ViewConditionField,
): ViewConditionDraft {
  switch (field) {
    case "title":
    case "description":
    case "workNotes":
      return { field, operator: "contains", value: "" };
    case "start":
    case "due":
      return { field, operator: "equals", value: "" };
    case "status":
      return { field, operator: "is", value: "OPEN" };
    case "area":
    case "tag":
      return {
        field,
        operator: field === "area" ? "isAnyOf" : "containsAll",
        value: [],
      };
  }
}

export function ViewConditionEditor({
  condition,
  fieldOptions,
  areas,
  ownerTimeZone,
  weekStartsOn,
  errors,
  onChange,
  onFieldChange,
  onRemove,
}: {
  condition: ViewConditionDraft;
  fieldOptions: ViewConditionField[];
  areas: Area[];
  ownerTimeZone: string;
  weekStartsOn: WeekStartsOn;
  errors: string[];
  onChange: (condition: ViewConditionDraft) => void;
  onFieldChange: (field: ViewConditionField) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const label = conditionFieldLabel(condition.field, t);

  return (
    <li
      className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
      aria-label={label}
    >
      <div className="grid items-start gap-1.5 min-[760px]:grid-cols-[minmax(9rem,1fr)_minmax(10rem,1fr)_minmax(14rem,2fr)_auto]">
        <label className="relative">
          <span className="sr-only">{t("viewCondition.fieldLabel")}</span>
          <select
            aria-label={t("viewCondition.fieldLabel")}
            value={condition.field}
            onChange={(event) => {
              if (isViewConditionField(event.target.value)) {
                onFieldChange(event.target.value);
              }
            }}
            className="min-h-9 w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 pr-8 text-base font-semibold text-slate-800 outline-none focus:border-slate-500 min-[560px]:text-sm"
          >
            {fieldOptions.map((field) => (
              <option key={field} value={field}>
                {conditionFieldLabel(field, t)}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            size={14}
          />
        </label>
        {condition.field === "tag" ? (
          <TagConditionOperator
            operator={condition.operator}
            onChange={(operator) => onChange({ ...condition, operator })}
          />
        ) : condition.field === "start" || condition.field === "due" ? (
          <DateConditionOperator
            field={condition.field}
            operator={condition.operator}
            onChange={(operator) =>
              onChange({
                ...condition,
                operator,
                value: changeDateConditionValue(
                  condition.operator,
                  condition.value,
                  operator,
                ),
              })
            }
          />
        ) : (
          <span className="flex min-h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-500">
            {operatorLabel(condition, t)}
          </span>
        )}
        <ConditionValue
          condition={condition}
          areas={areas}
          ownerTimeZone={ownerTimeZone}
          weekStartsOn={weekStartsOn}
          onChange={onChange}
        />
        <button
          type="button"
          aria-label={t("viewManagement.action.remove", { label })}
          onClick={onRemove}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700"
        >
          <X size={15} />
        </button>
      </div>

      {errors.length > 0 ? (
        <ul className="mt-1.5 grid gap-1 text-sm text-rose-600" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ConditionValue({
  condition,
  areas,
  ownerTimeZone,
  weekStartsOn,
  onChange,
}: {
  condition: ViewConditionDraft;
  areas: Area[];
  ownerTimeZone: string;
  weekStartsOn: WeekStartsOn;
  onChange: (condition: ViewConditionDraft) => void;
}) {
  const { t } = useTranslation();
  const datePickerValue = useMemo(
    () =>
      condition.field === "start" || condition.field === "due"
        ? dateConditionPickerValue(condition)
        : "",
    [condition],
  );

  if (
    condition.field === "title" ||
    condition.field === "description" ||
    condition.field === "workNotes"
  ) {
    return (
      <input
        aria-label={t("viewCondition.value.condition", {
          label: conditionFieldLabel(condition.field, t),
        })}
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(event) =>
          onChange({ ...condition, value: event.target.value })
        }
        className="min-h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-base outline-none focus:border-slate-500 focus:bg-white min-[560px]:text-sm"
        placeholder={t("viewCondition.value.textPlaceholder")}
      />
    );
  }

  if (condition.field === "start" || condition.field === "due") {
    if (condition.operator === "isUnset") return null;

    const label = conditionFieldLabel(condition.field, t);
    return (
      <DateConditionDatePicker
        label={label}
        mode={condition.operator === "between" ? "range" : "single"}
        value={datePickerValue}
        ownerTimeZone={ownerTimeZone}
        weekStartsOn={weekStartsOn}
        onChange={(value) => onChange({ ...condition, value })}
      />
    );
  }

  if (condition.field === "status") {
    return (
      <select
        aria-label={t("viewCondition.value.status")}
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(event) =>
          onChange({ ...condition, value: event.target.value })
        }
        className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-base outline-none focus:border-slate-500 min-[560px]:text-sm"
      >
        <option value="OPEN">{t("viewCondition.value.open")}</option>
        <option value="COMPLETED">{t("viewCondition.value.completed")}</option>
      </select>
    );
  }

  if (condition.field === "area") {
    return (
      <AreaConditionValue
        areas={areas}
        selectedNames={stringArrayValue(condition.value)}
        onChange={(value) => onChange({ ...condition, value })}
      />
    );
  }

  return (
    <TagConditionValue
      selectedNames={stringArrayValue(condition.value)}
      onChange={(value) => onChange({ ...condition, value })}
    />
  );
}

function AreaConditionValue({
  areas,
  selectedNames,
  onChange,
}: {
  areas: Area[];
  selectedNames: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [inputValue, setInputValue] = useState(() => selectedNames.join(", "));
  const previousSelectedNames = useRef(selectedNames);
  const rawParts = inputValue.split(",");
  const query = rawParts.at(-1)?.trim().toLowerCase() ?? "";
  const prefixNames = normalizeAreaConditionNames(rawParts.slice(0, -1));
  const excludedNames = hasTyped ? prefixNames : selectedNames;
  const candidates = areas.filter(
    (area) =>
      !area.trashedAt &&
      !excludedNames.includes(area.name) &&
      (!hasTyped || !query || area.name.toLowerCase().includes(query)),
  );

  useEffect(() => {
    if (
      !hasTyped &&
      !sameStringArray(previousSelectedNames.current, selectedNames)
    ) {
      setInputValue(selectedNames.join(", "));
    }
    previousSelectedNames.current = selectedNames;
  }, [hasTyped, selectedNames]);

  const chooseArea = (area: Area) => {
    const nextNames = [...(hasTyped ? prefixNames : selectedNames)];
    if (!nextNames.includes(area.name)) nextNames.push(area.name);
    setInputValue(nextNames.join(", "));
    onChange(nextNames);
    setHasTyped(false);
    setActiveIndex(0);
    setOpen(false);
  };

  return (
    <div
      className="relative"
      onBlurCapture={(event) => {
        if (
          !event.relatedTarget ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <MapPin
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400"
      />
      <input
        value={inputValue}
        onChange={(event) => {
          setInputValue(event.target.value);
          onChange(
            normalizeAreaConditionNames(areaSegments(event.target.value)),
          );
          setHasTyped(true);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => {
          setHasTyped(false);
          setActiveIndex(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (!open || candidates.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % candidates.length);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(
              (current) =>
                (current - 1 + candidates.length) % candidates.length,
            );
          }
          if (event.key === "Enter") {
            event.preventDefault();
            chooseArea(candidates[activeIndex] ?? candidates[0]);
          }
        }}
        role="combobox"
        aria-label={t("viewCondition.value.areas")}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && candidates.length > 0}
        className="min-h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-2.5 text-base outline-none placeholder:text-slate-300 focus:border-slate-500 focus:bg-white min-[560px]:text-sm"
        placeholder={t("viewCondition.value.areaPlaceholder")}
      />
      {open && candidates.length > 0 ? (
        <ul
          id={listId}
          aria-label={t("viewCondition.value.activeAreas")}
          className="absolute inset-x-0 bottom-full z-[90] mb-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          {candidates.map((area, index) => {
            const optionLabel = area.isSystemManaged ? "Inbox" : area.name;
            return (
              <li key={area.id}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseArea(area)}
                  className={[
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                    index === activeIndex
                      ? "bg-slate-100 text-slate-950"
                      : "text-slate-600 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <MapPin size={13} className="text-slate-400" />
                  <span
                    className="flex-1"
                    lang={area.isSystemManaged ? "en" : undefined}
                  >
                    {optionLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function TagConditionValue({
  selectedNames,
  onChange,
}: {
  selectedNames: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(() => selectedNames.join(", "));
  const previousSelectedNames = useRef(selectedNames);

  useEffect(() => {
    if (!sameStringArray(previousSelectedNames.current, selectedNames)) {
      setInputValue(selectedNames.join(", "));
    }
    previousSelectedNames.current = selectedNames;
  }, [selectedNames]);

  return (
    <TagInput
      containerClassName=""
      inputClassName="min-h-9 py-1 max-[559px]:text-base"
      value={inputValue}
      placeholder={t("viewCondition.value.tagPlaceholder")}
      ariaLabel={t("viewCondition.value.tags")}
      listLabel={t("viewCondition.value.existingTags")}
      onChange={(value) => {
        setInputValue(value);
        onChange(normalizeTagConditionNames(tagSegments(value)));
      }}
    />
  );
}

function TagConditionOperator({
  operator,
  onChange,
}: {
  operator: string;
  onChange: (operator: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <select
      aria-label={t("viewCondition.operatorLabel", {
        label: conditionFieldLabel("tag", t),
      })}
      value={operator}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-base outline-none focus:border-slate-500 min-[560px]:text-sm"
    >
      <option value="containsAll">
        {t("viewCondition.operator.containsAll")}
      </option>
      <option value="containsNone">
        {t("viewCondition.operator.containsNone")}
      </option>
    </select>
  );
}

function DateConditionOperator({
  field,
  operator,
  onChange,
}: {
  field: "start" | "due";
  operator: string;
  onChange: (operator: ViewDateOperator) => void;
}) {
  const { t } = useTranslation();
  const selectedOperator = isDateConditionOperator(operator)
    ? operator
    : "equals";

  return (
    <select
      aria-label={t("viewCondition.operatorLabel", {
        label: conditionFieldLabel(field, t),
      })}
      value={selectedOperator}
      onChange={(event) => {
        if (isDateConditionOperator(event.target.value)) {
          onChange(event.target.value);
        }
      }}
      className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-base outline-none focus:border-slate-500 min-[560px]:text-sm"
    >
      {viewDateOperatorSchema.options.map((dateOperator) => (
        <option key={dateOperator} value={dateOperator}>
          {dateOperatorLabel(dateOperator, t)}
        </option>
      ))}
    </select>
  );
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

type DateRangeValue = { from: string; to: string };

type DateConditionPickerValue = string | DateRangeValue;

function DateConditionDatePicker({
  label,
  mode,
  value,
  ownerTimeZone,
  weekStartsOn,
  onChange,
}: {
  label: string;
  mode: "single" | "range";
  value: DateConditionPickerValue;
  ownerTimeZone: string;
  weekStartsOn: WeekStartsOn;
  onChange: (value: DateConditionPickerValue) => void;
}) {
  const { i18n, t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const calendarId = useId();
  const [open, setOpen] = useState(false);
  const [calendarStyle, setCalendarStyle] = useState<CSSProperties>();
  const [draft, setDraft] = useState(value);
  const initialDate = pickerStartDate(value, mode);
  const [month, setMonth] = useState<Date>(() =>
    ownerCalendarDate(initialDate || ownerToday(ownerTimeZone), ownerTimeZone),
  );
  const rangeValue = mode === "range" ? dateRangeValue(draft) : null;
  const dateLocale = i18n.resolvedLanguage === "ja" ? ja : enUS;
  const portalTarget = triggerRef.current?.closest(
    '[data-view-definition-dialog="true"]',
  );

  useEffect(() => {
    if (!open) {
      setDraft(value);
      const nextDate = pickerStartDate(value, mode);
      if (nextDate) setMonth(ownerCalendarDate(nextDate, ownerTimeZone));
    }
  }, [mode, open, ownerTimeZone, value]);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !calendarRef.current?.contains(target)
      ) {
        closeCalendar();
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
  });

  useEffect(() => {
    if (!open) return;

    const updateCalendarPosition = () => {
      const button = triggerRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 32);
      const estimatedHeight = mode === "range" ? 390 : 350;
      const belowTop = rect.bottom + 8;
      const top =
        belowTop + estimatedHeight > window.innerHeight - 16
          ? Math.max(16, rect.top - estimatedHeight - 8)
          : belowTop;
      const left = Math.min(
        Math.max(16, rect.left),
        window.innerWidth - width - 16,
      );

      setCalendarStyle({
        left,
        maxHeight: Math.max(160, window.innerHeight - top - 16),
        top,
        width,
      });
    };

    updateCalendarPosition();
    window.addEventListener("resize", updateCalendarPosition);
    window.addEventListener("scroll", updateCalendarPosition, true);
    return () => {
      window.removeEventListener("resize", updateCalendarPosition);
      window.removeEventListener("scroll", updateCalendarPosition, true);
    };
  }, [mode, open]);

  function closeCalendar() {
    setDraft(value);
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function openCalendar() {
    setDraft(value);
    setMonth(
      ownerCalendarDate(
        pickerStartDate(value, mode) || ownerToday(ownerTimeZone),
        ownerTimeZone,
      ),
    );
    setOpen(true);
  }

  function completeCalendar() {
    onChange(draft);
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function clearCalendar() {
    onChange(mode === "range" ? { from: "", to: "" } : "");
    setDraft(mode === "range" ? { from: "", to: "" } : "");
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  const today = ownerToday(ownerTimeZone);
  const calendar =
    mode === "single" ? (
      <DayPicker
        mode="single"
        required
        autoFocus
        month={month}
        onMonthChange={setMonth}
        selected={
          typeof draft === "string" && draft
            ? ownerCalendarDate(draft, ownerTimeZone)
            : undefined
        }
        onSelect={(selected) => {
          if (selected) setDraft(calendarDateValue(selected, ownerTimeZone));
        }}
        today={ownerCalendarDate(today, ownerTimeZone)}
        timeZone={ownerTimeZone}
        noonSafe
        weekStartsOn={weekStartsOn}
        locale={dateLocale}
        hideNavigation
        showOutsideDays
        className="task-date-time-day-picker mx-auto"
        style={calendarStyleValues}
      />
    ) : (
      <DayPicker
        mode="range"
        resetOnSelect
        autoFocus
        month={month}
        onMonthChange={setMonth}
        selected={
          rangeValue
            ? {
                from: rangeValue.from
                  ? ownerCalendarDate(rangeValue.from, ownerTimeZone)
                  : undefined,
                to: rangeValue.to
                  ? ownerCalendarDate(rangeValue.to, ownerTimeZone)
                  : undefined,
              }
            : undefined
        }
        onSelect={(selected, triggerDate) => {
          if (!selected?.from) {
            setDraft(
              triggerDate
                ? {
                    from: calendarDateValue(triggerDate, ownerTimeZone),
                    to: "",
                  }
                : { from: "", to: "" },
            );
            return;
          }
          const from = calendarDateValue(selected.from, ownerTimeZone);
          const to = selected.to
            ? calendarDateValue(selected.to, ownerTimeZone)
            : "";
          setDraft({
            from: to && to < from ? to : from,
            to: to && to < from ? from : to,
          });
        }}
        today={ownerCalendarDate(today, ownerTimeZone)}
        timeZone={ownerTimeZone}
        noonSafe
        weekStartsOn={weekStartsOn}
        locale={dateLocale}
        hideNavigation
        showOutsideDays
        className="task-date-time-day-picker mx-auto"
        style={calendarStyleValues}
      />
    );

  return (
    <div ref={containerRef} className="relative min-w-0">
      <div className="flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-500 focus-within:border-slate-500">
        <CalendarDays size={14} className="shrink-0 text-slate-400" />
        {mode === "single" ? (
          <button
            ref={triggerRef}
            type="button"
            aria-label={t("viewCondition.date.date", { label })}
            aria-controls={calendarId}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => (open ? closeCalendar() : openCalendar())}
            className={`min-w-0 flex-1 truncate text-left font-medium outline-none ${
              typeof value === "string" && value
                ? "text-slate-700"
                : "text-slate-300"
            }`}
          >
            {typeof value === "string" && value
              ? formatConditionDate(value)
              : t("viewCondition.date.add")}
          </button>
        ) : (
          <>
            <button
              ref={triggerRef}
              type="button"
              aria-label={t("viewCondition.date.from", { label })}
              aria-controls={calendarId}
              aria-expanded={open}
              aria-haspopup="dialog"
              onClick={() => (open ? closeCalendar() : openCalendar())}
              className={`min-w-0 flex-1 truncate text-left font-medium outline-none ${
                rangeValue?.from ? "text-slate-700" : "text-slate-300"
              }`}
            >
              {rangeValue?.from
                ? formatConditionDate(rangeValue.from)
                : t("viewCondition.date.fromValue")}
            </button>
            <span aria-hidden="true">{t("viewCondition.date.toValue")}</span>
            <button
              type="button"
              aria-label={t("viewCondition.date.to", { label })}
              aria-controls={calendarId}
              aria-expanded={open}
              aria-haspopup="dialog"
              onClick={() => (open ? closeCalendar() : openCalendar())}
              className={`min-w-0 flex-1 truncate text-left font-medium outline-none ${
                rangeValue?.to ? "text-slate-700" : "text-slate-300"
              }`}
            >
              {rangeValue?.to
                ? formatConditionDate(rangeValue.to)
                : t("viewCondition.date.toValue")}
            </button>
          </>
        )}
      </div>

      {open && portalTarget
        ? createPortal(
            <div
              ref={calendarRef}
              id={calendarId}
              role="dialog"
              aria-label={t("viewCondition.date.calendar", { label })}
              data-custom-calendar="true"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeCalendar();
                }
              }}
              className="fixed z-[90] grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-xl max-[559px]:p-2"
              style={{ ...calendarStyle, pointerEvents: "all" }}
            >
              <button
                type="button"
                aria-label={t("viewCondition.date.close")}
                onClick={closeCalendar}
                className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 max-[559px]:right-2 max-[559px]:top-2"
              >
                <X size={17} aria-hidden="true" />
              </button>
              <div className="row-start-1 mb-1 flex items-center justify-between gap-2 bg-white pr-8 max-[559px]:gap-0">
                <span
                  data-task-calendar-month-title="true"
                  className="block shrink-0 text-base font-semibold leading-7 text-slate-900"
                >
                  {format(
                    month,
                    i18n.resolvedLanguage === "ja" ? "yyyy年M月" : "MMMM yyyy",
                    { locale: dateLocale },
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={t("viewCondition.date.previousMonth")}
                    onClick={() =>
                      setMonth(moveCalendarMonth(month, -1, ownerTimeZone))
                    }
                    className="grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("viewCondition.date.today")}
                    onClick={() =>
                      setMonth(
                        ownerCalendarDate(
                          `${today.slice(0, 7)}-01`,
                          ownerTimeZone,
                        ),
                      )
                    }
                    className="grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
                  >
                    ○
                  </button>
                  <button
                    type="button"
                    aria-label={t("viewCondition.date.nextMonth")}
                    onClick={() =>
                      setMonth(moveCalendarMonth(month, 1, ownerTimeZone))
                    }
                    className="grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
                  >
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="row-start-2 min-h-0 overflow-y-auto">
                {calendar}
              </div>
              <div className="row-start-3 mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 max-[559px]:mt-2 max-[559px]:pt-2">
                <button
                  type="button"
                  onClick={clearCalendar}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  {t("viewCondition.date.clear")}
                </button>
                <button
                  type="button"
                  onClick={completeCalendar}
                  className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {t("viewCondition.date.done")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const calendarStyleValues = {
  "--rdp-accent-color": "#0f172a",
  "--rdp-accent-background-color": "#e2e8f0",
  "--rdp-today-color": "#dc2626",
} as CSSProperties;

function dateRangeValue(value: unknown): DateRangeValue {
  if (!value || typeof value !== "object") return { from: "", to: "" };
  const range = value as { from?: unknown; to?: unknown };
  return {
    from: typeof range.from === "string" ? range.from : "",
    to: typeof range.to === "string" ? range.to : "",
  };
}

function isDateConditionOperator(value: string): value is ViewDateOperator {
  return viewDateOperatorSchema.options.includes(value as ViewDateOperator);
}

function changeDateConditionValue(
  currentOperator: string,
  currentValue: unknown,
  nextOperator: ViewDateOperator,
): DateConditionPickerValue | null {
  if (nextOperator === "isUnset") return null;
  if (nextOperator === "between") {
    return currentOperator === "between"
      ? dateRangeValue(currentValue)
      : {
          from: typeof currentValue === "string" ? currentValue : "",
          to: "",
        };
  }
  if (currentOperator === "between") {
    return dateRangeValue(currentValue).from;
  }
  return typeof currentValue === "string" ? currentValue : "";
}

function dateConditionPickerValue(
  condition: ViewConditionDraft,
): DateConditionPickerValue {
  if (condition.operator === "between") return dateRangeValue(condition.value);
  return typeof condition.value === "string" ? condition.value : "";
}

function pickerStartDate(
  value: DateConditionPickerValue,
  mode: "single" | "range",
) {
  if (mode === "single") return typeof value === "string" ? value : value.from;
  return typeof value === "string" ? value : value.from || value.to;
}

function ownerCalendarDate(value: string, ownerTimeZone: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new TZDate(year, month - 1, day, 12, 0, ownerTimeZone);
}

function calendarDateValue(value: Date, ownerTimeZone: string) {
  return format(new TZDate(value.getTime(), ownerTimeZone), "yyyy-MM-dd");
}

function moveCalendarMonth(value: Date, amount: number, ownerTimeZone: string) {
  const next = addMonths(value, amount);
  return new TZDate(
    next.getFullYear(),
    next.getMonth(),
    1,
    12,
    0,
    ownerTimeZone,
  );
}

function formatConditionDate(value: string) {
  return value.replaceAll("-", "/");
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) && value.every((name) => typeof name === "string")
    ? value
    : [];
}

function areaSegments(value: string) {
  return value
    .split(",")
    .map((area) => area.trim())
    .filter(Boolean);
}

function conditionFieldLabel(field: ViewConditionField, t: TFunction) {
  return t(`viewCondition.field.${field}`);
}

function dateOperatorLabel(operator: ViewDateOperator, t: TFunction) {
  return t(`viewCondition.operator.${operator}`);
}

function operatorLabel(condition: ViewConditionDraft, t: TFunction) {
  switch (condition.operator) {
    case "contains":
      return t("viewCondition.operator.contains");
    case "isUnset":
      return t("viewCondition.operator.isUnset");
    case "is":
      return t("viewCondition.operator.is");
    case "isAnyOf":
      return t("viewCondition.operator.isAnyOf");
    case "containsAll":
      return t("viewCondition.operator.containsAll");
    case "containsNone":
      return t("viewCondition.operator.containsNone");
    default:
      return t("viewCondition.operator.value");
  }
}

export function isViewConditionField(
  value: string,
): value is ViewConditionField {
  return viewConditionFields.includes(value as ViewConditionField);
}
