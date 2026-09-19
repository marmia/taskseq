import { TZDate } from "@date-fns/tz";
import { type Day, endOfWeek, format } from "date-fns";

export const defaultOwnerTimeZone = "Asia/Tokyo";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function ownerLocalDateTimeNow(ownerTimeZone: string, now = Date.now()) {
  return format(new TZDate(now, ownerTimeZone), "yyyy-MM-dd'T'HH:mm");
}

export function localDateTimeToTaskValue(value: string, ownerTimeZone: string) {
  if (!value || dateOnlyPattern.test(value)) return value;

  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);

  return new TZDate(
    year,
    month - 1,
    day,
    hours,
    minutes,
    ownerTimeZone,
  ).toISOString();
}

export function taskValueToLocalDateTime(value: string, ownerTimeZone: string) {
  if (dateOnlyPattern.test(value)) return `${value}T00:00`;

  return format(new TZDate(value, ownerTimeZone), "yyyy-MM-dd'T'HH:mm");
}

export function editedLocalDateTimeToTaskValue(
  value: string,
  originalValue: string | null,
  ownerTimeZone: string,
) {
  if (
    originalValue &&
    dateOnlyPattern.test(originalValue) &&
    value === `${originalValue}T00:00`
  ) {
    return originalValue;
  }

  return localDateTimeToTaskValue(value, ownerTimeZone);
}

export function taskDate(value: string, ownerTimeZone: string) {
  if (dateOnlyPattern.test(value)) return value;

  return format(new TZDate(value, ownerTimeZone), "yyyy-MM-dd");
}

export function isScheduledOpenTaskValue(
  task: {
    status: "OPEN" | "COMPLETED";
    start: string | null;
    due: string | null;
    trashedAt?: string | null;
  },
  ownerTimeZone: string,
  periodEnd: string,
) {
  if (task.status !== "OPEN" || task.trashedAt) return false;

  const scheduledValue = task.start ?? task.due;
  return (
    scheduledValue !== null &&
    taskDate(scheduledValue, ownerTimeZone) <= periodEnd
  );
}

export function ownerToday(ownerTimeZone: string, now = Date.now()) {
  return format(new TZDate(now, ownerTimeZone), "yyyy-MM-dd");
}

export function ownerWeekEndDate(
  weekStartsOn: Day,
  ownerTimeZone: string,
  now = Date.now(),
) {
  return format(
    endOfWeek(new TZDate(now, ownerTimeZone), { weekStartsOn }),
    "yyyy-MM-dd",
  );
}

export function formatTaskDate(value: string, ownerTimeZone: string) {
  if (dateOnlyPattern.test(value)) return value.slice(5);

  return format(new TZDate(value, ownerTimeZone), "MM-dd HH:mm");
}

export function formatTaskListDate(
  value: string,
  ownerTimeZone: string,
  now = Date.now(),
) {
  const ownerDate = taskDate(value, ownerTimeZone);
  const [year, month, day] = ownerDate.split("-").map(Number);
  const currentYear = Number(ownerToday(ownerTimeZone, now).slice(0, 4));

  return year === currentYear ? `${month}/${day}` : `${year}/${month}/${day}`;
}

export type TaskListDateRangeParts = {
  startDate: string | null;
  dueDate: string | null;
  sameDate: boolean;
};

export function taskListDateRangeParts(
  start: string | null,
  due: string | null,
  ownerTimeZone: string,
  now = Date.now(),
): TaskListDateRangeParts | null {
  if (!start && !due) return null;

  return {
    startDate: start ? formatTaskListDate(start, ownerTimeZone, now) : null,
    dueDate: due ? formatTaskListDate(due, ownerTimeZone, now) : null,
    sameDate:
      start !== null &&
      due !== null &&
      taskDate(start, ownerTimeZone) === taskDate(due, ownerTimeZone),
  };
}

export function formatTaskListDateRange(
  start: string | null,
  due: string | null,
  ownerTimeZone: string,
  now = Date.now(),
) {
  const parts = taskListDateRangeParts(start, due, ownerTimeZone, now);
  if (!parts) return null;
  if (parts.sameDate) return parts.startDate ?? parts.dueDate;
  if (!parts.startDate) return `→ ${parts.dueDate}`;
  if (!parts.dueDate) return `${parts.startDate} →`;
  return `${parts.startDate} → ${parts.dueDate}`;
}

export function formatTaskDateTime(value: string, ownerTimeZone: string) {
  if (dateOnlyPattern.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return `${year}/${month}/${day}`;
  }

  return format(new TZDate(value, ownerTimeZone), "yyyy/M/d HH:mm");
}

export function isTaskDueBefore(
  value: string,
  today: string,
  now = Date.now(),
) {
  if (dateOnlyPattern.test(value)) return value < today;

  return new Date(value).getTime() < now;
}
