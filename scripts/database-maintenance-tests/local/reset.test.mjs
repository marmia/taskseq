import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { ResetExecutionError } from "../../database-maintenance/reset.mjs";
import { maintenanceCase } from "../../database-maintenance-test/case-registry.mjs";
import { createLocalTestTarget } from "../../database-maintenance-test/d1-harness.mjs";
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
    "RESET-LOCAL-001",
    "resets a seeded case-specific local D1, backs it up, reads it back, and remains idempotent",
  ),
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupResetCase(target));
    const baseline = await prepareResetCase(target);

    const first = await runResetForTarget(target, "local-test");
    assertSuccessfulReset(target, baseline, first);
    assert.match(readFileSync(first.backupPath, "utf8"), /reset-test-open/u);
    const firstAreaSequence = target.query(
      "SELECT seq FROM sqlite_sequence WHERE name = 'areas'",
    )[0].seq;

    const second = await runResetForTarget(target, "local-test");
    assertSuccessfulReset(target, baseline, second);
    assert.notEqual(second.backupPath, first.backupPath);
    assert.equal(existsSync(second.backupPath), true);
    assert.ok(
      target.query("SELECT seq FROM sqlite_sequence WHERE name = 'areas'")[0]
        .seq > firstAreaSequence,
    );
  },
);

maintenanceCase(
  caseMeta(
    "RESET-LOCAL-002",
    "rolls back the complete local reset when the actual Wrangler file fails near the end",
  ),
  async (_test, context) => {
    const target = createLocalTestTarget();
    context.addCleanup(() => cleanupResetCase(target));
    const baseline = await prepareResetCase(target);
    installResetFailureTrigger(target);
    const before = readDataState(target);

    await assert.rejects(
      () => runResetForTarget(target, "local-test"),
      (error) => {
        assert.equal(error instanceof ResetExecutionError, true);
        assert.equal(error.resultUnknown, false);
        assert.equal(existsSync(error.backupPath), true);
        return true;
      },
    );
    assert.deepEqual(readDataState(target), before);
    removeResetFailureTrigger(target);
    const cleanupReset = await runResetForTarget(target, "local-test");
    assertSuccessfulReset(target, baseline, cleanupReset);
  },
);

function caseMeta(id, title) {
  return { id, operation: "reset", profile: "local", title };
}
