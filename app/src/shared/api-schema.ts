import { isValid, parseISO } from "date-fns";
import { z } from "zod";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
const taskValueStringSchema = z
  .string()
  .refine(
    (value) =>
      (dateOnlyPattern.test(value) || timestampPattern.test(value)) &&
      isValid(parseISO(value)),
    "Task date must be date-only or an offset timestamp",
  );
const taskValueSchema = taskValueStringSchema.nullable();

const tagIdsSchema = z
  .array(z.number().int().positive())
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Tag IDs must be unique",
  });
const tagNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((name) => !name.includes(","), "Tag names cannot contain commas");
const tagNamesSchema = z.array(tagNameSchema);

export function normalizeTagConditionNames(names: string[]) {
  return names.reduce<string[]>((normalized, name) => {
    const candidate = name.trim().toLowerCase();
    if (candidate && !normalized.includes(candidate))
      normalized.push(candidate);
    return normalized;
  }, []);
}

export function normalizeAreaConditionNames(names: string[]) {
  return names.reduce<string[]>((normalized, name) => {
    const candidate = name.trim();
    if (candidate && !normalized.includes(candidate))
      normalized.push(candidate);
    return normalized;
  }, []);
}

const viewTagNamesSchema = z
  .array(
    z
      .string()
      .refine((name) => !name.includes(","), "Tag names cannot contain commas"),
  )
  .transform(normalizeTagConditionNames)
  .pipe(z.array(z.string()).min(1, "At least one Tag name is required"));

const viewAreaNamesSchema = z
  .array(
    z
      .string()
      .refine(
        (name) => !name.includes(","),
        "Area names cannot contain commas",
      ),
  )
  .transform(normalizeAreaConditionNames)
  .pipe(z.array(z.string()).min(1, "At least one Area name is required"));

export const areaColorSchema = z.enum([
  "blue",
  "purple",
  "green",
  "yellow",
  "orange",
  "pink",
  "brown",
  "gray",
]);

export const ownerTimeZoneOptions = [
  "UTC",
  ...Intl.supportedValuesOf("timeZone"),
];

export const ownerTimeZoneSchema = z
  .string()
  .refine((value) => ownerTimeZoneOptions.includes(value));

export const supportedDisplayLanguages = ["en", "ja"] as const;
export const displayLanguageSchema = z.enum(supportedDisplayLanguages);
export type DisplayLanguage = z.infer<typeof displayLanguageSchema>;

export const areaIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const tagIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const viewIdParamSchema = z.object({
  id: z.string().min(1),
});

export const taskResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.array(z.string()),
  areaId: z.number().int().positive(),
  parentId: z.string().optional(),
  status: z.enum(["OPEN", "COMPLETED"]),
  start: z.string().nullable(),
  due: z.string().nullable(),
  completedAt: z.string().nullable(),
  updatedAt: z.string(),
  tags: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
    }),
  ),
  description: z.string(),
  workNotes: z.string(),
  trashedAt: z.string().nullable().optional(),
  trashOperationId: z.string().nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
});

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("taskseq"),
  database: z.literal("ready"),
});

