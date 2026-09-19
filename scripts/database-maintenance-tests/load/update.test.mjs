import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ImportExecutionError,
  runWranglerImport,
} from "../../database-maintenance/import.mjs";
import { UpdateExecutionError } from "../../database-maintenance/update.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import {
  cleanupImportCase,
  runImportForTarget,
} from "../../database-maintenance-test/import-test-support.mjs";
import { runUpdateForTarget } from "../../database-maintenance-test/update-test-support.mjs";

const reportDirectory = resolve(import.meta.dirname, "../../.reports");

maintenanceCase(
  {
    id: "UPDATE-LOAD-001",
    operation: "update",
    profile: "load",
    title:
      "updates 3000 related Tasks in local-test and rolls back a late failure",
  },
  async (_test, context) => {
    const successTarget = createLocalTestTarget();
    const failureTarget = createLocalTestTarget();
    context.addCleanup(async () => {
      await cleanupImportCase(failureTarget);
      await cleanupImportCase(successTarget);
    });
    await prepareLoadTarget(successTarget);
    await prepareLoadTarget(failureTarget);

    const document = loadUpdateDocument();
    const result = await runUpdateForTarget(
      successTarget,
      "local-test",
      document,
    );
    assertLoadSuccess(successTarget, result);
    await assertLateRollback(failureTarget, document);
    writeMetrics(result);
  },
);

async function prepareLoadTarget(target) {
  await target.migrateToRepositorySchema();
  let id = 0;
  const result = await runImportForTarget(
    target,
    "local-test",
    loadImportDocument(),
    { createId: () => `update-load-${String(++id).padStart(4, "0")}` },
  );
  if (result.status !== "applied") {
    throw new ImportExecutionError("load fixture import failed", {
      backupPath: result.backupPath,
      resultUnknown: false,
    });
  }
  assert.equal(
    target.query("SELECT COUNT(*) AS count FROM tasks")[0].count,
    3000,
  );
}

function loadImportDocument() {
  return {
    areas: [{ name: "Load Source", color: "orange" }],
    tags: ["load-source", "shared"],
    tasks: Array.from({ length: 1000 }, (_, index) => ({
      title: `Load root ${String(index).padStart(4, "0")}`,
      area: "Load Source",
      tags: ["load-source", "shared"],
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

function loadUpdateDocument() {
  return {
    tasks: Array.from({ length: 3000 }, (_, index) => ({
      id: `update-load-${String(index + 1).padStart(4, "0")}`,
      description: `Updated ${index + 1}`,
      tags: ["load-updated", "shared"],
      ...(index % 3 === 0 ? { area: "Load Destination" } : {}),
    })),
  };
}

function assertLoadSuccess(target, result) {
  assert.equal(result.status, "applied");
  assert.equal(result.metrics.taskCount, 3000);
  assert.equal(result.metrics.tagRelationCount, 6000);
  assert.equal(result.metrics.executionRoute, "wrangler d1 execute --file");
  assert.ok(result.metrics.inputBytes > 100_000);
  assert.ok(result.metrics.maximumStatementBytes > 0);
  assert.ok(result.metrics.maximumStatementBytes <= 100_000);
  assert.ok(result.metrics.statementCount > 10_000);
  assert.ok(result.metrics.sqlBytes > result.metrics.inputBytes);
  assert.ok(result.durationMs >= 0);
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM tasks INNER JOIN areas ON areas.id = tasks.area_id WHERE areas.name = 'Load Destination' AND tasks.description LIKE 'Updated %'",
    )[0].count,
    3000,
  );
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM task_tags INNER JOIN tags ON tags.id = task_tags.tag_id WHERE tags.name IN ('load-updated', 'shared')",
    )[0].count,
    6000,
  );
}

async function assertLateRollback(target, document) {
  await assert.rejects(
    () =>
      runUpdateForTarget(target, "local-test", document, {
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
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM tasks WHERE description LIKE 'Updated %'",
    )[0].count,
    0,
  );
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM areas WHERE name = 'Load Destination'",
    )[0].count,
    0,
  );
  assert.equal(
    target.query(
      "SELECT COUNT(*) AS count FROM tags WHERE name = 'load-updated'",
    )[0].count,
    0,
  );
  assert.equal(
    target.query("SELECT COUNT(*) AS count FROM task_tags")[0].count,
    4000,
  );
}

function writeMetrics(result) {
  mkdirSync(reportDirectory, { mode: 0o700, recursive: true });
  writeFileSync(
    resolve(reportDirectory, "update-load-local.json"),
    `${JSON.stringify(
      {
        durationMs: result.durationMs,
        metrics: result.metrics,
        target: "local",
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}
