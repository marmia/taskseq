import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync } from "node:fs";

import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import {
  createProductionReadonlyTarget,
  productionMigrationSnapshotPath,
  validateProductionMigrationPrefix,
  writeProductionMigrationSnapshot,
} from "../../database-maintenance-test/remote-target.mjs";

maintenanceCase(
  {
    id: "IDENTITY-PRODUCTION-READONLY-001",
    operation: "identity",
    profile: "production-readonly",
    title:
      "verifies production identity, schema, migration history, and a minimal read without writing",
  },
  (_test, context) => {
    rmSync(productionMigrationSnapshotPath, { force: true });
    const target = createProductionReadonlyTarget();
    context.addCleanup(() => target.cleanup());

    assert.equal(target.identity.production.name, "taskseq");
    assert.equal(target.identity.remoteTest.name, "taskseq-test");
    assert.notEqual(
      target.identity.production.databaseId,
      target.identity.remoteTest.databaseId,
    );
    const tables = target.query(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('areas', 'tasks', 'owner_settings', 'views') ORDER BY name",
    );
    assert.deepEqual(
      tables.map(({ name }) => name),
      ["areas", "owner_settings", "tasks", "views"],
    );
    const repositoryMigrations = readdirSync(target.migrationDirectory)
      .filter((name) => /^\d+_.+\.sql$/u.test(name))
      .sort();
    const productionMigrations = validateProductionMigrationPrefix({
      productionNames: target
        .query("SELECT name FROM d1_migrations ORDER BY id")
        .map(({ name }) => name),
      repositoryNames: repositoryMigrations,
    });
    const result = target.query("SELECT COUNT(*) AS count FROM tasks");
    assert.equal(typeof result[0].count, "number");
    writeProductionMigrationSnapshot({ migrationNames: productionMigrations });
  },
);

maintenanceCase(
  {
    id: "EXPORT-PRODUCTION-READONLY-001",
    operation: "export",
    profile: "production-readonly",
    title:
      "exports production Task data read-only to an isolated file and validates the update JSON contract",
  },
  (_test, context) => {
    const target = createProductionReadonlyTarget();
    context.addCleanup(() => target.cleanup());
    const beforeCount = target.query(
      "SELECT COUNT(*) AS count FROM tasks WHERE trashed_at IS NULL",
    )[0].count;

    const result = target.exportTasks();
    const document = JSON.parse(readFileSync(result.path, "utf8"));

    assert.equal(document.tasks.length, beforeCount);
    assert.equal(
      document.tasks.every(
        (task) =>
          Object.keys(task).sort().join(",") ===
          "area,description,due,id,parentId,recurrenceRule,start,tags,title,workNotes",
      ),
      true,
    );
    assert.equal(
      target.query("SELECT COUNT(*) AS count FROM tasks WHERE trashed_at IS NULL")[0]
        .count,
      beforeCount,
    );
  },
);