export const taskHasOpenRecurringDescendantsResponseSchema = z.object({
  error: z.object({
    code: z.literal("TASK_HAS_OPEN_RECURRING_DESCENDANTS"),
    message: z.string(),
    taskIds: z.array(z.string()).min(1),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const taskSearchDateModeSchema = z.enum(["any", "unset", "range"]);
export type TaskSearchDateMode = z.infer<typeof taskSearchDateModeSchema>;

export const taskSearchStatusSchema = z.enum(["ANY", "OPEN", "COMPLETED"]);
export type TaskSearchStatus = z.infer<typeof taskSearchStatusSchema>;

export const taskSearchSortFieldSchema = z.enum([
  "title",
  "path",
  "start",
  "due",
  "updated",
  "area",
  "tags",
  "repeat",
  "description",
  "workNotes",
]);
export type TaskSearchSortField = z.infer<typeof taskSearchSortFieldSchema>;

export const taskSearchSortDirectionSchema = z.enum(["asc", "desc"]);
export type TaskSearchSortDirection = z.infer<
  typeof taskSearchSortDirectionSchema
>;

export const taskSearchDateFilterSchema = z
  .object({
    mode: taskSearchDateModeSchema,
    from: taskValueStringSchema.optional(),
    to: taskValueStringSchema.optional(),
  })
  .superRefine((filter, context) => {
    if (filter.mode === "range" && !filter.from && !filter.to) {
      context.addIssue({
        code: "custom",
        message: "Date range needs a boundary",
        path: ["from"],
      });
    }
    if (filter.mode !== "range" && (filter.from || filter.to)) {
      context.addIssue({
        code: "custom",
        message: "Date boundaries require range mode",
        path: ["mode"],
      });
    }
    if (
      filter.from &&
      filter.to &&
      parseSearchDateValue(filter.from) > parseSearchDateValue(filter.to)
    ) {
      context.addIssue({
        code: "custom",
        message: "Date range must be in ascending order",
        path: ["to"],
      });
    }
  });

export const taskSearchSortConditionSchema = z.object({
  field: taskSearchSortFieldSchema,
  direction: taskSearchSortDirectionSchema,
});

export type TaskSearchDateFilter = z.infer<typeof taskSearchDateFilterSchema>;

export type TaskSearchSortCondition = z.infer<
  typeof taskSearchSortConditionSchema
>;

export const taskResultColumnSchema = z.enum([
  "title",
  "area",
  "path",
  "start",
  "due",
  "updated",
  "tags",
  "repeat",
  "description",
  "workNotes",
]);
export type TaskResultColumn = z.infer<typeof taskResultColumnSchema>;

export const defaultTaskResultColumns: TaskResultColumn[] = [
  "title",
  "area",
  "path",
  "start",
  "due",
  "updated",
];
export const viewColumnSchema = taskResultColumnSchema;
export type ViewColumn = z.infer<typeof viewColumnSchema>;

export const defaultViewColumns: ViewColumn[] = [...defaultTaskResultColumns];

export const defaultViewSort: TaskSearchSortCondition[] = [
  { field: "updated", direction: "desc" },
];

const viewColumnsSchema = z
  .array(viewColumnSchema)
  .min(1)
  .refine((columns) => new Set(columns).size === columns.length, {
    message: "View columns must be unique",
  })
  .refine((columns) => columns[0] === "title", {
    message: "Title must be the first View column",
  });

const viewSortSchema = z
  .array(taskSearchSortConditionSchema)
  .refine(
    (conditions) =>
      new Set(conditions.map((condition) => condition.field)).size ===
      conditions.length,
    { message: "View sort fields must be unique" },
  );

export const viewTextFieldSchema = z.enum([
  "title",
  "description",
  "workNotes",
]);
export type ViewTextField = z.infer<typeof viewTextFieldSchema>;

export const viewDateFieldSchema = z.enum(["start", "due"]);
export type ViewDateField = z.infer<typeof viewDateFieldSchema>;

export const viewDateOperatorSchema = z.enum([
  "equals",
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "between",
  "isUnset",
]);
export type ViewDateOperator = z.infer<typeof viewDateOperatorSchema>;

export const viewConditionFieldSchema = z.enum([
  "title",
  "description",
  "workNotes",
  "start",
  "due",
  "status",
  "area",
  "tag",
]);
export type ViewConditionField = z.infer<typeof viewConditionFieldSchema>;

const viewDateValueSchema = z
  .string()
  .refine(
    (value) => dateOnlyPattern.test(value) && isValid(parseISO(value)),
    "View date conditions require a valid date-only value",
  );

const viewDateRangeValueSchema = z
  .object({
    from: viewDateValueSchema,
    to: viewDateValueSchema,
  })
  .superRefine((range, context) => {
    if (parseSearchDateValue(range.from) > parseSearchDateValue(range.to)) {
      context.addIssue({
        code: "custom",
        message: "Date range must be in ascending order",
        path: ["to"],
      });
    }
  });

const viewTextConditionSchema = z.object({
  field: viewTextFieldSchema,
  operator: z.literal("contains"),
  value: z.string().trim().min(1).max(200),
});

const viewDateConditionSchema = z.union([
  z.object({
    field: viewDateFieldSchema,
    operator: z.literal("isUnset"),
    value: z.null(),
  }),
  z.object({
    field: viewDateFieldSchema,
    operator: viewDateOperatorSchema.exclude(["between", "isUnset"]),
    value: viewDateValueSchema,
  }),
  z.object({
    field: viewDateFieldSchema,
    operator: z.literal("between"),
    value: viewDateRangeValueSchema,
  }),
]);

const viewStatusConditionSchema = z.object({
  field: z.literal("status"),
  operator: z.literal("is"),
  value: z.enum(["OPEN", "COMPLETED"]),
});

const viewAreaConditionSchema = z.object({
  field: z.literal("area"),
  operator: z.literal("isAnyOf"),
  value: viewAreaNamesSchema,
});

const viewTagConditionSchema = z.object({
  field: z.literal("tag"),
  operator: z.enum(["containsAll", "containsNone"]),
  value: viewTagNamesSchema,
});

export const viewConditionSchema = z.union([
  viewTextConditionSchema,
  viewDateConditionSchema,
  viewStatusConditionSchema,
  viewAreaConditionSchema,
  viewTagConditionSchema,
]);
export type ViewCondition = z.infer<typeof viewConditionSchema>;

export const viewConditionsSchema = z
  .array(viewConditionSchema)
  .superRefine((conditions, context) => {
    const seen = new Set<ViewConditionField>();
    for (const [index, condition] of conditions.entries()) {
      if (
        seen.has(condition.field) &&
        condition.field !== "start" &&
        condition.field !== "due"
      ) {
        context.addIssue({
          code: "custom",
          message: "View condition fields must be unique",
          path: [index, "field"],
        });
      }
      seen.add(condition.field);
    }
  });

export const viewDefinitionBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  allTasks: z.boolean(),
});
export type ViewDefinitionBase = z.infer<typeof viewDefinitionBaseSchema>;

const viewDefinitionFields = {
  ...viewDefinitionBaseSchema.shape,
  conditions: viewConditionsSchema.default([]),
  sort: viewSortSchema.default([...defaultViewSort]),
  columns: viewColumnsSchema.default([...defaultViewColumns]),
};

function validateViewDefinition(
  view: {
    allTasks: boolean;
    conditions: ViewCondition[];
    sort: unknown[];
    columns: unknown[];
  },
  context: z.RefinementCtx,
) {
  if (!view.allTasks && view.conditions.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Select All Tasks or add at least one View condition",
      path: ["conditions"],
    });
  }
  if (view.allTasks && view.conditions.length > 0) {
    context.addIssue({
      code: "custom",
      message: "All Tasks Views cannot have conditions",
      path: ["conditions"],
    });
  }
}

