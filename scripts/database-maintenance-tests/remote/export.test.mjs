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
import { createRemoteTestTarget } from "../../database-maintenance-test/remote-target.mjs";

maintenanceCase(
  {
    id: "EXPORT-REMOTE-001",
    operation: "export",
    profile: "remote",
    title:
      "exports the same update JSON from remote-test and local-test without changing either database",
  },
  async (_test, context) => {
    const remote = createRemoteTestTarget();
    const local = createLocalTestTarget();
    const remotePaths = [];
    const localPaths = [];
    context.addCleanup(async () => {
      await cleanupExportCase(local, localPaths);
      await cleanupExportCase(remote, remotePaths);
    });
    await prepareExportCase(remote);
    await prepareExportCase(local);
    const remoteBefore = readExportDataState(remote);
    const localBefore = readExportDataState(local);

    const remoteResult = runExportForTarget(remote, "remote-test");
    const localResult = runExportForTarget(local, "local-test");
    remotePaths.push(remoteResult.path);
    localPaths.push(localResult.path);
    const remoteDocument = JSON.parse(readFileSync(remoteResult.path, "utf8"));
    const localDocument = JSON.parse(readFileSync(localResult.path, "utf8"));

    assert.deepEqual(remoteDocument, expectedExportDocument);
    assert.deepEqual(localDocument, expectedExportDocument);
    assert.deepEqual(remoteDocument, localDocument);
    assert.deepEqual(readExportDataState(remote), remoteBefore);
    assert.deepEqual(readExportDataState(local), localBefore);
  },
);
