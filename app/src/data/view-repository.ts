import {
  type View,
  type ViewCreateRequest,
  type ViewUpdateRequest,
  viewResponseSchema,
} from "../shared/api-schema";

export class ViewNameConflictError extends Error {}
export class ViewNotFoundError extends Error {}
export class ViewVersionConflictError extends Error {}

type ViewRow = {
  id: string;
  name: string;
  all_tasks: number;
  conditions_json: string;
  sort_json: string;
  columns_json: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export async function readView(
  database: D1Database,
  id: string,
): Promise<View | null> {
  const row = await database
    .prepare(
      `SELECT id, name, all_tasks, conditions_json, sort_json, columns_json,
              version, created_at, updated_at
       FROM views
       WHERE id = ?`,
    )
    .bind(id)
    .first<ViewRow>();

  return row ? serializeView(row) : null;
}

export async function readViews(database: D1Database): Promise<View[]> {
  const result = await database
    .prepare(
      `SELECT id, name, all_tasks, conditions_json, sort_json, columns_json,
              version, created_at, updated_at
       FROM views
       ORDER BY name COLLATE NOCASE, id`,
    )
    .all<ViewRow>();

  return result.results.map(serializeView);
}

export async function createView(
  database: D1Database,
  input: ViewCreateRequest,
) {
  await assertNameAvailable(database, input.name);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await database
      .prepare(
        `INSERT INTO views
           (id, name, all_tasks, conditions_json, sort_json, columns_json,
            version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.allTasks ? 1 : 0,
        JSON.stringify(input.conditions),
        JSON.stringify(input.sort),
        JSON.stringify(input.columns),
        1,
        now,
        now,
      )
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ViewNameConflictError("A View with this name already exists.");
    }
    throw error;
  }
}

export async function updateView(
  database: D1Database,
  id: string,
  input: ViewUpdateRequest,
) {
  const existing = await database
    .prepare("SELECT id, version FROM views WHERE id = ?")
    .bind(id)
    .first<{ id: string; version: number }>();
  if (!existing) throw new ViewNotFoundError("View was not found");
  if (existing.version !== input.version) {
    throw new ViewVersionConflictError("View changed elsewhere");
  }

  await assertNameAvailable(database, input.name, id);
  try {
    const result = await database
      .prepare(
        `UPDATE views
         SET name = ?, all_tasks = ?, conditions_json = ?, sort_json = ?,
             columns_json = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .bind(
        input.name,
        input.allTasks ? 1 : 0,
        JSON.stringify(input.conditions),
        JSON.stringify(input.sort),
        JSON.stringify(input.columns),
        new Date().toISOString(),
        id,
        input.version,
      )
      .run();
    if (!result.meta.changes) {
      throw new ViewVersionConflictError("View changed elsewhere");
    }
  } catch (error) {
    if (error instanceof ViewVersionConflictError) throw error;
    if (isUniqueViolation(error)) {
      throw new ViewNameConflictError("A View with this name already exists.");
    }
    throw error;
  }
}

export async function deleteView(database: D1Database, id: string) {
  const result = await database
    .prepare("DELETE FROM views WHERE id = ?")
    .bind(id)
    .run();
  if (!result.meta.changes) throw new ViewNotFoundError("View was not found");
}

function serializeView(row: ViewRow): View {
  return viewResponseSchema.parse({
    id: row.id,
    name: row.name,
    allTasks: row.all_tasks === 1,
    conditions: JSON.parse(row.conditions_json),
    sort: JSON.parse(row.sort_json),
    columns: JSON.parse(row.columns_json),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function assertNameAvailable(
  database: D1Database,
  name: string,
  currentId?: string,
) {
  const existing = await database
    .prepare("SELECT id FROM views WHERE name = ? COLLATE NOCASE")
    .bind(name)
    .first<{ id: string }>();
  if (existing && existing.id !== currentId) {
    throw new ViewNameConflictError("A View with this name already exists.");
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Error && error.message.includes("UNIQUE");
}
