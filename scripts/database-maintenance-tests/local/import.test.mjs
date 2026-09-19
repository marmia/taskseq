import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";

import {
  ImportExecutionError,
  runWranglerImport,
} from "../../database-maintenance/import.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import {
  areaTagOnlyDocument,
  assertAreaTagOnlyImport,
  assertSuccessfulImport,
  cleanupImportCase,
  prepareImportCase,
  readImportedState,
  runImportForTarget,
} from "../../database-maintenance-test/import-test-support.mjs";

maintenanceCase(
  {
    id: "IMPORT-LOCAL-005",
    operation: "import",
    profile: "local",
    title:
      "imports standalone Area and Tag definitions with an empty Task array",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);

    const result = await runImportForTarget(
      target,
      "local-test",
      areaTagOnlyDocument(),
    );
    assertAreaTagOnlyImport(target, result);
  },
);

maintenanceCase(
  {
    id: "IMPORT-LOCAL-001",
    operation: "import",
    profile: "local",
    title:
      "imports the common JSON into local-test with relationships and creates new Tasks again on rerun",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);

    const first = await runImportForTarget(target, "local-test");
    assertSuccessfulImport(target, first, 1);
    const firstIds = target
      .query(
        "SELECT id FROM tasks WHERE id <> 'import-existing-parent' ORDER BY id",
      )
      .map(({ id }) => id);

    const second = await runImportForTarget(target, "local-test");
    assertSuccessfulImport(target, second, 2);
    const secondIds = target
      .query(
        "SELECT id FROM tasks WHERE id <> 'import-existing-parent' ORDER BY id",
      )
      .map(({ id }) => id);
    assert.equal(new Set(secondIds).size, 16);
    assert.equal(
      firstIds.every((id) => secondIds.includes(id)),
      true,
    );
    assert.notEqual(second.backupPath, first.backupPath);
  },
);

maintenanceCase(
  {
    id: "IMPORT-LOCAL-004",
    operation: "import",
    profile: "local",
    title:
      "rolls back the complete import when an existing Tag disappears after validation",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);
    const before = readImportedState(target);

    await assert.rejects(
      () =>
        runImportForTarget(target, "local-test", undefined, {
          runApply(options) {
            target.executeCommand("DELETE FROM tags WHERE name = 'existing'");
            return runWranglerImport(options);
          },
        }),
      (error) => {
        assert.equal(error instanceof ImportExecutionError, true);
        assert.equal(error.resultUnknown, false);
        return true;
      },
    );
    assert.deepEqual(readImportedState(target), {
      ...before,
      tags: [],
    });
    assert.equal(
      target.query(
        "SELECT COUNT(*) AS count FROM areas WHERE name = 'New Area'",
      )[0].count,
      0,
    );
  },
);

maintenanceCase(
  {
    id: "IMPORT-LOCAL-002",
    operation: "import",
    profile: "local",
    title:
      "rolls back new Area, Tag, Task, and relations when the actual local file fails at the end",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);
    const before = readImportedState(target);

    await assert.rejects(
      () =>
        runImportForTarget(target, "local-test", undefined, {
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
        assert.equal(existsSync(error.backupPath), true);
        return true;
      },
    );
    assert.deepEqual(readImportedState(target), before);
  },
);

maintenanceCase(
  {
    id: "IMPORT-LOCAL-003",
    operation: "import",
    profile: "local",
    title:
      "rejects the complete import when an existing parent changes after validation",
  },
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);

    await assert.rejects(
      () =>
        runImportForTarget(target, "local-test", undefined, {
          runApply(options) {
            target.executeCommand(
              "UPDATE tasks SET status = 'COMPLETED', completed_at = '2026-09-09T00:00:00Z' WHERE id = 'import-existing-parent'",
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
    assert.equal(
      target.query("SELECT COUNT(*) AS count FROM tasks")[0].count,
      1,
    );
    assert.equal(
      target.query(
        "SELECT COUNT(*) AS count FROM areas WHERE name = 'New Area'",
      )[0].count,
      0,
    );
    assert.equal(
      target.query(
        "SELECT COUNT(*) AS count FROM tags WHERE name IN ('new', 'standalone')",
      )[0].count,
      0,
    );
  },
);
