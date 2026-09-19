import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";

import { runExport } from "../../database-maintenance/export.mjs";
import { runWranglerImport } from "../../database-maintenance/import.mjs";
import { UpdateExecutionError } from "../../database-maintenance/update.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
import { createRemoteTestTarget } from "../../database-maintenance-test/remote-target.mjs";
import {
  assertSuccessfulUpdate,
  cleanupUpdateCase,
  prepareUpdateCase,
  readUpdatedState,
  runUpdateForTarget,
} from "../../database-maintenance-test/update-test-support.mjs";

maintenanceCase(
  {
    id: "UPDATE-REMOTE-001",
    operation: "update",
    profile: "remote",
    title:
      "updates the common IDs in remote-test with final readback and cleanup",
  },
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => cleanupUpdateCase(target));
    await prepareUpdateCase(target);

    const result = await runUpdateForTarget(target, "remote-test");
    assertSuccessfulUpdate(target, result);
  },
);

maintenanceCase(
  {
    id: "UPDATE-REMOTE-003",
    operation: "update",
    profile: "remote",
    title: "updates matching IDs with exported JSON in both target directions",
  },
  async (_test, context) => {
    const remoteTarget = createRemoteTestTarget();
    const localTarget = createLocalTestTarget();
    context.addCleanup(async () => {
      try {
        await cleanupUpdateCase(remoteTarget);
      } finally {
        await cleanupUpdateCase(localTarget);
      }
    });
    await prepareUpdateCase(remoteTarget);
    await prepareUpdateCase(localTarget);

    const remoteDocument = exportDocument(remoteTarget, "remote-test");
    const remoteRoot = remoteDocument.tasks.find(
      ({ id }) => id === "update-root",
    );
    remoteRoot.description = "remote export to local";
    const toLocal = {
      tasks: [
        remoteRoot,
        { id: "cross-target-missing", description: "must skip" },
      ],
    };
    const localResult = await runUpdateForTarget(
      localTarget,
      "local-test",
      toLocal,
    );
    assert.equal(localResult.skipped[0].id, "cross-target-missing");
    assert.equal(
      readUpdatedState(localTarget).tasks.find(({ id }) => id === "update-root")
        .description,
      "remote export to local",
    );

    const localDocument = exportDocument(localTarget, "local-test");
    const localRoot = localDocument.tasks.find(
      ({ id }) => id === "update-root",
    );
    localRoot.description = "local export to remote";
    await runUpdateForTarget(remoteTarget, "remote-test", {
      tasks: [localRoot],
    });
    assert.equal(
      readUpdatedState(remoteTarget).tasks.find(
        ({ id }) => id === "update-root",
      ).description,
      "local export to remote",
    );
  },
);

function exportDocument(target, environment) {
  const result = runExport({
    appDirectory: target.appDirectory,
    configPath: target.configPath,
    environment,
    migrationDirectory: target.migrationDirectory,
    projectRoot: target.projectRoot,
    scriptDirectory: target.scriptDirectory,
  });
  return JSON.parse(readFileSync(result.path, "utf8"));
}

maintenanceCase(
  {
    id: "UPDATE-REMOTE-002",
    operation: "update",
    profile: "remote",
    title: "rolls back the complete remote update after a late file failure",
  },
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => cleanupUpdateCase(target));
    await prepareUpdateCase(target);
    const before = readUpdatedState(target);

    await assert.rejects(
      () =>
        runUpdateForTarget(target, "remote-test", undefined, {
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
    assert.deepEqual(readUpdatedState(target), before);
  },
);