export const viewCreateRequestSchema = z
  .object(viewDefinitionFields)
  .superRefine(validateViewDefinition);

export const viewUpdateRequestSchema = z
  .object({
    ...viewDefinitionFields,
    version: z.number().int().positive(),
  })
  .superRefine(validateViewDefinition);

export const viewResponseSchema = z
  .object({
    id: z.string().min(1),
    ...viewDefinitionFields,
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine(validateViewDefinition);

export type ViewCreateRequest = z.infer<typeof viewCreateRequestSchema>;
export type ViewUpdateRequest = z.infer<typeof viewUpdateRequestSchema>;
export type View = z.infer<typeof viewResponseSchema>;

export const bootstrapResponseSchema = z.object({
  areas: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      color: areaColorSchema,
      position: z.number().int(),
      isSystemManaged: z.boolean(),
      trashedAt: z.string().nullable().optional(),
    }),
  ),
  ownerSettings: z.object({
    displayLanguage: displayLanguageSchema,
    timeZone: z.string(),
    weekStartsOn: z.number().int().min(0).max(6),
    trashRetentionDays: z.number().int().positive(),
    version: z.number().int().positive(),
  }),
  tags: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
    }),
  ),
  tasks: z.array(taskResponseSchema),
  areaTaskOrders: z.record(z.string(), z.array(z.string())),
  inboxOrder: z.array(z.string()),
  todayOrders: z.record(z.string(), z.array(z.string())),
  views: z.array(viewResponseSchema),
});

export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;

export const titleSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200),
  })
  .strict();

export const titleSearchResponseSchema = z.object({
  tasks: z.array(taskResponseSchema),
});

export const taskSearchResponseSchema = z.object({
  tasks: z.array(taskResponseSchema),
  nextCursor: z.string().nullable(),
});

export type TaskSearchResponse = z.infer<typeof taskSearchResponseSchema>;
export type TitleSearchQuery = z.infer<typeof titleSearchQuerySchema>;
export type TitleSearchResponse = z.infer<typeof titleSearchResponseSchema>;

export const viewResultsQuerySchema = z.object({
  cursor: z.coerce
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),
});

