import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { runExport } from "../../database-maintenance/export.mjs";
import { runWranglerImport } from "../../database-maintenance/import.mjs";
import { UpdateExecutionError } from "../../database-maintenance/update.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import {
  assertSuccessfulUpdate,
  cleanupUpdateCase,
  prepareUpdateCase,
  readUpdatedState,
  runUpdateForTarget,
} from "../../database-maintenance-test/update-test-support.mjs";

maintenanceCase(
  {
    id: "UPDATE-LOCAL-001",
    operation: "update",
    profile: "local",
    title:
      "partially updates local-test Tasks with skip, cascade, and final readback",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupUpdateCase(target));
    await prepareUpdateCase(target);

    const result = await runUpdateForTarget(target, "local-test");
    assertSuccessfulUpdate(target, result);
  },
);

maintenanceCase(
  {
    id: "UPDATE-LOCAL-005",
    operation: "update",
    profile: "local",
    title:
      "rejects duplicate IDs and invalid final relationships before backup or write",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupUpdateCase(target));
    await prepareUpdateCase(target);
    const before = readUpdatedState(target);
    const invalidDocuments = [
      { tasks: [{ id: "update-root" }, { id: "update-root" }] },
      { tasks: [{ id: "update-child", parentId: "missing-parent" }] },
      { tasks: [{ id: "update-child", area: "Different Area" }] },
      {
        tasks: [
          { id: "update-root", parentId: "update-child" },
          { id: "update-child", parentId: "update-root" },
        ],
      },
      {
        tasks: [{ id: "update-recurring", start: "2026-09-15", due: null }],
      },
    ];
    let backupCount = 0;
    for (const document of invalidDocuments) {
      await assert.rejects(() =>
        runUpdateForTarget(target, "local-test", document, {
          runBackup: () => {
            backupCount += 1;
            return { path: "/unexpected.sql" };
          },
        }),
      );
    }
    assert.equal(backupCount, 0);
    assert.deepEqual(readUpdatedState(target), before);
  },
);

maintenanceCase(
  {
    id: "UPDATE-LOCAL-004",
    operation: "update",
    profile: "local",
    title: "updates edited export JSON after a later screen-equivalent change",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupUpdateCase(target));
    await prepareUpdateCase(target);

    const exported = runExport({
      appDirectory: target.appDirectory,
      configPath: target.configPath,
      environment: "local-test",
      migrationDirectory: target.migrationDirectory,
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
    });
    const document = JSON.parse(readFileSync(exported.path, "utf8"));
    const root = document.tasks.find(({ id }) => id === "update-root");
    const partial = {
      tasks: [
        { id: root.id, title: "JSON wins", description: "export edited" },
      ],
    };
    target.executeCommand(
      "UPDATE tasks SET title = 'screen change', work_notes = 'screen note', version = version + 1 WHERE id = 'update-root'",
    );

    await runUpdateForTarget(target, "local-test", partial);
    const actual = readUpdatedState(target).tasks.find(
      ({ id }) => id === "update-root",
    );
    assert.equal(actual.title, "JSON wins");
    assert.equal(actual.description, "export edited");
    assert.equal(actual.work_notes, "screen note");
    assert.equal(actual.version, 5);
  },
);

maintenanceCase(
  {
    id: "UPDATE-LOCAL-003",
    operation: "update",
    profile: "local",
    title:
      "rejects the complete update when target state changes after validation",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupUpdateCase(target));
    await prepareUpdateCase(target);

    await assert.rejects(
      () =>
        runUpdateForTarget(target, "local-test", undefined, {
          runApply(options) {
            target.executeCommand(
              `INSERT INTO tasks (
                id, title, description, work_notes, status, area_id,
                parent_task_id, start, due, completed_at, trashed_at,
                created_at, updated_at, version, recurrence_rule,
                generated_from_task_id, trash_operation_id
              )
              SELECT
                'concurrent-child', 'Concurrent child', '', '', 'OPEN', area_id,
                'update-root', NULL, NULL, NULL, NULL,
                '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', 1,
                NULL, NULL, NULL
              FROM tasks WHERE id = 'update-root'`,
            );
            return runWranglerImport(options);
          },
        }),
      (error) => {
        assert.equal(error instanceof UpdateExecutionError, true);
        assert.equal(error.resultUnknown, false);
        return true;
      },
    );
    const state = readUpdatedState(target);
    assert.equal(
      state.tasks.some(({ id }) => id === "concurrent-child"),
      true,
    );
    assert.equal(
      state.tasks.find(({ id }) => id === "update-root").title,
      "Root before",
    );
    assert.equal(
      state.areas.some(({ name }) => name === "New Area"),
      false,
    );
    assert.equal(
      state.tags.some(({ name }) => name === "new"),
      false,
    );
  },
);

maintenanceCase(
  {
    id: "UPDATE-LOCAL-002",
    operation: "update",
    profile: "local",
    title:
      "rolls back Area, Tag, Task, relations, and orders after a late file failure",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupUpdateCase(target));
    await prepareUpdateCase(target);
    const before = readUpdatedState(target);

    await assert.rejects(
      () =>
        runUpdateForTarget(target, "local-test", undefined, {
          runApply(options) {
            appendFileSync(
              options.sqlPath,
              "INSERT INTO taskseq_update_missing_table VALUES (1);\n",
            );
            return runWranglerImport(options);
          },
        }),
      (error) => {
        assert.equal(error instanceof UpdateExecutionError, true);
        assert.equal(error.resultUnknown, false);
        return true;
      },
    );
    assert.deepEqual(readUpdatedState(target), before);
  },
);
