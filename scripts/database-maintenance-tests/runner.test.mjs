import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe } from "node:test";

import {
  createCaseMetadata,
  maintenanceCase,
  resolveManualReviewStatus,
  validateCaseDefinition,
} from "../database-maintenance-test/case-registry.mjs";
import {
  runMaintenanceTests,
  runProfile,
} from "../database-maintenance-test/runner.mjs";
import {
  parseRunnerArguments,
  reconcileCaseEvents,
} from "../database-maintenance-test/runner-core.mjs";

const caseMeta = createCaseMetadata("runner", "unit");

describe("database maintenance runner", () => {
  maintenanceCase(
    caseMeta(
      "RUNNER-UNIT-001",
      "uses unit by default and expands all in risk order",
    ),
    () => {
      assert.deepEqual(parseRunnerArguments([]), {
        help: false,
        manualReview: false,
        profiles: ["unit"],
        requestedProfile: "unit",
      });
      assert.deepEqual(parseRunnerArguments(["all"]), {
        help: false,
        manualReview: false,
        profiles: ["unit", "local", "remote"],
        requestedProfile: "all",
      });
      for (const profile of [
        "unit",
        "local",
        "remote",
        "load",
        "production-readonly",
      ]) {
        assert.deepEqual(parseRunnerArguments([profile]).profiles, [profile]);
      }
      assert.throws(() => parseRunnerArguments(["unknown"]), /profile/u);
      assert.throws(() => parseRunnerArguments(["unit", "local"]), /1つ/u);
      assert.deepEqual(parseRunnerArguments(["unit", "--manual-review"]), {
        help: false,
        manualReview: true,
        profiles: ["unit"],
        requestedProfile: "unit",
      });
      assert.throws(
        () => parseRunnerArguments(["all", "--manual-review"]),
        /unit/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "RUNNER-UNIT-002",
      "fails duplicate, undefined, unexecuted, skipped, and cleanup-failed cases",
    ),
    () => {
      const result = reconcileCaseEvents({
        events: [
          declared("RUNNER-UNIT-001"),
          completed("RUNNER-UNIT-001", "passed"),
          declared("RUNNER-UNIT-002"),
          declared("RUNNER-UNIT-002"),
          declared("RUNNER-UNIT-003", false),
          declared("RUNNER-UNIT-004"),
          declared("RUNNER-UNIT-005"),
          completed("RUNNER-UNIT-005", "skipped"),
          declared("RUNNER-UNIT-006"),
          completed("RUNNER-UNIT-006", "failed", {
            cleanup: {
              message: "cleanup failed",
              status: "failed",
            },
          }),
        ],
        processExitCode: 1,
        profile: "unit",
      });

      assert.equal(result.ok, false);
      assert.deepEqual(result.counts, {
        failed: 1,
        "manual-required": 0,
        passed: 1,
        skipped: 1,
        unexecuted: 3,
      });
      assert.deepEqual(result.registryErrors, [
        "duplicate ID: RUNNER-UNIT-002",
        "execution definition missing: RUNNER-UNIT-003",
        "unexecuted: RUNNER-UNIT-002",
        "unexecuted: RUNNER-UNIT-003",
        "unexecuted: RUNNER-UNIT-004",
        "skipped: RUNNER-UNIT-005",
        "cleanup failed: RUNNER-UNIT-006: cleanup failed",
        "test process exited with code 1",
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RUNNER-UNIT-003",
      "reports manual-required separately without treating it as skipped",
    ),
    () => {
      const result = reconcileCaseEvents({
        events: [
          declared("MIGRATION-UNIT-001"),
          completed("MIGRATION-UNIT-001", "passed"),
          declared("MIGRATION-UNIT-002", true, true),
          completed("MIGRATION-UNIT-002", "manual-required"),
        ],
        processExitCode: 0,
        profile: "unit",
      });

      assert.equal(result.ok, true);
      assert.equal(result.counts.passed, 1);
      assert.equal(result.counts["manual-required"], 1);
      assert.deepEqual(result.registryErrors, []);

      const reportDirectory = mkdtempSync(
        `${tmpdir()}/taskseq-manual-review-report-`,
      );
      let outputText = "";
      try {
        const exitCode = runMaintenanceTests(["unit", "--manual-review"], {
          errorOutput: { write() {} },
          output: {
            write(value) {
              outputText += value;
            },
          },
          reportDirectory,
          run: () => ({
            cases: [
              {
                cleanup: { status: "not-required" },
                durationMs: 0,
                id: "MIGRATION-UNIT-016",
                operation: "migration",
                reviewOutput: "actual safe preview",
                status: "manual-required",
                title: "manual review",
              },
            ],
            counts: {
              failed: 0,
              "manual-required": 1,
              passed: 0,
              skipped: 0,
              unexecuted: 0,
            },
            ok: true,
            profile: "unit",
            registryErrors: [],
          }),
        });
        assert.equal(exitCode, 0);
        assert.match(
          outputText,
          /\[manual-review MIGRATION-UNIT-016\]\nactual safe preview/u,
        );
      } finally {
        rmSync(reportDirectory, { force: true, recursive: true });
      }

      assert.equal(
        resolveManualReviewStatus({
          acceptedReviewRevision: null,
          reviewRevision: "migration-confirmation-v1",
        }),
        "manual-required",
      );
      assert.equal(
        resolveManualReviewStatus({
          acceptedReviewRevision: "migration-confirmation-v1",
          reviewRevision: "migration-confirmation-v1",
        }),
        "passed",
      );
      assert.equal(
        resolveManualReviewStatus({
          acceptedReviewRevision: "migration-confirmation-v1",
          reviewRevision: "migration-confirmation-v2",
        }),
        "manual-required",
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "RUNNER-UNIT-004",
      "holds the remote-test lease only around remote processes",
    ),
    () => {
      const remoteEvents = [];
      const remoteResult = runProfile("remote", {
        acquireLease() {
          remoteEvents.push("acquire");
          return { release: () => remoteEvents.push("release") };
        },
        discover: () => ["synthetic-remote.test.mjs"],
        spawn(_command, _args, options) {
          remoteEvents.push("spawn");
          writeFileSync(
            options.env.TASKSEQ_MAINTENANCE_EVENTS_PATH,
            `${JSON.stringify(declared("RUNNER-REMOTE-001"))}\n${JSON.stringify(completed("RUNNER-REMOTE-001", "passed"))}\n`,
          );
          return { status: 0, stderr: "", stdout: "" };
        },
      });
      assert.equal(remoteResult.ok, true);
      assert.deepEqual(remoteEvents, ["acquire", "spawn", "release"]);

      const loadEvents = [];
      const loadResult = runProfile("load", {
        acquireLease() {
          loadEvents.push("acquire");
          throw new Error("load must not acquire a remote lease");
        },
        discover: () => ["synthetic-load.test.mjs"],
        spawn(_command, _args, options) {
          loadEvents.push("spawn");
          writeFileSync(
            options.env.TASKSEQ_MAINTENANCE_EVENTS_PATH,
            `${JSON.stringify(declared("RUNNER-LOAD-001"))}\n${JSON.stringify(completed("RUNNER-LOAD-001", "passed"))}\n`,
          );
          return { status: 0, stderr: "", stdout: "" };
        },
      });
      assert.equal(loadResult.ok, true);
      assert.deepEqual(loadEvents, ["spawn"]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RUNNER-UNIT-005",
      "requires the profile segment in each case ID to match its registry profile",
    ),
    () => {
      assert.throws(
        () =>
          validateCaseDefinition(
            {
              id: "RUNNER-UNIT-999",
              operation: "runner",
              profile: "remote",
              title: "mismatch",
            },
            () => {},
          ),
        /profile/u,
      );

      const result = reconcileCaseEvents({
        events: [
          {
            ...declared("RUNNER-UNIT-998"),
            operation: "runner",
            profile: "remote",
            title: "misplaced case",
          },
          completed("RUNNER-UNIT-998", "passed"),
        ],
        processExitCode: 0,
        profile: "unit",
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.registryErrors, [
        "profile mismatch: RUNNER-UNIT-998 declared remote, executed unit",
      ]);
      assert.equal(result.cases[0].profile, "remote");
    },
  );

  maintenanceCase(
    caseMeta(
      "RUNNER-UNIT-006",
      "allows profile output larger than the default synchronous child buffer",
    ),
    () => {
      const simulatedOutputBytes = 2 * 1024 * 1024;
      const result = runProfile("unit", {
        discover: () => ["synthetic-large-output.test.mjs"],
        spawn(_command, _args, options) {
          if ((options.maxBuffer ?? 1024 * 1024) < simulatedOutputBytes) {
            return {
              error: Object.assign(new Error("spawnSync ENOBUFS"), {
                code: "ENOBUFS",
              }),
              status: null,
              stderr: "",
              stdout: "",
            };
          }
          writeFileSync(
            options.env.TASKSEQ_MAINTENANCE_EVENTS_PATH,
            `${JSON.stringify(declared("RUNNER-UNIT-006"))}\n${JSON.stringify(completed("RUNNER-UNIT-006", "passed"))}\n`,
          );
          return { status: 0, stderr: "", stdout: "" };
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.counts.passed, 1);
    },
  );
});

function declared(id, hasExecution = true, manual = false) {
  const profile = id
    .match(/-(UNIT|LOCAL|REMOTE|LOAD|PRODUCTION-READONLY)-/u)[1]
    .toLowerCase();
  return { id, type: "declared", hasExecution, manual, profile };
}

function completed(id, status, extra = {}) {
  return { id, type: "completed", status, durationMs: 1, ...extra };
}
