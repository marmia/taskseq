import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runImport } from "../database-maintenance/import.mjs";

const fixturePath = resolve(
  import.meta.dirname,
  "../database-maintenance-tests/fixtures/import-seed.sql",
);
const documentedExamplePath = resolve(
  import.meta.dirname,
  "../database-maintenance/examples/task-import.json",
);

export function importDocument() {
  const documentedExample = JSON.parse(
    readFileSync(documentedExamplePath, "utf8"),
  );
  return {
    areas: [
      { name: " New Area ", color: "purple" },
      ...documentedExample.areas,
    ],
    tags: [" Standalone ", "standalone", ...documentedExample.tags],
    tasks: [
      ...documentedExample.tasks,
      {
        title: "Quoted ' Task;\nUnicode 雪",
        description: "Description \u0000 value",
        parentId: "import-existing-parent",
        area: " Work ",
        tags: [" Existing ", "NEW", "new"],
        children: [
          {
            title: "Nested Task",
            start: "2026-09-09T01:02:03+09:00",
            due: "2026-09-10T03:04:05Z",
          },
        ],
      },
      {
        title: "Recurring Task",
        area: "New Area",
        start: "2026-09-09",
        due: "2026-09-09",
        recurrenceRule: "wed, mon",
        tags: ["standalone"],
      },
      { title: "Inbox Task", workNotes: "" },
    ],
  };
}

export function areaTagOnlyDocument() {
  return {
    areas: [{ name: "Definitions only", color: "yellow" }],
    tags: [" Definition ", "definition"],
    tasks: [],
  };
}

export async function prepareImportCase(target) {
  if (typeof target.resetToLatestSchema === "function") {
    await target.resetToLatestSchema();
  } else {
    await target.migrateToRepositorySchema();
  }
  target.executeFile(fixturePath);
  assert.equal(target.query("SELECT COUNT(*) AS count FROM tasks")[0].count, 1);
}

export async function runImportForTarget(
  target,
  environment,
  document = importDocument(),
  overrides = {},
) {
  const inputPath = resolve(target.root, `import-${crypto.randomUUID()}.json`);
  writeFileSync(inputPath, `${JSON.stringify(document, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    return await runImport({
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

export function readImportedState(target) {
  return {
    areas: target.query(
      "SELECT name, color, position, is_system_managed, trashed_at FROM areas ORDER BY position, id",
    ),
    tags: target.query("SELECT name FROM tags ORDER BY name"),
    taskTags: target.query(
      "SELECT tasks.title, tags.name FROM task_tags INNER JOIN tasks ON tasks.id = task_tags.task_id INNER JOIN tags ON tags.id = task_tags.tag_id ORDER BY tasks.title, tags.name",
    ),
    tasks: target.query(
      "SELECT title, description, work_notes, status, areas.name AS area, parent_task_id, start, due, completed_at, tasks.trashed_at, recurrence_rule, version, generated_from_task_id, trash_operation_id FROM tasks INNER JOIN areas ON areas.id = tasks.area_id ORDER BY title, tasks.id",
    ),
  };
}

export function assertSuccessfulImport(target, result, runCount = 1) {
  assert.equal(result.status, "applied");
  assert.equal(existsSync(result.backupPath), true);
  assert.equal(result.metrics.taskCount, 8);
  const state = readImportedState(target);
  assert.equal(state.areas.filter(({ name }) => name === "New Area").length, 1);
  assert.deepEqual(
    state.areas.find(({ name }) => name === "New Area"),
    {
      color: "purple",
      is_system_managed: 0,
      name: "New Area",
      position: 2,
      trashed_at: null,
    },
  );
  assert.deepEqual(state.tags, [
    { name: "existing" },
    { name: "new" },
    { name: "preset" },
    { name: "review" },
    { name: "standalone" },
  ]);
  assert.equal(state.tasks.length, 1 + 8 * runCount);
  assert.equal(
    state.tasks.filter(({ title }) => title === "Quoted ' Task;\nUnicode 雪")
      .length,
    runCount,
  );
  assert.equal(
    state.tasks.filter(({ title }) => title === "Nested Task").length,
    runCount,
  );
  assert.equal(
    state.tasks.filter(({ title }) => title === "Preset Aを評価する").length,
    runCount,
  );
  const recurring = state.tasks.find(({ title }) => title === "Recurring Task");
  assert.equal(recurring.recurrence_rule, "mon, wed");
  assert.equal(recurring.status, "OPEN");
  assert.equal(recurring.version, 1);
  assert.equal(recurring.completed_at, null);
  assert.equal(recurring.trashed_at, null);
  assert.equal(recurring.generated_from_task_id, null);
  assert.equal(recurring.trash_operation_id, null);
  assert.equal(
    state.taskTags.filter(
      ({ title, name }) =>
        title === "Quoted ' Task;\nUnicode 雪" && name === "new",
    ).length,
    runCount,
  );
  return state;
}

export function assertAreaTagOnlyImport(target, result) {
  assert.equal(result.status, "applied");
  assert.equal(result.metrics.areaCount, 1);
  assert.equal(result.metrics.tagCount, 1);
  assert.equal(result.metrics.taskCount, 0);
  assert.deepEqual(
    target.query(
      "SELECT name, color FROM areas WHERE name = 'Definitions only'",
    ),
    [{ color: "yellow", name: "Definitions only" }],
  );
  assert.deepEqual(
    target.query("SELECT name FROM tags WHERE name = 'definition'"),
    [{ name: "definition" }],
  );
  assert.equal(target.query("SELECT COUNT(*) AS count FROM tasks")[0].count, 1);
}

export async function cleanupImportCase(target, paths = []) {
  for (const path of paths) {
    if (path && existsSync(path)) unlinkSync(path);
  }
  try {
    if (typeof target.resetToLatestSchema === "function") {
      await target.resetToLatestSchema();
    }
  } finally {
    target.cleanup();
  }
}
