import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import {
  cleanupExportCase,
  expectedExportDocument,
  prepareExportCase,
  readExportDataState,
  runExportForTarget,
} from "../../database-maintenance-test/export-test-support.mjs";

maintenanceCase(
  caseMeta(
    "EXPORT-LOCAL-001",
    "exports editable OPEN and COMPLETED Task data from local-test without changing the database",
  ),
  async (_test, context) => {
    const target = createLocalTestTarget();
    const outputPaths = [];
    context.addCleanup(() => cleanupExportCase(target, outputPaths));
    await prepareExportCase(target);
    const before = readExportDataState(target);

    const result = runExportForTarget(target, "local-test");
    outputPaths.push(result.path);

    assert.deepEqual(
      JSON.parse(readFileSync(result.path, "utf8")),
      expectedExportDocument,
    );
    assert.deepEqual(readExportDataState(target), before);
  },
);

maintenanceCase(
  caseMeta(
    "EXPORT-LOCAL-002",
    "exports an empty tasks array from an empty local-test database",
  ),
  async (_test, context) => {
    const target = createLocalTestTarget();
    const outputPaths = [];
    context.addCleanup(() => cleanupExportCase(target, outputPaths));
    await target.migrateToRepositorySchema();

    const result = runExportForTarget(target, "local-test");
    outputPaths.push(result.path);

    assert.deepEqual(JSON.parse(readFileSync(result.path, "utf8")), {
      tasks: [],
    });
    assert.equal(target.query("SELECT COUNT(*) AS count FROM tasks")[0].count, 0);
  },
);

function caseMeta(id, title) {
  return { id, operation: "export", profile: "local", title };
}
