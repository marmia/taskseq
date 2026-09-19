import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

import { runBackup } from "../../database-maintenance/backup.mjs";
import {
  RestoreExecutionError,
  runRestore,
  runWranglerRestore,
} from "../../database-maintenance/restore.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import {
  readDataState,
  runResetForTarget,
} from "../../database-maintenance-test/reset-test-support.mjs";

const fixturePath = resolve(
  import.meta.dirname,
  "../fixtures/restore-seed.sql",
);

maintenanceCase(
  {
    id: "RESTORE-LOCAL-001",
    operation: "restore",
    profile: "local",
    title:
      "round-trips an actual local-test backup through same-target replacement and readback",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => target.cleanup());
    await target.migrateToRepositorySchema();
    target.executeFile(fixturePath);
    const expected = readDataState(target);
    assert.deepEqual(expected, {
      area_count: 3,
      manual_order_count: 2,
      owner_version: 9,
      tag_count: 2,
      task_count: 6,
      task_tag_count: 2,
      today_order_count: 2,
      view_count: 1,
    });
    const backup = runBackup({
      appDirectory: target.appDirectory,
      configPath: target.configPath,
      environment: "local-test",
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
    });

    await runResetForTarget(target, "local-test");
    assert.notDeepEqual(readDataState(target), expected);

    const options = {
      appDirectory: target.appDirectory,
      confirm: async () => true,
      environment: "local-test",
      inputPath: resolve(backup.path),
      migrationDirectory: target.migrationDirectory,
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
      wranglerConfigPath: target.configPath,
    };
    const first = await runRestore(options);
    assert.equal(first.status, "applied");
    assert.deepEqual(readDataState(target), expected);
    assert.equal(
      target.query("SELECT description FROM tasks WHERE id = 'restore-parent'")[0]
        .description,
      "first line\nsecond line; 'quoted'",
    );
    assert.equal(
      target.query("SELECT seq FROM sqlite_sequence WHERE name = 'areas'")[0]
        .seq,
      43,
    );

    const second = await runRestore(options);
    assert.equal(second.status, "applied");
    assert.deepEqual(readDataState(target), expected);
  },
);

maintenanceCase(
  {
    id: "RESTORE-LOCAL-002",
    operation: "restore",
    profile: "local",
    title:
      "rolls back the complete local replacement when the actual restore file fails at the end",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => target.cleanup());
    await target.migrateToRepositorySchema();
    target.executeFile(fixturePath);
    const backup = runBackup({
      appDirectory: target.appDirectory,
      configPath: target.configPath,
      environment: "local-test",
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
    });
    await runResetForTarget(target, "local-test");
    const before = readDataState(target);

    await assert.rejects(
      () =>
        runRestore({
          appDirectory: target.appDirectory,
          confirm: async () => true,
          environment: "local-test",
          inputPath: backup.path,
          migrationDirectory: target.migrationDirectory,
          projectRoot: target.projectRoot,
          runApply(options) {
            appendFileSync(
              options.sqlPath,
              "\nINSERT INTO restore_missing_table VALUES (1);\n",
            );
            return runWranglerRestore(options);
          },
          scriptDirectory: target.scriptDirectory,
          wranglerConfigPath: target.configPath,
        }),
      (error) => {
        assert.equal(error instanceof RestoreExecutionError, true);
        assert.equal(error.resultUnknown, false);
        return true;
      },
    );
    assert.deepEqual(readDataState(target), before);
  },
);
