import assert from "node:assert/strict";
import {
  appendFileSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { runBackup } from "../../database-maintenance/backup.mjs";
import {
  RestoreExecutionError,
  runRestore,
  runWranglerRestore,
} from "../../database-maintenance/restore.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import { createRemoteTestTarget } from "../../database-maintenance-test/remote-target.mjs";
import {
  assertResetBaseline,
  readDataState,
} from "../../database-maintenance-test/reset-test-support.mjs";

const fixturePath = resolve(
  import.meta.dirname,
  "../fixtures/restore-seed.sql",
);

maintenanceCase(
  caseMeta(
    "RESTORE-REMOTE-001",
    "restores an actual local-test backup into remote-test and repeats on the same target",
  ),
  async (_test, context) => {
    const local = createLocalTestTarget();
    const remote = createRemoteTestTarget();
    const remoteBackups = [];
    context.addCleanup(() => local.cleanup());
    context.addCleanup(() => cleanupRemote(remote, remoteBackups));

    await local.migrateToRepositorySchema();
    local.executeFile(fixturePath);
    const sourceBackup = runBackup(backupOptions(local, "local-test"));
    await remote.resetToLatestSchema();

    const options = restoreOptions(remote, "remote-test", sourceBackup.path);
    const first = await runRestore(options);
    remoteBackups.push(first.backupPath);
    assertRestoreFixture(remote);

    const second = await runRestore(options);
    remoteBackups.push(second.backupPath);
    assertRestoreFixture(remote);
  },
);

maintenanceCase(
  caseMeta(
    "RESTORE-REMOTE-002",
    "restores remote-test application backup SQL into local-test after removing runner lock metadata",
  ),
  async (_test, context) => {
    const local = createLocalTestTarget();
    const remote = createRemoteTestTarget();
    const remoteBackups = [];
    context.addCleanup(() => local.cleanup());
    context.addCleanup(() => cleanupRemote(remote, remoteBackups));

    await remote.resetToLatestSchema();
    remote.executeFile(fixturePath);
    const sourceBackup = runBackup(backupOptions(remote, "remote-test"));
    remoteBackups.push(sourceBackup.path);
    const portableBackupPath = join(local.root, "remote-test-portable.sql");
    removeRunnerLockFromBackup(sourceBackup.path, portableBackupPath);
    await local.migrateToRepositorySchema();

    const result = await runRestore(
      restoreOptions(local, "local-test", portableBackupPath),
    );
    assert.equal(result.status, "applied");
    assertRestoreFixture(local);
  },
);

maintenanceCase(
  caseMeta(
    "RESTORE-REMOTE-003",
    "rolls back the complete remote replacement when the actual restore file fails at the end",
  ),
  async (_test, context) => {
    const local = createLocalTestTarget();
    const remote = createRemoteTestTarget();
    const remoteBackups = [];
    context.addCleanup(() => local.cleanup());
    context.addCleanup(() => cleanupRemote(remote, remoteBackups));

    await local.migrateToRepositorySchema();
    local.executeFile(fixturePath);
    const sourceBackup = runBackup(backupOptions(local, "local-test"));
    await remote.resetToLatestSchema();
    const before = readDataState(remote);

    await assert.rejects(
      () =>
        runRestore({
          ...restoreOptions(remote, "remote-test", sourceBackup.path),
          runApply(options) {
            appendFileSync(
              options.sqlPath,
              "\nINSERT INTO restore_missing_table VALUES (1);\n",
            );
            return runWranglerRestore(options);
          },
        }),
      (error) => {
        if (error?.backupPath) {
          remoteBackups.push(error.backupPath);
        }
        assert.equal(error instanceof RestoreExecutionError, true);
        assert.equal(error.resultUnknown, false);
        return true;
      },
    );
    assert.deepEqual(readDataState(remote), before);
  },
);

function backupOptions(target, environment) {
  return {
    appDirectory: target.appDirectory,
    configPath: target.configPath,
    environment,
    projectRoot: target.projectRoot,
    scriptDirectory: target.scriptDirectory,
  };
}

function restoreOptions(target, environment, inputPath) {
  return {
    appDirectory: target.appDirectory,
    confirm: async () => true,
    environment,
    inputPath,
    migrationDirectory: target.migrationDirectory,
    projectRoot: target.projectRoot,
    scriptDirectory: target.scriptDirectory,
    wranglerConfigPath: target.configPath,
  };
}

function assertRestoreFixture(target) {
  assert.deepEqual(readDataState(target), {
    area_count: 3,
    manual_order_count: 2,
    owner_version: 9,
    tag_count: 2,
    task_count: 6,
    task_tag_count: 2,
    today_order_count: 2,
    view_count: 1,
  });
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
}

function removeRunnerLockFromBackup(sourcePath, destinationPath) {
  const source = readFileSync(sourcePath, "utf8");
  assert.match(source, /taskseq_maintenance_test_lock/u);
  const portable = source
    .split("\n")
    .filter((line) => !line.includes("taskseq_maintenance_test_lock"))
    .join("\n");
  assert.doesNotMatch(portable, /taskseq_maintenance_test_lock/u);
  assert.match(portable, /Restore ''quoted''; 雪/u);
  writeFileSync(destinationPath, portable, { flag: "wx", mode: 0o600 });
}

async function cleanupRemote(target, backupPaths) {
  try {
    await target.resetToLatestSchema();
    assertResetBaseline(target);
  } finally {
    for (const path of backupPaths) {
      rmSync(path, { force: true });
    }
    target.cleanup();
  }
}

function caseMeta(id, title) {
  return { id, operation: "restore", profile: "remote", title };
}
