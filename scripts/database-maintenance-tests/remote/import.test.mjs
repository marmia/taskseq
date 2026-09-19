import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";

import {
  ImportExecutionError,
  runWranglerImport,
} from "../../database-maintenance/import.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import {
  areaTagOnlyDocument,
  assertAreaTagOnlyImport,
  assertSuccessfulImport,
  cleanupImportCase,
  prepareImportCase,
  readImportedState,
  runImportForTarget,
} from "../../database-maintenance-test/import-test-support.mjs";
import { createRemoteTestTarget } from "../../database-maintenance-test/remote-target.mjs";

maintenanceCase(
  {
    id: "IMPORT-REMOTE-003",
    operation: "import",
    profile: "remote",
    title:
      "imports standalone Area and Tag definitions with an empty Task array",
  },
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);

    const result = await runImportForTarget(
      target,
      "remote-test",
      areaTagOnlyDocument(),
    );
    assertAreaTagOnlyImport(target, result);
  },
);

maintenanceCase(
  {
    id: "IMPORT-REMOTE-001",
    operation: "import",
    profile: "remote",
    title:
      "imports the same common JSON into remote-test with final readback and cleanup",
  },
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);

    const result = await runImportForTarget(target, "remote-test");
    assertSuccessfulImport(target, result);
  },
);

maintenanceCase(
  {
    id: "IMPORT-REMOTE-002",
    operation: "import",
    profile: "remote",
    title:
      "rolls back new Area, Tag, Task, and relations when the actual remote file fails at the end",
  },
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => cleanupImportCase(target));
    await prepareImportCase(target);
    const before = readImportedState(target);

    await assert.rejects(
      () =>
        runImportForTarget(target, "remote-test", undefined, {
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
