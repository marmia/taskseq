import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";
import type { Tag, Task } from "../domain/task";
import { localDateTimeToTaskValue } from "../domain/task-date";
import type {
  TaskSearchDateFilter,
  TaskSearchSortCondition,
  TitleSearchQuery,
  View,
  ViewCondition,
} from "../shared/api-schema";
import { serializeTask, type TaskRow } from "./bootstrap-repository";

export const SEARCH_PAGE_SIZE = 100;

export class SearchQueryError extends Error {}

type AreaSearchRow = {
  id: number;
  name: string;
  is_system_managed: number;
};

type TaskTagSearchRow = {
  task_id: string;
  id: number;
  name: string;
};

type ViewTextField = "title" | "description" | "workNotes";

type SearchCriteria = {
  textTerms: string[];
  fieldTerms: Partial<Record<ViewTextField, string[]>>;
  start: TaskSearchDateFilter[];
  due: TaskSearchDateFilter[];
  status: "ANY" | "OPEN" | "COMPLETED";
  areaNames: string[];
  tagNames: string[];
  tagOperator: "containsAll" | "containsNone";
  includeAll: boolean;
  sort: TaskSearchSortCondition[];
};

export async function searchTasks(
  database: D1Database,
  query: TitleSearchQuery,
): Promise<{ tasks: Task[] }> {
  const result = await searchTaskResults(
    database,
    {
      textTerms: [],
      fieldTerms: { title: [query.q] },
      start: [{ mode: "any" }],
      due: [{ mode: "any" }],
      status: "ANY",
      areaNames: [],
      tagNames: [],
      tagOperator: "containsAll",
      includeAll: false,
      sort: [],
    },
    0,
  );
  return { tasks: result.tasks };
}

export async function searchViewTasks(
  database: D1Database,
  view: View,
  cursor: number,
): Promise<{ tasks: Task[]; nextCursor: string | null }> {
  const criteria: SearchCriteria = {
    textTerms: [],
    fieldTerms: {},
    start: [{ mode: "any" }],
    due: [{ mode: "any" }],
    status: "ANY",
    areaNames: [],
    tagNames: [],
    tagOperator: "containsAll",
    includeAll: view.allTasks,
    sort: view.sort,
  };

  for (const condition of view.conditions) {
    if (
      condition.field === "title" ||
      condition.field === "description" ||
      condition.field === "workNotes"
    ) {
      criteria.fieldTerms[condition.field] = condition.value
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      continue;
    }

    if (condition.field === "start" || condition.field === "due") {
      criteria[condition.field].push(dateFilterForViewCondition(condition));
      continue;
    }

    if (condition.field === "status") {
      criteria.status = condition.value;
      continue;
    }

    if (condition.field === "area") {
      criteria.areaNames = condition.value;
      continue;
    }

    if (condition.field === "tag") {
      criteria.tagNames = condition.value;
      criteria.tagOperator = condition.operator;
    }
  }

  return searchTaskResults(database, criteria, cursor);
}

