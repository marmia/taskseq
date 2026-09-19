import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runBackup } from "../../database-maintenance/backup.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createRemoteTestTarget } from "../../database-maintenance-test/remote-target.mjs";

maintenanceCase(
  caseMeta(
    "IDENTITY-REMOTE-001",
    "authenticates to the verified remote-test database and performs a minimal read",
  ),
  (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => target.cleanup());
    assert.equal(target.identity.remoteTest.name, "taskseq-test");
    assert.equal(target.identity.production.name, "taskseq");
    assert.notEqual(
      target.identity.remoteTest.databaseId,
      target.identity.production.databaseId,
    );
    const rows = target.query("SELECT COUNT(*) AS count FROM sqlite_schema");
    assert.equal(typeof rows[0].count, "number");
  },
);

maintenanceCase(
  caseMeta(
    "TRANSACTION-REMOTE-001",
    "rolls back a failing Wrangler SQL file in remote-test and restores the baseline",
  ),
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(async () => {
      try {
        await target.resetToLatestSchema();
      } finally {
        target.cleanup();
      }
    });
    await target.resetToLatestSchema();
    const fixturePath = join(target.root, "rollback-fixture.sql");
    writeFileSync(
      fixturePath,
      [
        "INSERT INTO tags (name) VALUES ('issue08-remote-rollback');",
        "INSERT INTO tags (name) VALUES ('issue08-remote-rollback');",
      ].join("\n"),
      { flag: "wx" },
    );

    assert.throws(() => target.executeFile(fixturePath));
    assert.equal(
      target.query(
        "SELECT COUNT(*) AS count FROM tags WHERE name = 'issue08-remote-rollback'",
      )[0].count,
      0,
    );
  },
);

maintenanceCase(
  caseMeta(
    "MIGRATION-REMOTE-001",
    "migrates a known empty remote-test database, reads back a fixture, backs it up, and restores the baseline",
  ),
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(async () => {
      try {
        await target.resetToLatestSchema();
        assert.equal(
          target.query("SELECT COUNT(*) AS count FROM tasks")[0].count,
          0,
        );
        assert.equal(
          target.query("SELECT COUNT(*) AS count FROM d1_migrations")[0].count,
          target.repositoryMigrationCount,
        );
      } finally {
        target.cleanup();
      }
    });

    target.clearApplicationSchema();
    const migration = await target.migrateToRepositorySchema({ backup: true });
    assert.equal(migration.status, "applied");
    target.executeCommand(
      "INSERT INTO tasks (id, title, status, area_id, created_at, updated_at) SELECT 'issue08-remote-fixture', 'Issue 08 remote fixture', 'OPEN', id, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z' FROM areas WHERE is_system_managed = 1",
    );
    assert.deepEqual(
      target.query(
        "SELECT title, status FROM tasks WHERE id = 'issue08-remote-fixture'",
      ),
      [{ status: "OPEN", title: "Issue 08 remote fixture" }],
    );
    const backup = runBackup({
      appDirectory: target.appDirectory,
      configPath: target.configPath,
      environment: "remote-test",
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
    });
    assert.match(readFileSync(backup.path, "utf8"), /issue08-remote-fixture/u);
  },
);

function caseMeta(id, title) {
  return {
    id,
    operation: id.split("-")[0].toLowerCase(),
    profile: "remote",
    title,
  };
}
