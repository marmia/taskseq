import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ImportExecutionError,
  runWranglerImport,
} from "../../database-maintenance/import.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import {
  cleanupImportCase,
  runImportForTarget,
} from "../../database-maintenance-test/import-test-support.mjs";

const reportDirectory = resolve(import.meta.dirname, "../../.reports");

maintenanceCase(
  {
    id: "IMPORT-LOAD-001",
    operation: "import",
    profile: "load",
    title:
      "imports 3000 related Tasks into local-test and rolls back a late failure",
  },
  async (_test, context) => {
    const successTarget = createLocalTestTarget();
    const failureTarget = createLocalTestTarget();
    context.addCleanup(async () => {
      await cleanupImportCase(failureTarget);
      await cleanupImportCase(successTarget);
    });
    await successTarget.migrateToRepositorySchema();
    await failureTarget.migrateToRepositorySchema();

    const result = await runImportForTarget(
      successTarget,
      "local-test",
      loadDocument(),
    );
    assertLoadSuccess(successTarget, result);
    await assertLateRollback(failureTarget, "local-test");
    writeMetrics("local", result);
  },
);

function loadDocument() {
  return {
    areas: [{ name: "Load Area", color: "orange" }],
    tags: ["load", "shared"],
    tasks: Array.from({ length: 1000 }, (_, index) => ({
      title: `Load root ${String(index).padStart(4, "0")}`,
      area: "Load Area",
      tags: ["load", "shared"],
      children: [
        {
          title: `Load child ${String(index).padStart(4, "0")}-a`,
          tags: ["shared"],
        },
        {
          title: `Load child ${String(index).padStart(4, "0")}-b`,
          tags: ["shared"],
        },
      ],
    })),
  };
}

function assertLoadSuccess(target, result) {
  assert.equal(result.status, "applied");
  assert.equal(result.metrics.taskCount, 3000);
  assert.equal(result.metrics.tagRelationCount, 4000);
  assert.equal(result.metrics.executionRoute, "wrangler d1 execute --file");
  assert.ok(result.metrics.inputBytes > 100_000);
  assert.ok(result.metrics.maximumStatementBytes > 0);
  assert.ok(result.metrics.maximumStatementBytes <= 100_000);
  assert.ok(result.metrics.statementCount < 100);
  assert.ok(result.metrics.sqlBytes > result.metrics.inputBytes);
  assert.ok(result.durationMs >= 0);
  assert.equal(
    target.query("SELECT COUNT(*) AS count FROM tasks")[0].count,
    3000,
  );
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM tasks WHERE parent_task_id IS NOT NULL",
    )[0].count,
    2000,
  );
  assert.equal(
    target.query("SELECT COUNT(*) AS count FROM task_tags")[0].count,
    4000,
  );
  assert.deepEqual(
    target.query(
      "SELECT name, color, position FROM areas WHERE name = 'Load Area'",
    ),
    [{ color: "orange", name: "Load Area", position: 1 }],
  );
}

async function assertLateRollback(target, environment) {
  await assert.rejects(
    () =>
      runImportForTarget(target, environment, loadDocument(), {
        runApply(options) {
          appendFileSync(
            options.sqlPath,
            "INSERT INTO taskseq_import_missing_table VALUES (1);\n",
          );
          return runWranglerImport(options);
        },
      }),
    (error) => {
      assert.equal(error instanceof ImportExecutionError, true);
      assert.equal(error.resultUnknown, false);
      return true;
    },
  );
  assert.equal(target.query("SELECT COUNT(*) AS count FROM tasks")[0].count, 0);
  assert.equal(
    target.query("SELECT COUNT(*) AS count FROM task_tags")[0].count,
    0,
  );
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM areas WHERE name = 'Load Area'",
    )[0].count,
    0,
  );
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM tags WHERE name IN ('load', 'shared')",
    )[0].count,
    0,
  );
}

function writeMetrics(target, result) {
  mkdirSync(reportDirectory, { mode: 0o700, recursive: true });
  writeFileSync(
    resolve(reportDirectory, `import-load-${target}.json`),
    `${JSON.stringify(
      {
        durationMs: result.durationMs,
        metrics: result.metrics,
        target,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}
