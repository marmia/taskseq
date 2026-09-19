import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { ResetExecutionError } from "../../database-maintenance/reset.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createRemoteTestTarget } from "../../database-maintenance-test/remote-target.mjs";
import {
  assertSuccessfulReset,
  cleanupResetCase,
  installResetFailureTrigger,
  prepareResetCase,
  readDataState,
  removeResetFailureTrigger,
  runResetForTarget,
} from "../../database-maintenance-test/reset-test-support.mjs";

maintenanceCase(
  caseMeta(
    "RESET-REMOTE-001",
    "resets seeded remote-test through remote scope, backs it up, reads it back, and remains idempotent",
  ),
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => cleanupResetCase(target));
    const baseline = await prepareResetCase(target);

    const first = await runResetForTarget(target, "remote-test");
    assertSuccessfulReset(target, baseline, first);
    assert.match(readFileSync(first.backupPath, "utf8"), /reset-test-open/u);
    const firstAreaSequence = target.query(
      "SELECT seq FROM sqlite_sequence WHERE name = 'areas'",
    )[0].seq;
    const second = await runResetForTarget(target, "remote-test");
    assertSuccessfulReset(target, baseline, second);
    assert.notEqual(second.backupPath, first.backupPath);
    assert.ok(
      target.query("SELECT seq FROM sqlite_sequence WHERE name = 'areas'")[0]
        .seq > firstAreaSequence,
    );
  },
);

maintenanceCase(
  caseMeta(
    "RESET-REMOTE-002",
    "rolls back the complete remote reset when the actual Wrangler file fails near the end",
  ),
  async (_test, context) => {
    const target = createRemoteTestTarget();
    context.addCleanup(() => cleanupResetCase(target));
    await prepareResetCase(target);
    installResetFailureTrigger(target);
    const before = readDataState(target);

    await assert.rejects(
      () => runResetForTarget(target, "remote-test"),
      (error) => {
        assert.equal(error instanceof ResetExecutionError, true);
        assert.equal(error.resultUnknown, false);
        assert.equal(existsSync(error.backupPath), true);
        return true;
      },
    );
    assert.deepEqual(readDataState(target), before);
    removeResetFailureTrigger(target);
  },
);

function caseMeta(id, title) {
  return { id, operation: "reset", profile: "remote", title };
}
