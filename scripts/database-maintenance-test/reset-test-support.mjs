import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertResetState,
  resetVerificationQuery,
  runReset,
} from "../database-maintenance/reset.mjs";

const fixturePath = resolve(
  import.meta.dirname,
  "../database-maintenance-tests/fixtures/reset-seed.sql",
);

export async function prepareResetCase(target) {
  if (typeof target.resetToLatestSchema === "function") {
    await target.resetToLatestSchema();
  } else {
    await target.migrateToRepositorySchema();
  }
  const baseline = readStructuralState(target);
  target.executeFile(fixturePath);
  assert.deepEqual(readDataState(target), {
    area_count: 3,
    manual_order_count: 2,
    owner_version: 88,
    tag_count: 2,
    task_count: 5,
    task_tag_count: 2,
    today_order_count: 1,
    view_count: 1,
  });
  return baseline;
}

export async function cleanupResetCase(target) {
  try {
    if (typeof target.resetToLatestSchema === "function") {
      await target.resetToLatestSchema();
      assertResetBaseline(target);
    }
  } finally {
    target.cleanup();
  }
}

export async function runResetForTarget(target, environment) {
  return runReset({
    appDirectory: target.appDirectory,
    confirm: async () => true,
    environment,
    migrationDirectory: target.migrationDirectory,
    projectRoot: target.projectRoot,
    scriptDirectory: target.scriptDirectory,
    wranglerConfigPath: target.configPath,
  });
}

export function assertSuccessfulReset(target, baseline, result) {
  assert.equal(result.status, "applied");
  assert.equal(existsSync(result.backupPath), true);
  assertResetBaseline(target);
  assert.deepEqual(readStructuralState(target).schema, baseline.schema);
  assert.deepEqual(readStructuralState(target).migrations, baseline.migrations);
}

export function assertResetBaseline(target) {
  assertResetState(target.query(resetVerificationQuery)[0]);
  assert.equal(
    target.query("SELECT COUNT(*) AS count FROM d1_migrations")[0].count,
    target.repositoryMigrationCount,
  );
}

export function readDataState(target) {
  return target.query(`SELECT
    (SELECT COUNT(*) FROM areas) AS area_count,
    (SELECT COUNT(*) FROM tasks) AS task_count,
    (SELECT COUNT(*) FROM tags) AS tag_count,
    (SELECT COUNT(*) FROM task_tags) AS task_tag_count,
    (SELECT COUNT(*) FROM views) AS view_count,
    (SELECT COUNT(*) FROM task_manual_orders) AS manual_order_count,
    (SELECT COUNT(*) FROM today_task_orders) AS today_order_count,
    (SELECT version FROM owner_settings WHERE id = 1) AS owner_version`)[0];
}

export function readStructuralState(target) {
  return {
    migrations: target.query("SELECT name FROM d1_migrations ORDER BY id"),
    schema: target.query(
      "SELECT name, type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type, name",
    ),
  };
}

export function installResetFailureTrigger(target) {
  target.executeCommand(
    "CREATE TRIGGER reset_test_fail BEFORE INSERT ON areas WHEN NEW.name = 'Inbox' BEGIN SELECT RAISE(ABORT, 'reset test forced failure'); END;",
  );
}

export function removeResetFailureTrigger(target) {
  target.executeCommand("DROP TRIGGER IF EXISTS reset_test_fail");
}
