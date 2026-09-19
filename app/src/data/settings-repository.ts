import type {
  CreateAreaRequest,
  RenameTagRequest,
  ReorderAreasRequest,
  UpdateAreaRequest,
  UpdateOwnerSettingsRequest,
} from "../shared/api-schema";

export class AreaNotFoundError extends Error {}
export class AreaHasTasksError extends Error {}
export class AreaOrderError extends Error {}
export class TagNotFoundError extends Error {}
export class OwnerSettingsConflictError extends Error {}

export async function createArea(
  database: D1Database,
  input: CreateAreaRequest,
) {
  const row = await database
    .prepare(
      "SELECT COALESCE(MAX(position), 0) AS position FROM areas WHERE is_system_managed = 0",
    )
    .first<{ position: number }>();
  await database
    .prepare("INSERT INTO areas (name, color, position) VALUES (?, ?, ?)")
    .bind(input.name, input.color, (row?.position ?? 0) + 1)
    .run();
}

export async function updateArea(
  database: D1Database,
  id: number,
  input: UpdateAreaRequest,
) {
  const result = await database
    .prepare(
      `UPDATE areas
       SET name = ?, color = ?
       WHERE id = ? AND trashed_at IS NULL AND is_system_managed = 0`,
    )
    .bind(input.name, input.color, id)
    .run();
  if (!result.meta.changes) throw new AreaNotFoundError("Area was not found");
}

export async function reorderAreas(
  database: D1Database,
  input: ReorderAreasRequest,
) {
  const result = await database
    .prepare(
      `SELECT id, position FROM areas
       WHERE trashed_at IS NULL AND is_system_managed = 0
       ORDER BY position`,
    )
    .all<{ id: number; position: number }>();
  const activeIds = result.results.map((area) => area.id);
  if (
    input.ids.length !== activeIds.length ||
    new Set(input.ids).size !== input.ids.length ||
    input.ids.some((id) => !activeIds.includes(id))
  ) {
    throw new AreaOrderError("Area order must include every active Area once.");
  }
  const positions = result.results.map((area) => area.position);

  await database.batch(
    input.ids.map((id, index) =>
      database
        .prepare("UPDATE areas SET position = ? WHERE id = ?")
        .bind(-(index + 1), id),
    ),
  );
  await database.batch(
    input.ids.map((id, index) =>
      database
        .prepare("UPDATE areas SET position = ? WHERE id = ?")
        .bind(positions[index], id),
    ),
  );
}

export async function trashArea(database: D1Database, id: number) {
  const area = await database
    .prepare(
      `SELECT id FROM areas
       WHERE id = ? AND trashed_at IS NULL AND is_system_managed = 0`,
    )
    .bind(id)
    .first<{ id: number }>();
  if (!area) throw new AreaNotFoundError("Area was not found");

  const task = await database
    .prepare("SELECT id FROM tasks WHERE area_id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (task) {
    throw new AreaHasTasksError("An Area with Tasks cannot be moved to Trash.");
  }

  await database
    .prepare("UPDATE areas SET trashed_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run();
}

export async function restoreArea(database: D1Database, id: number) {
  const result = await database
    .prepare(
      `UPDATE areas
       SET trashed_at = NULL
       WHERE id = ? AND trashed_at IS NOT NULL AND is_system_managed = 0`,
    )
    .bind(id)
    .run();
  if (!result.meta.changes) throw new AreaNotFoundError("Area was not found");
}

export async function updateOwnerSettings(
  database: D1Database,
  input: UpdateOwnerSettingsRequest,
) {
  const result = await database
    .prepare(
      `UPDATE owner_settings
       SET display_language = ?, time_zone = ?, week_starts_on = ?, trash_retention_days = ?, version = version + 1
       WHERE id = 1 AND version = ?`,
    )
    .bind(
      input.displayLanguage,
      input.timeZone,
      input.weekStartsOn,
      input.trashRetentionDays,
      input.version,
    )
    .run();
  if (!result.meta.changes) {
    throw new OwnerSettingsConflictError("Owner settings changed elsewhere.");
  }
}

export async function renameTag(
  database: D1Database,
  id: number,
  input: RenameTagRequest,
) {
  const previous = await database
    .prepare("SELECT id, name FROM tags WHERE id = ?")
    .bind(id)
    .first<{ id: number; name: string }>();
  if (!previous) throw new TagNotFoundError("Tag was not found");
  if (previous.name === input.name) return;

  const next = await database
    .prepare("SELECT id FROM tags WHERE name = ?")
    .bind(input.name)
    .first<{ id: number }>();
  if (!next) {
    await database
      .prepare("UPDATE tags SET name = ? WHERE id = ?")
      .bind(input.name, previous.id)
      .run();
    return;
  }

  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO task_tags (task_id, tag_id)
         SELECT task_id, ? FROM task_tags WHERE tag_id = ?`,
      )
      .bind(next.id, previous.id),
    database.prepare("DELETE FROM tags WHERE id = ?").bind(previous.id),
  ]);
}

export async function deleteTag(database: D1Database, id: number) {
  const tag = await database
    .prepare("SELECT id FROM tags WHERE id = ?")
    .bind(id)
    .first<{ id: number }>();
  if (!tag) throw new TagNotFoundError("Tag was not found");

  await database.batch([
    database.prepare("DELETE FROM task_tags WHERE tag_id = ?").bind(tag.id),
    database.prepare("DELETE FROM tags WHERE id = ?").bind(tag.id),
  ]);
}
