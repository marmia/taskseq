import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runUpdate } from "../database-maintenance/update.mjs";

const fixturePath = resolve(
  import.meta.dirname,
  "../database-maintenance-tests/fixtures/update-seed.sql",
);

export function updateDocument() {
  return {
    tasks: [
      {
        id: "update-root",
        title: "Quoted ' Root;\nUnicode 雪",
        description: "",
        workNotes: "更新したメモ\nsecond line",
        area: " New Area ",
        start: "2026-09-11T09:00:00+09:00",
        due: "2026-09-12T00:00:00Z",
        tags: [" New ", "new"],
      },
      { id: "update-child", tags: [] },
      {
        id: "update-completed-child",
        parentId: "update-completed-parent",
        description: "completed preserved",
      },
      {
        id: "update-recurring",
        start: "2026-09-14",
        due: "2026-09-14",
        recurrenceRule: "mon",
      },
      {
        id: "update-missing",
        title: "Missing input title",
        area: "Skipped Area",
        tags: ["skipped"],
      },
      { id: "update-trashed" },
    ],
  };
}

export async function prepareUpdateCase(target) {
  if (typeof target.resetToLatestSchema === "function") {
    await target.resetToLatestSchema();
  } else {
    await target.migrateToRepositorySchema();
  }
  target.executeFile(fixturePath);
  assert.equal(target.query("SELECT COUNT(*) AS count FROM tasks")[0].count, 6);
}

export async function runUpdateForTarget(
  target,
  environment,
  document = updateDocument(),
  overrides = {},
) {
  const inputPath = resolve(target.root, `update-${crypto.randomUUID()}.json`);
  writeFileSync(inputPath, `${JSON.stringify(document, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    return await runUpdate({
      appDirectory: target.appDirectory,
      confirm: async () => true,
      environment,
      inputPath,
      migrationDirectory: target.migrationDirectory,
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
      wranglerConfigPath: target.configPath,
      ...overrides,
    });
  } finally {
    unlinkSync(inputPath);
  }
}

export function readUpdatedState(target) {
  return {
    areas: target.query(
      "SELECT id, name, color, position, is_system_managed, trashed_at FROM areas ORDER BY position, id",
    ),
    orders: target.query(
      "SELECT group_key, task_id, position FROM task_manual_orders ORDER BY group_key, position",
    ),
    tags: target.query("SELECT name FROM tags ORDER BY name"),
    taskTags: target.query(
      "SELECT tasks.id, tags.name FROM task_tags INNER JOIN tasks ON tasks.id = task_tags.task_id INNER JOIN tags ON tags.id = task_tags.tag_id ORDER BY tasks.id, tags.name",
    ),
    tasks: target.query(
      "SELECT tasks.id, title, description, work_notes, status, areas.name AS area, parent_task_id, start, due, completed_at, tasks.trashed_at, created_at, updated_at, recurrence_rule, version, generated_from_task_id, trash_operation_id FROM tasks INNER JOIN areas ON areas.id = tasks.area_id ORDER BY tasks.id",
    ),
  };
}

export function assertSuccessfulUpdate(target, result) {
  assert.equal(result.status, "applied");
  assert.equal(existsSync(result.backupPath), true);
  assert.equal(result.metrics.taskCount, 4);
  assert.equal(result.metrics.areaCount, 1);
  assert.equal(result.metrics.tagCount, 1);
  assert.deepEqual(result.skipped, [
    {
      id: "update-missing",
      reason: "Taskが見つかりません",
      title: "Missing input title",
    },
    { id: "update-trashed", reason: "Trash内のTaskです", title: "(未指定)" },
  ]);
  const state = readUpdatedState(target);
  assert.equal(
    state.areas.some(({ name }) => name === "Skipped Area"),
    false,
  );
  assert.equal(
    state.tags.some(({ name }) => name === "skipped"),
    false,
  );
  assert.deepEqual(
    target.query("SELECT id, name FROM tags WHERE name = 'new'"),
    [{ id: 3, name: "new" }],
  );
  assert.deepEqual(state.tags, [
    { name: "keep" },
    { name: "new" },
    { name: "old" },
  ]);
  const root = state.tasks.find(({ id }) => id === "update-root");
  assert.equal(root.title, "Quoted ' Root;\nUnicode 雪");
  assert.equal(root.description, "");
  assert.equal(root.work_notes, "更新したメモ\nsecond line");
  assert.equal(root.area, "New Area");
  assert.equal(root.version, 4);
  assert.equal(root.created_at, "2026-09-01T00:00:00.000Z");
  assert.equal(root.status, "OPEN");
  const child = state.tasks.find(({ id }) => id === "update-child");
  assert.equal(child.area, "New Area");
  assert.equal(child.parent_task_id, "update-root");
  assert.equal(child.description, "child description");
  assert.equal(child.version, 5);
  const completed = state.tasks.find(
    ({ id }) => id === "update-completed-child",
  );
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.completed_at, "2026-09-05T00:00:01.000Z");
  assert.equal(completed.description, "completed preserved");
  assert.equal(completed.version, 7);
  const trashed = state.tasks.find(({ id }) => id === "update-trashed");
  assert.equal(trashed.version, 7);
  assert.equal(trashed.trashed_at, "2026-09-06T00:00:00.000Z");
  assert.deepEqual(
    state.taskTags.filter(({ id }) => id === "update-root"),
    [{ id: "update-root", name: "new" }],
  );
  assert.deepEqual(
    state.taskTags.filter(({ id }) => id === "update-child"),
    [],
  );
  const newAreaId = state.areas.find(({ name }) => name === "New Area").id;
  assert.equal(
    state.orders.some(
      ({ group_key, task_id }) =>
        group_key === `area:${newAreaId}` && task_id === "update-root",
    ),
    true,
  );
  assert.equal(
    state.orders.some(
      ({ group_key, task_id }) =>
        group_key === "parent:update-root" && task_id === "update-child",
    ),
    true,
  );
  return state;
}

export async function cleanupUpdateCase(target) {
  try {
    if (typeof target.resetToLatestSchema === "function") {
      await target.resetToLatestSchema();
    }
  } finally {
    target.cleanup();
  }
}
