import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

import { runExport } from "../database-maintenance/export.mjs";

const fixturePath = resolve(
  import.meta.dirname,
  "../database-maintenance-tests/fixtures/export-seed.sql",
);

export const expectedExportDocument = Object.freeze({
  tasks: Object.freeze([
    Object.freeze({
      id: "export-child",
      title: "Completed child",
      description: "",
      workNotes: "line 1\nline 2",
      area: "Export Area",
      parentId: "export-parent",
      start: "2026-09-09T01:02:03+09:00",
      due: "2026-09-10T03:04:05Z",
      recurrenceRule: null,
      tags: Object.freeze(["alpha", "日本語"]),
    }),
    Object.freeze({
      id: "export-empty",
      title: "Empty fields",
      description: "",
      workNotes: "",
      area: "Inbox",
      parentId: null,
      start: null,
      due: null,
      recurrenceRule: null,
      tags: Object.freeze([]),
    }),
    Object.freeze({
      id: "export-parent",
      title: "親Task",
      description: "引用符'と;セミコロン\nUnicode 🧪",
      workNotes: "",
      area: "Export Area",
      parentId: null,
      start: "2026-09-09",
      due: null,
      recurrenceRule: null,
      tags: Object.freeze(["alpha"]),
    }),
    Object.freeze({
      id: "export-recurring",
      title: "Recurring",
      description: "",
      workNotes: "",
      area: "Export Area",
      parentId: null,
      start: "2026-09-09",
      due: "2026-09-09",
      recurrenceRule: "day",
      tags: Object.freeze([]),
    }),
  ]),
});

export async function prepareExportCase(target) {
  if (typeof target.resetToLatestSchema === "function") {
    await target.resetToLatestSchema();
  } else {
    await target.migrateToRepositorySchema();
  }
  target.executeFile(fixturePath);
  assert.equal(target.query("SELECT COUNT(*) AS count FROM tasks")[0].count, 5);
}

export function runExportForTarget(target, environment) {
  return runExport({
    appDirectory: target.appDirectory,
    configPath: target.configPath,
    environment,
    projectRoot: target.projectRoot,
    scriptDirectory: target.scriptDirectory,
  });
}

export function readExportDataState(target) {
  return {
    taskTags: target.query(
      "SELECT task_id, tag_id FROM task_tags ORDER BY task_id, tag_id",
    ),
    tasks: target.query(
      "SELECT id, title, description, work_notes, status, area_id, parent_task_id, start, due, completed_at, trashed_at, created_at, updated_at, version, recurrence_rule, generated_from_task_id, trash_operation_id FROM tasks ORDER BY id",
    ),
  };
}

export async function cleanupExportCase(target, paths = []) {
  for (const path of paths) {
    if (path && existsSync(path)) {
      unlinkSync(path);
    }
  }
  try {
    if (typeof target.resetToLatestSchema === "function") {
      await target.resetToLatestSchema();
    }
  } finally {
    target.cleanup();
  }
}