async function searchTaskResults(
  database: D1Database,
  criteria: SearchCriteria,
  cursor: number,
): Promise<{ tasks: Task[]; nextCursor: string | null }> {
  const ownerTimeZone = hasDateRange(criteria)
    ? await readOwnerTimeZone(database)
    : undefined;

  if (
    criteria.textTerms.length === 0 &&
    Object.values(criteria.fieldTerms).every(
      (terms) => !terms || terms.length === 0,
    ) &&
    criteria.start.every((filter) => filter.mode === "any") &&
    criteria.due.every((filter) => filter.mode === "any") &&
    criteria.status === "ANY" &&
    criteria.areaNames.length === 0 &&
    criteria.tagNames.length === 0 &&
    !criteria.includeAll
  ) {
    throw new SearchQueryError("Search query must contain a condition.");
  }

  const conditions = [
    "tasks.trashed_at IS NULL",
    "tasks.status IN ('OPEN', 'COMPLETED')",
  ];
  const parameters: Array<string | number> = [];

  const termClauses = criteria.textTerms.map(
    () =>
      `(LOWER(tasks.title) LIKE ? ESCAPE '\\' OR
        LOWER(tasks.description) LIKE ? ESCAPE '\\' OR
        LOWER(tasks.work_notes) LIKE ? ESCAPE '\\')`,
  );
  for (const term of criteria.textTerms) {
    const pattern = `%${escapeLikePattern(term.toLowerCase())}%`;
    parameters.push(pattern, pattern, pattern);
  }
  if (termClauses.length > 0) {
    conditions.push(`(${termClauses.join(" AND ")})`);
  }

  const textColumns: Record<ViewTextField, string> = {
    title: "tasks.title",
    description: "tasks.description",
    workNotes: "tasks.work_notes",
  };
  for (const field of Object.keys(textColumns) as ViewTextField[]) {
    for (const term of criteria.fieldTerms[field] ?? []) {
      conditions.push(`LOWER(${textColumns[field]}) LIKE ? ESCAPE '\\'`);
      parameters.push(`%${escapeLikePattern(term.toLowerCase())}%`);
    }
  }

  for (const filter of criteria.start) {
    appendDateCondition(
      conditions,
      parameters,
      "tasks.start",
      filter,
      ownerTimeZone,
    );
  }
  for (const filter of criteria.due) {
    appendDateCondition(
      conditions,
      parameters,
      "tasks.due",
      filter,
      ownerTimeZone,
    );
  }

  if (criteria.status !== "ANY") {
    conditions.push("tasks.status = ?");
    parameters.push(criteria.status);
  }
  if (criteria.areaNames.length > 0) {
    conditions.push(
      `EXISTS (
         SELECT 1 FROM areas AS filter_areas
         WHERE filter_areas.id = tasks.area_id
           AND filter_areas.trashed_at IS NULL
           AND filter_areas.name IN (${criteria.areaNames
             .map(() => "?")
             .join(", ")})
       )`,
    );
    parameters.push(...criteria.areaNames);
  }
  if (criteria.tagNames.length > 0) {
    if (criteria.tagOperator === "containsNone") {
      conditions.push(
        `NOT EXISTS (
           SELECT 1
           FROM task_tags AS filter_task_tags
           INNER JOIN tags AS filter_tags
             ON filter_tags.id = filter_task_tags.tag_id
           WHERE filter_task_tags.task_id = tasks.id
             AND LOWER(filter_tags.name) IN (${criteria.tagNames
               .map(() => "?")
               .join(", ")})
         )`,
      );
      parameters.push(...criteria.tagNames);
    } else {
      for (const tagName of criteria.tagNames) {
        conditions.push(
          `EXISTS (
             SELECT 1
             FROM task_tags AS filter_task_tags
             INNER JOIN tags AS filter_tags
               ON filter_tags.id = filter_task_tags.tag_id
             WHERE filter_task_tags.task_id = tasks.id
               AND LOWER(filter_tags.name) = ?
           )`,
        );
        parameters.push(tagName);
      }
    }
  }

  const sortAreaJoin = criteria.sort.some(
    (condition) => condition.field === "area",
  )
    ? " LEFT JOIN areas AS search_sort_area ON search_sort_area.id = tasks.area_id"
    : "";
  const sortPathJoin = criteria.sort.some(
    (condition) => condition.field === "path",
  )
    ? " LEFT JOIN task_paths AS search_sort_path ON search_sort_path.id = tasks.id"
    : "";
  const sortPathCte = criteria.sort.some(
    (condition) => condition.field === "path",
  )
    ? `WITH RECURSIVE task_paths AS (
         SELECT id, parent_task_id, LOWER(title) AS sort_path
         FROM tasks
         WHERE parent_task_id IS NULL
         UNION ALL
         SELECT child.id, child.parent_task_id,
                task_paths.sort_path || ' / ' || LOWER(child.title)
         FROM tasks AS child
         INNER JOIN task_paths ON task_paths.id = child.parent_task_id
       ) `
    : "";
  const orderBy = criteria.sort.length
    ? criteria.sort.map(sortExpression).join(", ")
    : "CASE WHEN tasks.updated_at IS NULL THEN 1 ELSE 0 END ASC, tasks.updated_at DESC";

  const page = await database
    .prepare(
      `${sortPathCte}SELECT tasks.id, tasks.title, tasks.description, tasks.work_notes,
              tasks.status, tasks.area_id, tasks.parent_task_id, tasks.start,
              tasks.due, tasks.completed_at, tasks.updated_at, tasks.trashed_at,
              tasks.trash_operation_id, tasks.recurrence_rule, tasks.version
       FROM tasks${sortAreaJoin}${sortPathJoin}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderBy}, tasks.id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...parameters, SEARCH_PAGE_SIZE + 1, cursor)
    .all<TaskRow>();

  const hasNextPage = page.results.length > SEARCH_PAGE_SIZE;
  const matchingRows = page.results.slice(0, SEARCH_PAGE_SIZE);
  if (matchingRows.length === 0) {
    return { tasks: [], nextCursor: null };
  }

  const [allTasks, areas, taskTags] = await Promise.all([
    database
      .prepare(
        `SELECT id, title, description, work_notes, status, area_id, parent_task_id,
                start, due, completed_at, updated_at, trashed_at, trash_operation_id, recurrence_rule, version
         FROM tasks`,
      )
      .all<TaskRow>(),
    database
      .prepare("SELECT id, name, is_system_managed FROM areas")
      .all<AreaSearchRow>(),
    database
      .prepare(
        `SELECT task_tags.task_id, tags.id, tags.name
         FROM task_tags
         INNER JOIN tags ON tags.id = task_tags.tag_id
         ORDER BY tags.name`,
      )
      .all<TaskTagSearchRow>(),
  ]);

  const tasksById = new Map(allTasks.results.map((task) => [task.id, task]));
  const areaNames = new Map(
    areas.results.map((area) => [
      area.id,
      area.is_system_managed === 1 ? "Inbox" : area.name,
    ]),
  );
  const tagsByTaskId = new Map<string, Tag[]>();
  for (const taskTag of taskTags.results) {
    const taskTagsForTask = tagsByTaskId.get(taskTag.task_id) ?? [];
    taskTagsForTask.push({ id: taskTag.id, name: taskTag.name });
    tagsByTaskId.set(taskTag.task_id, taskTagsForTask);
  }

  const tasks: Task[] = matchingRows.map((task) =>
    serializeTask(task, tasksById, areaNames, tagsByTaskId.get(task.id) ?? []),
  );

  return {
    tasks,
    nextCursor: hasNextPage ? String(cursor + SEARCH_PAGE_SIZE) : null,
  };
}

function appendDateCondition(
  conditions: string[],
  parameters: Array<string | number>,
  column: string,
  filter: TaskSearchDateFilter,
  ownerTimeZone: string | undefined,
) {
  if (filter.mode === "any") return;
  if (filter.mode === "unset") {
    conditions.push(`${column} IS NULL`);
    return;
  }

  conditions.push(`${column} IS NOT NULL`);
  const { from, to } = filter;
  const timestampRange = Boolean(from?.includes("T") || to?.includes("T"));
  if (timestampRange) {
    conditions.push(`instr(${column}, 'T') > 0`);
    if (from) {
      conditions.push(`datetime(${column}) >= datetime(?)`);
      parameters.push(toTimestampBoundary(from, ownerTimeZone));
    }
    if (to) {
      conditions.push(`datetime(${column}) <= datetime(?)`);
      parameters.push(toTimestampBoundary(to, ownerTimeZone));
    }
    return;
  }

  const dateOnlyConditions: string[] = [];
  const timestampConditions: string[] = [];
  const dateOnlyParameters: string[] = [];
  const timestampParameters: string[] = [];
  if (from) {
    dateOnlyConditions.push(`substr(${column}, 1, 10) >= ?`);
    dateOnlyParameters.push(from.slice(0, 10));
    timestampConditions.push(`datetime(${column}) >= datetime(?)`);
    timestampParameters.push(toTimestampBoundary(from, ownerTimeZone));
  }
  if (to) {
    dateOnlyConditions.push(`substr(${column}, 1, 10) <= ?`);
    dateOnlyParameters.push(to.slice(0, 10));
    timestampConditions.push(`datetime(${column}) < datetime(?)`);
    timestampParameters.push(
      toTimestampBoundary(nextCalendarDate(to), ownerTimeZone),
    );
  }
  parameters.push(...dateOnlyParameters, ...timestampParameters);
  conditions.push(
    `((instr(${column}, 'T') = 0 AND ${dateOnlyConditions.join(" AND ")}) OR
      (instr(${column}, 'T') > 0 AND ${timestampConditions.join(" AND ")}))`,
  );
}

function hasDateRange(criteria: SearchCriteria) {
  return (
    criteria.start.some((filter) => filter.mode === "range") ||
    criteria.due.some((filter) => filter.mode === "range")
  );
}

function dateFilterForViewCondition(
  condition: Extract<ViewCondition, { field: "start" | "due" }>,
): TaskSearchDateFilter {
  if (condition.operator === "isUnset") return { mode: "unset" };
  if (condition.operator === "between") {
    return { mode: "range", ...condition.value };
  }

  switch (condition.operator) {
    case "equals":
      return { mode: "range", from: condition.value, to: condition.value };
    case "before":
      return { mode: "range", to: previousCalendarDate(condition.value) };
    case "after":
      return { mode: "range", from: nextCalendarDate(condition.value) };
    case "onOrBefore":
      return { mode: "range", to: condition.value };
    case "onOrAfter":
      return { mode: "range", from: condition.value };
  }
}

async function readOwnerTimeZone(database: D1Database) {
  const settings = await database
    .prepare("SELECT time_zone FROM owner_settings WHERE id = 1")
    .first<{ time_zone: string }>();
  if (!settings) {
    throw new SearchQueryError("Owner timezone is not configured.");
  }
  return settings.time_zone;
}

function toTimestampBoundary(value: string, ownerTimeZone = "UTC") {
  if (value.includes("T")) return value;
  return localDateTimeToTaskValue(`${value.slice(0, 10)}T00:00`, ownerTimeZone);
}

function nextCalendarDate(value: string) {
  return shiftCalendarDate(value, 1);
}

function previousCalendarDate(value: string) {
  return shiftCalendarDate(value, -1);
}

function shiftCalendarDate(value: string, amount: number) {
  return format(
    addDays(new TZDate(`${value.slice(0, 10)}T12:00:00Z`, "UTC"), amount),
    "yyyy-MM-dd",
  );
}

function sortExpression(condition: TaskSearchSortCondition) {
  const expression = {
    title: "LOWER(tasks.title)",
    path: "LOWER(search_sort_path.sort_path)",
    start: "datetime(tasks.start)",
    due: "datetime(tasks.due)",
    updated: "tasks.updated_at",
    area: "LOWER(CASE WHEN search_sort_area.is_system_managed = 1 THEN 'Inbox' ELSE search_sort_area.name END)",
    tags: `(SELECT LOWER(group_concat(tag_name, ','))
            FROM (
              SELECT tags.name AS tag_name
              FROM task_tags
              INNER JOIN tags ON tags.id = task_tags.tag_id
              WHERE task_tags.task_id = tasks.id
              ORDER BY tags.name
            ))`,
    repeat: "LOWER(tasks.recurrence_rule)",
    description: "LOWER(NULLIF(tasks.description, ''))",
    workNotes: "LOWER(NULLIF(tasks.work_notes, ''))",
  }[condition.field];
  const direction = condition.direction === "asc" ? "ASC" : "DESC";
  return `CASE WHEN ${expression} IS NULL THEN 1 ELSE 0 END ASC, ${expression} ${direction}`;
}

function escapeLikePattern(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
