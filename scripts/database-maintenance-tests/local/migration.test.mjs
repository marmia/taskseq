import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runMigration } from "../../database-maintenance/migration.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
} from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import {
  readProductionMigrationSnapshot,
  validateProductionMigrationPrefix,
} from "../../database-maintenance-test/remote-target.mjs";

const caseMeta = createCaseMetadata("migration", "local");

maintenanceCase(
  caseMeta(
    "MIGRATION-LOCAL-001",
    "migrates an empty case-specific D1 to the repository schema and reads back a fixture",
  ),
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => target.cleanup());

    const result = await runMigration({
      appDirectory: target.appDirectory,
      confirm: async () => true,
      environment: "local-test",
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
      wranglerConfigPath: target.configPath,
    });
    assert.equal(result.status, "applied");

    target.executeCommand(
      "INSERT INTO tasks (id, title, status, area_id, created_at, updated_at) SELECT 'issue08-local-fixture', 'Issue 08 local fixture', 'OPEN', id, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z' FROM areas WHERE is_system_managed = 1",
    );
    const rows = target.query(
      "SELECT title, status FROM tasks WHERE id = 'issue08-local-fixture'",
    );
    assert.deepEqual(rows, [
      { status: "OPEN", title: "Issue 08 local fixture" },
    ]);
    assert.equal(
      target.query("SELECT COUNT(*) AS count FROM d1_migrations")[0].count,
      target.repositoryMigrationCount,
    );
    assert.match(
      readFileSync(result.backupPath, "utf8"),
      /PRAGMA defer_foreign_keys=TRUE/u,
    );
  },
);

maintenanceCase(
  caseMeta(
    "TRANSACTION-LOCAL-001",
    "rolls back a failing Wrangler SQL file in a case-specific local D1",
  ),
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => target.cleanup());
    await target.migrateToRepositorySchema();
    const fixturePath = join(target.root, "rollback-fixture.sql");
    writeFileSync(
      fixturePath,
      [
        "INSERT INTO tags (name) VALUES ('issue08-rollback');",
        "INSERT INTO tags (name) VALUES ('issue08-rollback');",
      ].join("\n"),
      { flag: "wx" },
    );

    assert.throws(() => target.executeFile(fixturePath));
    assert.equal(
      target.query(
        "SELECT COUNT(*) AS count FROM tags WHERE name = 'issue08-rollback'",
      )[0].count,
      0,
    );
  },
);

maintenanceCase(
  caseMeta(
    "MIGRATION-LOCAL-002",
    "migrates the captured production schema to a candidate schema in one isolated D1",
  ),
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => target.cleanup());

    const repositoryNames = target.repositoryMigrationNames;
    const productionNames = validateProductionMigrationPrefix({
      productionNames: readProductionMigrationSnapshot().migrationNames,
      repositoryNames,
    });
    const productionDirectory = join(target.root, "production-migrations");
    mkdirSync(productionDirectory);
    for (const name of productionNames) {
      cpSync(
        join(target.migrationDirectory, name),
        join(productionDirectory, name),
      );
    }
    const productionConfigPath = writeTargetConfig({
      migrationDirectory: productionDirectory,
      path: join(target.root, "production-wrangler.json"),
      target,
    });
    const productionResult = await runMigration({
      appDirectory: target.appDirectory,
      confirm: async () => true,
      environment: "local-test",
      migrationDirectory: productionDirectory,
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
      wranglerConfigPath: productionConfigPath,
    });
    assert.equal(productionResult.status, "applied");

    const candidateDirectory = join(target.root, "candidate-migrations");
    cpSync(target.migrationDirectory, candidateDirectory, { recursive: true });
    writeFileSync(
      join(candidateDirectory, nextSyntheticMigrationName(repositoryNames)),
      "ALTER TABLE tasks ADD COLUMN issue08_test_marker TEXT;\n",
      { flag: "wx" },
    );
    const candidateConfigPath = writeTargetConfig({
      migrationDirectory: candidateDirectory,
      path: join(target.root, "candidate-wrangler.json"),
      target,
    });

    const result = await runMigration({
      appDirectory: target.appDirectory,
      confirm: async () => true,
      environment: "local-test",
      migrationDirectory: candidateDirectory,
      projectRoot: target.projectRoot,
      scriptDirectory: target.scriptDirectory,
      wranglerConfigPath: candidateConfigPath,
    });
    assert.equal(result.status, "applied");
    assert.equal(
      target
        .query("PRAGMA table_info(tasks)")
        .some(({ name }) => name === "issue08_test_marker"),
      true,
    );
    assert.equal(
      target.query("SELECT COUNT(*) AS count FROM d1_migrations")[0].count,
      target.repositoryMigrationCount + 1,
    );
  },
);

function writeTargetConfig({ migrationDirectory, path, target }) {
  const config = JSON.parse(readFileSync(target.configPath, "utf8"));
  config.d1_databases[0].migrations_dir = migrationDirectory;
  writeFileSync(path, JSON.stringify(config), { flag: "wx", mode: 0o600 });
  return path;
}

function nextSyntheticMigrationName(repositoryNames) {
  const nextNumber =
    Math.max(...repositoryNames.map((name) => Number.parseInt(name, 10))) + 1;
  return `${String(nextNumber).padStart(4, "0")}_issue08_test_candidate.sql`;
}
