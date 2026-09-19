import {
  normalizeRecurrenceRule,
  recurrenceRuleMatchesDate,
} from "../../domain/recurrence";
import { englishMessages } from "../i18n-resources";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

type TaskTimingValues = {
  start: string;
  startTime: string;
  startTimeEnabled?: boolean;
  due: string;
  dueTime: string;
  dueTimeEnabled?: boolean;
  recurrenceRule: string;
};

export type TaskTimingIssue = {
  field: "start" | "due" | "recurrenceRule";
  message: string;
};

export type TaskTimingMessageKey =
  | "taskAuthoring.validation.dueAfterStart"
  | "taskAuthoring.validation.invalidRepeat"
  | "taskAuthoring.validation.recurringStartDateOnly"
  | "taskAuthoring.validation.recurringDueSameDate"
  | "taskAuthoring.validation.startMatchesRepeat";

type TaskTimingTranslate = (key: TaskTimingMessageKey) => string;

const defaultTranslate: TaskTimingTranslate = (key) => {
  const messageKey = key.slice(
    "taskAuthoring.validation.".length,
  ) as keyof typeof englishMessages.taskAuthoring.validation;
  return englishMessages.taskAuthoring.validation[messageKey];
};

export function taskTimingIssues(
  values: TaskTimingValues,
  translate: TaskTimingTranslate = defaultTranslate,
): TaskTimingIssue[] {
  const issues: TaskTimingIssue[] = [];
  const startTime = values.startTimeEnabled === false ? "" : values.startTime;
  const dueTime = values.dueTimeEnabled === false ? "" : values.dueTime;
  const startValue = startTime ? `${values.start}T${startTime}` : values.start;
  const dueValue = dueTime ? `${values.due}T${dueTime}` : values.due;

  if (
    values.start &&
    values.due &&
    (dateOnlyPattern.test(startValue) || dateOnlyPattern.test(dueValue)
      ? dueValue.slice(0, 10) < startValue.slice(0, 10)
      : dueValue < startValue)
  ) {
    issues.push({
      field: "due",
      message: translate("taskAuthoring.validation.dueAfterStart"),
    });
  }

  if (!values.recurrenceRule.trim()) return issues;

  let recurrenceRule: string;
  try {
    recurrenceRule = normalizeRecurrenceRule(values.recurrenceRule);
  } catch {
    issues.push({
      field: "recurrenceRule",
      message: translate("taskAuthoring.validation.invalidRepeat"),
    });
    return issues;
  }

  if (!values.start || startTime) {
    issues.push({
      field: "start",
      message: translate("taskAuthoring.validation.recurringStartDateOnly"),
    });
    return issues;
  }
  if (values.due && (values.due !== values.start || dueTime)) {
    issues.push({
      field: "due",
      message: translate("taskAuthoring.validation.recurringDueSameDate"),
    });
  }
  if (!recurrenceRuleMatchesDate(recurrenceRule, values.start)) {
    issues.push({
      field: "start",
      message: translate("taskAuthoring.validation.startMatchesRepeat"),
    });
  }

  return issues;
}