export type ViewResultsQuery = z.infer<typeof viewResultsQuerySchema>;

const taskTimingSchema = z
  .object({
    start: taskValueSchema,
    due: taskValueSchema,
  })
  .refine(({ start, due }) => !start || !due || isDueAfterStart(start, due), {
    message: "Due must not be before Start",
    path: ["due"],
  });

export const createTaskRequestSchema = taskTimingSchema.extend({
  title: z.string().trim().min(1),
  areaId: z.number().int().positive().nullable(),
  parentId: z.string().nullable().optional(),
  description: z.string(),
  tagIds: tagIdsSchema.default([]),
  newTagNames: tagNamesSchema.default([]),
  recurrenceRule: z.string().trim().min(1).nullable().optional(),
});

export const updateTaskRequestSchema = taskTimingSchema.extend({
  title: z.string().trim().min(1),
  areaId: z.number().int().positive().optional(),
  parentId: z.string().nullable().optional(),
  description: z.string(),
  tagIds: tagIdsSchema.default([]),
  newTagNames: tagNamesSchema.default([]),
  workNotes: z.string(),
  version: z.number().int().positive(),
  recurrenceRule: z.string().trim().min(1).nullable().optional(),
});

export const updateTaskStatusRequestSchema = z.object({
  status: z.enum(["OPEN", "COMPLETED"]),
  version: z.number().int().positive(),
  cascadeDescendants: z.boolean().default(false),
  descendantVersions: z
    .record(z.string(), z.number().int().positive())
    .default({}),
  ancestorVersions: z
    .record(z.string(), z.number().int().positive())
    .default({}),
});

export const taskVersionRequestSchema = z.object({
  version: z.number().int().positive(),
});

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
export type UpdateTaskStatusRequest = z.infer<
  typeof updateTaskStatusRequestSchema
>;
export type TaskVersionRequest = z.infer<typeof taskVersionRequestSchema>;

export const createAreaRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .refine((name) => !name.includes(","), "Area names cannot contain commas"),
  color: areaColorSchema,
});

export const updateAreaRequestSchema = createAreaRequestSchema;

export const reorderAreasRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export const updateOwnerSettingsRequestSchema = z.object({
  displayLanguage: displayLanguageSchema,
  timeZone: ownerTimeZoneSchema,
  weekStartsOn: z.number().int().min(0).max(6),
  trashRetentionDays: z.number().int().positive(),
  version: z.number().int().positive(),
});

export const renameTagRequestSchema = z.object({
  name: tagNameSchema.toLowerCase(),
});

export const taskMovePositionSchema = z.enum([
  "before",
  "after",
  "as-last-child",
]);

export const taskMoveAnchorPositionSchema = z.enum([
  "before",
  "after",
  "append",
]);

export const moveTaskRequestSchema = z.object({
  taskId: z.string().min(1),
  taskVersion: z.number().int().positive(),
  targetTaskId: z.string().min(1),
  targetTaskVersion: z.number().int().positive(),
  position: taskMovePositionSchema,
  anchorTaskId: z.string().min(1).optional(),
  anchorTaskVersion: z.number().int().positive().optional(),
  anchorPosition: taskMoveAnchorPositionSchema.optional(),
});

export const reorderTodayRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export type CreateAreaRequest = z.infer<typeof createAreaRequestSchema>;
export type UpdateAreaRequest = z.infer<typeof updateAreaRequestSchema>;
export type ReorderAreasRequest = z.infer<typeof reorderAreasRequestSchema>;
export type UpdateOwnerSettingsRequest = z.infer<
  typeof updateOwnerSettingsRequestSchema
>;
export type RenameTagRequest = z.infer<typeof renameTagRequestSchema>;
export type TaskMovePosition = z.infer<typeof taskMovePositionSchema>;
export type TaskMoveAnchorPosition = z.infer<
  typeof taskMoveAnchorPositionSchema
>;
export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>;
export type ReorderTodayRequest = z.infer<typeof reorderTodayRequestSchema>;

function isDueAfterStart(start: string, due: string) {
  if (dateOnlyPattern.test(start) || dateOnlyPattern.test(due)) {
    return due.slice(0, 10) >= start.slice(0, 10);
  }
  return parseISO(due).getTime() >= parseISO(start).getTime();
}

function parseSearchDateValue(value: string) {
  return dateOnlyPattern.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : parseISO(value).getTime();
}
