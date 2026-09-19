import { TZDate } from "@date-fns/tz";
import { DayPicker } from "@daypicker/react";
import { enUS } from "@daypicker/react/locale";
import { addMonths, format } from "date-fns";
import { ja } from "date-fns/locale";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ownerToday } from "../../domain/task-date";

const hours = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0"),
);
const minutes = Array.from({ length: 12 }, (_, index) =>
  String(index * 5).padStart(2, "0"),
);

type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function ownerDate(value: string, ownerTimeZone: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new TZDate(year, month - 1, day, 12, 0, ownerTimeZone);
}

function dateValue(value: Date, ownerTimeZone: string) {
  return format(new TZDate(value.getTime(), ownerTimeZone), "yyyy-MM-dd");
}

function moveMonth(value: Date, amount: number, ownerTimeZone: string) {
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

function normalizeTime(value: string) {
  const [hour = "00", minute = "00"] = value.split(":");
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function CalendarHeader({
  className,
  month,
  onMonthChange,
  ownerTimeZone,
  today,
  locale,
}: {
  className: string;
  month: Date;
  onMonthChange: (month: Date) => void;
  ownerTimeZone: string;
  today: string;
  locale: typeof enUS;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`task-date-time-header flex items-center justify-between gap-2 bg-white max-[559px]:gap-0 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2 max-[559px]:gap-1">
        <span
          data-task-calendar-month-title="true"
          className="block shrink-0 text-base font-semibold leading-7 text-slate-900"
        >
          {format(month, locale === ja ? "yyyy年M月" : "MMMM yyyy", {
            locale,
          })}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={t("taskAuthoring.datePicker.previousMonth")}
          onClick={() => onMonthChange(moveMonth(month, -1, ownerTimeZone))}
          className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 max-[559px]:size-8 min-[560px]:size-8"
        >
          <ChevronLeft size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("taskAuthoring.datePicker.today")}
          onClick={() =>
            onMonthChange(ownerDate(`${today.slice(0, 7)}-01`, ownerTimeZone))
          }
          className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 max-[559px]:size-8 min-[560px]:size-8"
        >
          ○
        </button>
        <button
          type="button"
          aria-label={t("taskAuthoring.datePicker.nextMonth")}
          onClick={() => onMonthChange(moveMonth(month, 1, ownerTimeZone))}
          className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 max-[559px]:size-8 min-[560px]:size-8"
        >
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function TaskDateTimePicker({
  label,
  date,
  time,
  timeEnabled,
  ownerTimeZone,
  weekStartsOn,
  onDateChange,
  onTimeChange,
  onTimeEnabledChange,
}: {
  label: "Start" | "Due";
  date: string;
  time: string;
  timeEnabled: boolean;
  ownerTimeZone: string;
  weekStartsOn: WeekStartsOn;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  onTimeEnabledChange: (enabled: boolean) => void;
}) {
  const { i18n, t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const dateButtonRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [calendarStyle, setCalendarStyle] = useState<CSSProperties>();
  const [draftDate, setDraftDate] = useState(date);
  const [draftTime, setDraftTime] = useState(normalizeTime(time));
  const [draftTimeEnabled, setDraftTimeEnabled] = useState(
    Boolean(date) && timeEnabled,
  );
  const [month, setMonth] = useState<Date>(() =>
    ownerDate(date || ownerToday(ownerTimeZone), ownerTimeZone),
  );
  const isMobileViewport =
    typeof window !== "undefined" && window.innerWidth < 560;
  const fieldLabel =
    label === "Start"
      ? t("taskAuthoring.field.start")
      : t("taskAuthoring.field.due");
  const dateLocale = i18n.resolvedLanguage === "ja" ? ja : enUS;
  const effectiveTimeEnabled = Boolean(draftDate) && draftTimeEnabled;

  const restoreDateButtonFocus = useCallback(() => {
    window.setTimeout(() => dateButtonRef.current?.focus(), 0);
  }, []);

  const closeCalendar = useCallback(() => {
    setIsOpen(false);
    setDraftDate(date);
    setDraftTime(normalizeTime(time));
    setDraftTimeEnabled(Boolean(date) && timeEnabled);
    restoreDateButtonFocus();
  }, [date, restoreDateButtonFocus, time, timeEnabled]);

  useEffect(() => {
    if (!isOpen) return;

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
  }, [closeCalendar, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const updateCalendarPosition = () => {
      const button = dateButtonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const width = Math.min(
        isMobileViewport ? 496 : 360,
        window.innerWidth - 32,
      );
      const estimatedHeight = 420;
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
  }, [isMobileViewport, isOpen]);

  const openCalendar = () => {
    setDraftDate(date);
    setDraftTime(normalizeTime(time));
    setDraftTimeEnabled(Boolean(date) && timeEnabled);
    setMonth(ownerDate(date || ownerToday(ownerTimeZone), ownerTimeZone));
    setIsOpen(true);
  };

  const toggleCalendar = () => {
    if (isOpen) {
      closeCalendar();
      return;
    }
    openCalendar();
  };

  const completeCalendar = () => {
    if (!draftDate) {
      onDateChange("");
      onTimeChange("00:00");
      onTimeEnabledChange(false);
    } else {
      onDateChange(draftDate);
      onTimeChange(draftTime);
      onTimeEnabledChange(draftTimeEnabled);
    }
    setIsOpen(false);
    restoreDateButtonFocus();
  };

  const clearCalendar = () => {
    onDateChange("");
    onTimeChange("00:00");
    onTimeEnabledChange(false);
    setDraftDate("");
    setDraftTime("00:00");
    setDraftTimeEnabled(false);
    setIsOpen(false);
    restoreDateButtonFocus();
  };

  const [hour, minute] = draftTime.split(":");
  const isLegacyMinute = !minutes.includes(minute);
  const today = ownerToday(ownerTimeZone);

  return (
    <div ref={containerRef} className="relative min-w-0">
      <div className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm focus-within:border-slate-500">
        <CalendarDays size={15} className="shrink-0 text-slate-400" />
        <span className="shrink-0 text-xs font-semibold text-slate-500">
          {fieldLabel}
        </span>
        <button
          ref={dateButtonRef}
          type="button"
          aria-label={fieldLabel}
          aria-controls={`${label.toLowerCase()}-calendar`}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          onClick={toggleCalendar}
          className={`min-w-0 flex-1 truncate text-left font-medium outline-none ${
            date ? "text-slate-700" : "text-slate-300"
          }`}
        >
          {date
            ? `${date.replaceAll("-", "/")}${timeEnabled ? ` ${normalizeTime(time)}` : ""}`
            : t("taskAuthoring.datePicker.placeholder")}
        </button>
      </div>

      {isOpen ? (
        <div
          ref={calendarRef}
          id={`${label.toLowerCase()}-calendar`}
          role="dialog"
          aria-label={t("taskAuthoring.datePicker.calendar", {
            label: fieldLabel,
          })}
          data-custom-calendar="true"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeCalendar();
            } else if (event.key === "Enter" && event.ctrlKey) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          className="fixed z-[90] grid max-h-[calc(100dvh-2rem)] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-xl max-[559px]:p-2"
          style={calendarStyle}
        >
          <button
            type="button"
            aria-label={t("taskAuthoring.datePicker.closeCalendar")}
            onClick={closeCalendar}
            className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 max-[559px]:right-2 max-[559px]:top-2"
          >
            <X size={17} aria-hidden="true" />
          </button>
          <CalendarHeader
            className="row-start-1 mb-1 pr-8"
            month={month}
            onMonthChange={setMonth}
            ownerTimeZone={ownerTimeZone}
            today={today}
            locale={dateLocale}
          />

          <div className="row-start-2 min-h-0 overflow-y-auto">
            <DayPicker
              mode="single"
              required
              autoFocus
              month={month}
              onMonthChange={setMonth}
              selected={
                draftDate ? ownerDate(draftDate, ownerTimeZone) : undefined
              }
              onSelect={(selected) => {
                if (selected) setDraftDate(dateValue(selected, ownerTimeZone));
              }}
              today={ownerDate(today, ownerTimeZone)}
              timeZone={ownerTimeZone}
              noonSafe
              weekStartsOn={weekStartsOn}
              locale={dateLocale}
              hideNavigation
              showOutsideDays
              className="task-date-time-day-picker task-date-time-picker-calendar mx-auto"
              style={
                {
                  "--rdp-accent-color": "#0f172a",
                  "--rdp-accent-background-color": "#e2e8f0",
                  "--rdp-today-color": "#dc2626",
                } as CSSProperties
              }
            />
          </div>

          <div className="row-start-3 mt-3 border-t border-slate-100 pt-3 max-[559px]:mt-2 max-[559px]:pt-2">
            <label className="flex min-h-9 items-center gap-2 text-xs font-semibold leading-7 text-slate-600 max-[559px]:min-h-8 max-[559px]:leading-6 min-[560px]:pl-2">
              <Clock3 size={15} className="text-slate-400" />
              <input
                type="checkbox"
                aria-label={t("taskAuthoring.datePicker.setTime", {
                  label: fieldLabel,
                })}
                checked={draftTimeEnabled}
                disabled={!draftDate}
                onChange={(event) => setDraftTimeEnabled(event.target.checked)}
              />
              {t("taskAuthoring.datePicker.setTimeLabel")}
            </label>
            {effectiveTimeEnabled ? (
              <div className="mt-2 grid grid-cols-2 gap-2 max-[559px]:mt-1 min-[560px]:mx-auto min-[560px]:w-1/2">
                <label className="sr-only" htmlFor={`${label}-hour`}>
                  {t("taskAuthoring.datePicker.hour", { label: fieldLabel })}
                </label>
                <select
                  id={`${label}-hour`}
                  aria-label={t("taskAuthoring.datePicker.hour", {
                    label: fieldLabel,
                  })}
                  value={hour}
                  size={isMobileViewport ? 3 : undefined}
                  onChange={(event) =>
                    setDraftTime(`${event.target.value}:${minute}`)
                  }
                  className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-base outline-none focus:border-slate-500"
                >
                  {hours.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`${label}-minute`}>
                  {t("taskAuthoring.datePicker.minute", {
                    label: fieldLabel,
                  })}
                </label>
                <select
                  id={`${label}-minute`}
                  aria-label={t("taskAuthoring.datePicker.minute", {
                    label: fieldLabel,
                  })}
                  value={minute}
                  size={isMobileViewport ? 3 : undefined}
                  onChange={(event) =>
                    setDraftTime(`${hour}:${event.target.value}`)
                  }
                  className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-base outline-none focus:border-slate-500"
                >
                  {isLegacyMinute ? (
                    <option value={minute} disabled>
                      {t("taskAuthoring.datePicker.existing", {
                        value: minute,
                      })}
                    </option>
                  ) : null}
                  {minutes.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="col-span-full row-start-4 mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3 max-[559px]:mt-2 max-[559px]:pt-2">
            <button
              type="button"
              onClick={clearCalendar}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              {t("taskAuthoring.datePicker.clear")}
            </button>
            <button
              type="button"
              onClick={completeCalendar}
              className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              {t("taskAuthoring.datePicker.done")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
