const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekdayIndex = new Map(weekdays.map((day, index) => [day, index]));
const ordinals = ["1st", "2nd", "3rd", "4th", "5th"] as const;

type WeeklyRule = { family: "weekly"; weekdays: number[] };
type MonthlyDateRule = { family: "monthly-date"; dates: number[] };
type MonthlyWeekdayRule = {
  family: "monthly-weekday";
  entries: { ordinal: number; weekday: number; offset: number }[];
};
type Rule =
  | { family: "daily" }
  | WeeklyRule
  | MonthlyDateRule
  | MonthlyWeekdayRule;

export function normalizeRecurrenceRule(input: string) {
  return formatRule(parseRule(input));
}

export function recurrenceRuleMatchesDate(rule: string, date: string) {
  const parsed = parseRule(rule);
  return occurrenceDatesNear(parsed, date).includes(date);
}

export function nextOccurrenceDate(rule: string, after: string) {
  const parsed = parseRule(rule);
  const start = addDays(after, 1);
  for (let offset = 0; offset < 3700; offset += 1) {
    const candidate = addDays(start, offset);
    if (occurrenceDatesNear(parsed, candidate).includes(candidate))
      return candidate;
  }
  throw new Error("No next occurrence could be calculated");
}

function parseRule(input: string): Rule {
  const parts = input
    .trim()
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Repeat is required");
  if (parts.length === 1 && parts[0] === "day") return { family: "daily" };

  if (
    parts.every((part) => weekdayIndex.has(part as (typeof weekdays)[number]))
  ) {
    return {
      family: "weekly",
      weekdays: uniqueSorted(
        parts.map(
          (part) => weekdayIndex.get(part as (typeof weekdays)[number]) ?? -1,
        ),
      ),
    };
  }
  if (parts.every((part) => /^\d{1,2}$/.test(part))) {
    const dates = uniqueSorted(parts.map(Number));
    if (dates.some((date) => date < 1 || date > 31))
      throw new Error("Invalid monthly date");
    return { family: "monthly-date", dates };
  }

  const entries = parts.map((part) => {
    const match =
      /^(1st|2nd|3rd|4th|5th)\s+(sun|mon|tue|wed|thu|fri|sat)(?:\s*([+-])\s*(\d+))?$/.exec(
        part,
      );
    if (!match) throw new Error("Invalid Repeat syntax");
    return {
      ordinal: ordinals.indexOf(match[1] as (typeof ordinals)[number]) + 1,
      weekday: weekdayIndex.get(match[2] as (typeof weekdays)[number]) ?? -1,
      offset: match[3] === "-" ? -Number(match[4]) : Number(match[4] ?? 0),
    };
  });
  const hasOffset = entries.some((entry) => entry.offset !== 0);
  if (hasOffset && entries.some((entry) => entry.offset === 0)) {
    throw new Error("Monthly weekday rules cannot mix offsets");
  }
  return {
    family: "monthly-weekday",
    entries: entries.sort(
      (left, right) =>
        left.ordinal - right.ordinal ||
        left.weekday - right.weekday ||
        left.offset - right.offset,
    ),
  };
}

function formatRule(rule: Rule) {
  if (rule.family === "daily") return "day";
  if (rule.family === "weekly")
    return rule.weekdays.map((day) => weekdays[day]).join(", ");
  if (rule.family === "monthly-date") return rule.dates.join(", ");
  return rule.entries
    .map((entry) => {
      const base = `${ordinals[entry.ordinal - 1]} ${weekdays[entry.weekday]}`;
      return entry.offset === 0
        ? base
        : `${base} ${entry.offset > 0 ? "+" : "-"} ${Math.abs(entry.offset)}`;
    })
    .join(", ");
}

function occurrenceDatesNear(rule: Rule, date: string) {
  if (rule.family === "daily") return [date];
  const parsed = parseDate(date);
  if (rule.family === "weekly") {
    return rule.weekdays.includes(weekday(parsed)) ? [date] : [];
  }
  if (rule.family === "monthly-date") {
    return rule.dates.includes(parsed.day) ? [date] : [];
  }
  const candidates: string[] = [];
  for (const monthOffset of [-1, 0, 1]) {
    const { year, month } = addMonths(parsed.year, parsed.month, monthOffset);
    for (const entry of rule.entries) {
      const base = nthWeekday(year, month, entry.ordinal, entry.weekday);
      if (base) candidates.push(addDays(base, entry.offset));
    }
  }
  return candidates;
}

function nthWeekday(
  year: number,
  month: number,
  ordinal: number,
  targetWeekday: number,
) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day =
    1 + ((targetWeekday - first.getUTCDay() + 7) % 7) + (ordinal - 1) * 7;
  return day > daysInMonth(year, month)
    ? null
    : formatDate({ year, month, day });
}

function parseDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("Recurring Task dates must be date-only");
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addDays(date: string, days: number) {
  const parsed = parseDate(date);
  const next = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + days),
  );
  return formatDate({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

function addMonths(year: number, month: number, offset: number) {
  const value = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
}

function weekday(date: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(date: { year: number; month: number; day: number }) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}
