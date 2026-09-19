import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe } from "node:test";

import {
  askForConfirmation,
  assertResetState,
  formatResetConfirmation,
  parseResetVerificationOutput,
  ResetExecutionError,
  runReset,
  runWranglerReset,
  runWranglerVerify,
} from "../database-maintenance/reset.mjs";
import { parseArguments as parseCliArguments } from "../database-maintenance/reset-cli.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
  manualMaintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const migrations = [
  { name: "0001_initial.sql" },
  { name: "0002_add_views.sql" },
];
const temporaryDirectories = [];
const caseMeta = createCaseMetadata("reset", "unit");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("database reset", () => {
  maintenanceCase(
    caseMeta(
      "RESET-UNIT-001",
      "cancels before backup or write when confirmation is declined",
    ),
    async () => {
      const project = makeProject();
      const events = [];

      const result = await runReset({
        confirm: async () => false,
        environment: "local",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        runApply: () => events.push("apply"),
        runBackup: () => events.push("backup"),
        runQuery: () => fullHistory(),
        scriptDirectory: join(project, "scripts"),
      });

      assert.equal(result.status, "cancelled");
      assert.deepEqual(events, []);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-002",
      "rejects an unapplied migration before confirmation, backup, or write",
    ),
    async () => {
      const project = makeProject();
      const events = [];

      await assert.rejects(
        () =>
          runReset({
            confirm: async () => events.push("confirm"),
            environment: "local",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            runApply: () => events.push("apply"),
            runBackup: () => events.push("backup"),
            runQuery: () => ({
              names: [migrations[0].name],
              tableExists: true,
            }),
            scriptDirectory: join(project, "scripts"),
          }),
        /未適用migration/u,
      );

      assert.deepEqual(events, []);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-003",
      "confirms, backs up, and executes one atomic reset SQL file",
    ),
    async () => {
      const project = makeProject();
      const events = [];
      let resetSql;

      const result = await runReset({
        confirm: async ({ databaseName, environmentConfig, operation }) => {
          events.push([operation, environmentConfig.environment, databaseName]);
          return true;
        },
        environment: "local",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        runApply: ({ sqlPath }) => {
          events.push("apply");
          resetSql = readFileSync(sqlPath, "utf8");
        },
        runBackup: ({ operation }) => {
          events.push(["backup", operation]);
          return { path: "/tmp/local-reset.sql" };
        },
        runQuery: () => fullHistory(),
        runVerify: () => {
          events.push("verify");
          return JSON.stringify([
            {
              results: [validResetState()],
              success: true,
            },
          ]);
        },
        scriptDirectory: join(project, "scripts"),
      });

      assert.equal(result.status, "applied");
      assert.equal(result.backupPath, "/tmp/local-reset.sql");
      assert.deepEqual(events, [
        ["reset", "local", "taskseq-local"],
        ["backup", "reset"],
        "apply",
        "verify",
      ]);
      assert.doesNotMatch(resetSql, /BEGIN|COMMIT/u);
      assert.match(resetSql, /DELETE FROM task_manual_orders;/u);
      assert.match(resetSql, /DELETE FROM today_task_orders;/u);
      assert.match(resetSql, /DELETE FROM task_tags;/u);
      assert.match(resetSql, /DELETE FROM tasks;/u);
      assert.match(resetSql, /DELETE FROM tags;/u);
      assert.match(resetSql, /DELETE FROM areas;/u);
      assert.match(resetSql, /DELETE FROM views;/u);
      assert.match(resetSql, /DELETE FROM owner_settings;/u);
      assert.match(resetSql, /VALUES \('Inbox', 'gray', 0, 1\);/u);
      assert.match(resetSql, /VALUES \(1, 'Asia\/Tokyo', 0, 30, 1\);/u);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-004",
      "does not write when the pre-reset backup fails",
    ),
    async () => {
      const project = makeProject();
      const events = [];

      await assert.rejects(
        () =>
          runReset({
            confirm: async () => true,
            environment: "local",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            runApply: () => events.push("apply"),
            runBackup: () => {
              events.push("backup");
              throw new Error("backup failed");
            },
            runQuery: () => fullHistory(),
            scriptDirectory: join(project, "scripts"),
          }),
        /backup failed/u,
      );

      assert.deepEqual(events, ["backup"]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-005",
      "rejects a reset whose final state fails domain validation",
    ),
    async () => {
      const project = makeProject();
      const events = [];

      await assert.rejects(
        () =>
          runReset({
            confirm: async () => true,
            environment: "local",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            runApply: () => events.push("apply"),
            runBackup: () => ({ path: "/tmp/local-reset.sql" }),
            runQuery: () => fullHistory(),
            runVerify: () => ({ ...validResetState(), task_count: 1 }),
            scriptDirectory: join(project, "scripts"),
          }),
        (error) => {
          assert.equal(error instanceof ResetExecutionError, true);
          assert.equal(error.resultUnknown, false);
          assert.match(error.message, /task_count=1/u);
          return true;
        },
      );

      assert.deepEqual(events, ["apply"]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-006",
      "reports an unknown result without retrying or restoring",
    ),
    async () => {
      const project = makeProject("remote");
      let applyCalls = 0;

      await assert.rejects(
        () =>
          runReset({
            confirm: async () => true,
            environment: "remote",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            runApply: () => {
              applyCalls += 1;
              throw new Error("fetch failed");
            },
            runBackup: () => ({ path: "/tmp/remote-reset.sql" }),
            runQuery: () => fullHistory(),
            scriptDirectory: join(project, "scripts"),
          }),
        (error) => {
          assert.equal(error instanceof ResetExecutionError, true);
          assert.equal(error.resultUnknown, true);
          assert.equal(error.backupPath, "/tmp/remote-reset.sql");
          return true;
        },
      );

      assert.equal(applyCalls, 1);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-007",
      "executes the reset through one Wrangler file command",
    ),
    () => {
      const calls = [];

      runWranglerReset({
        appDirectory: "/project/app",
        environmentConfig: {
          childEnvironment: { CLOUDFLARE_ACCOUNT_ID: "account" },
          databaseName: "taskseq",
          scope: "--remote",
        },
        execFile(command, args, options) {
          calls.push({ args, command, options });
        },
        sqlPath: "/tmp/reset.sql",
      });

      assert.deepEqual(calls, [
        {
          args: [
            "exec",
            "wrangler",
            "d1",
            "execute",
            "taskseq",
            "--remote",
            "--file",
            "/tmp/reset.sql",
            "--yes",
          ],
          command: "pnpm",
          options: {
            cwd: "/project/app",
            encoding: "utf8",
            env: { CLOUDFLARE_ACCOUNT_ID: "account" },
            shell: false,
            stdio: ["inherit", "pipe", "pipe"],
          },
        },
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-008",
      "reads the final state through one Wrangler JSON query",
    ),
    () => {
      const calls = [];

      runWranglerVerify({
        appDirectory: "/project/app",
        environmentConfig: {
          childEnvironment: { CLOUDFLARE_ACCOUNT_ID: "account" },
          databaseName: "taskseq",
          scope: "--remote",
        },
        execFile(command, args, options) {
          calls.push({ args, command, options });
          return '{"results":[]}';
        },
      });

      assert.deepEqual(calls[0].args.slice(0, 7), [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "taskseq",
        "--remote",
        "--command",
      ]);
      assert.equal(calls[0].args.at(-1), "--json");
      assert.equal(calls[0].options.env.CLOUDFLARE_ACCOUNT_ID, "account");
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-009",
      "parses and validates the Wrangler final-state response",
    ),
    () => {
      const state = validResetState();
      assert.deepEqual(
        parseResetVerificationOutput(
          JSON.stringify([{ results: [state], success: true }]),
        ),
        state,
      );
      assert.deepEqual(assertResetState(state), state);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-010",
      "keeps the environment fixed by each shell entrypoint",
    ),
    () => {
      assert.deepEqual(parseCliArguments(["--environment", "local"]), {
        environment: "local",
        help: false,
      });
      assert.deepEqual(parseCliArguments(["--help"]), {
        environment: null,
        help: true,
      });
      assert.throws(
        () => parseCliArguments([]),
        /environmentにはlocalまたはremoteを指定/u,
      );

      for (const [entrypoint, environment] of [
        ["local-reset.sh", "local"],
        ["remote-reset.sh", "remote"],
      ]) {
        const path = join(process.cwd(), "scripts", entrypoint);
        const contents = readFileSync(path, "utf8");
        assert.match(contents, new RegExp(`--environment ${environment}`, "u"));
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-011",
      "renders the actual prompt and accepts only y or Y without touching a database",
    ),
    async () => {
      const details = {
        databaseName: "taskseq-local",
        environmentConfig: { label: "local D1" },
      };
      const view = formatResetConfirmation(details);
      assert.deepEqual(view, {
        message:
          "対象: local D1 (taskseq-local)\n" +
          "操作: DBを必須初期データだけにresetします。\n" +
          "Task、Tag、Area、View、並び順を削除し、InboxとOwner設定を既定値へ戻します。\n",
        prompt: "上記のresetを実行しますか？ [y/N]: ",
      });

      for (const [inputText, expected] of [
        ["y\n", true],
        ["Y\n", true],
        ["n\n", false],
        ["\n", false],
        [null, false],
      ]) {
        const input = new PassThrough();
        const output = new PassThrough();
        let displayed = "";
        output.setEncoding("utf8");
        output.on("data", (chunk) => {
          displayed += chunk;
        });
        const confirmation = askForConfirmation({ ...details, input, output });
        input.end(inputText ?? undefined);
        assert.equal(await confirmation, expected);
        assert.equal(displayed, `${view.message}${view.prompt}`);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-012",
      "passes one test-target Wrangler config through history, backup, apply, and readback",
    ),
    async () => {
      const project = makeProject("local-test");
      const configPath = join(project, "wrangler.json");
      writeFileSync(configPath, "{}\n");
      const calls = [];

      const result = await runReset({
        confirm: async () => true,
        environment: "local-test",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        runApply: (options) => calls.push(["apply", options]),
        runBackup: (options) => {
          calls.push(["backup", options]);
          return { path: "/tmp/local-test-reset.sql" };
        },
        runQuery: (options) => {
          calls.push(["query", options]);
          return fullHistory();
        },
        runVerify: (options) => {
          calls.push(["verify", options]);
          return validResetState();
        },
        scriptDirectory: join(project, "scripts"),
        wranglerConfigPath: configPath,
      });

      assert.equal(result.status, "applied");
      assert.deepEqual(
        calls.map(([stage, options]) => [stage, options.configPath]),
        [
          ["query", configPath],
          ["backup", configPath],
          ["apply", configPath],
          ["verify", configPath],
        ],
      );
    },
  );

  manualMaintenanceCase({
    ...caseMeta(
      "RESET-UNIT-013",
      "Owner confirms that reset target and deletion scope are unambiguous",
    ),
    acceptedReviewRevision: "reset-confirmation-v1",
    reviewOutput: resetManualReviewOutput(),
    reviewRevision: "reset-confirmation-v1",
  });

  maintenanceCase(
    caseMeta(
      "RESET-UNIT-014",
      "reports an unknown result when the final readback cannot be interpreted",
    ),
    async () => {
      const project = makeProject();

      await assert.rejects(
        () =>
          runReset({
            confirm: async () => true,
            environment: "local",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            runApply: () => {},
            runBackup: () => ({ path: "/tmp/local-reset.sql" }),
            runQuery: () => fullHistory(),
            runVerify: () => "not-json",
            scriptDirectory: join(project, "scripts"),
          }),
        (error) => {
          assert.equal(error instanceof ResetExecutionError, true);
          assert.equal(error.resultUnknown, true);
          assert.equal(error.backupPath, "/tmp/local-reset.sql");
          return true;
        },
      );
    },
  );
});

function resetManualReviewOutput() {
  return [
    {
      databaseName: "taskseq-local",
      heading: "local reset",
      label: "local D1",
    },
    {
      databaseName: "taskseq",
      heading: "remote production reset",
      label: "remote D1",
    },
  ]
    .map(({ databaseName, heading, label }) => {
      const view = formatResetConfirmation({
        databaseName,
        environmentConfig: { label },
      });
      return `[${heading}]\n${view.message}${view.prompt}`;
    })
    .join("\n\n");
}

function makeProject(environment = "local") {
  const root = mkdtempSync(join(tmpdir(), "taskseq-maintenance-reset-"));
  temporaryDirectories.push(root);
  const backupDirectory = mkdtempSync(
    join(tmpdir(), "taskseq-maintenance-reset-output-"),
  );
  temporaryDirectories.push(backupDirectory);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "app", "migrations"), { recursive: true });
  writeFileSync(
    join(root, "scripts", `.env.${environment}`),
    [
      `D1_DATABASE_NAME=${environment === "remote" ? "taskseq" : environment === "local-test" ? "case-specific-local-test" : "taskseq-local"}`,
      `D1_BACKUP_DIR=${backupDirectory}`,
      ...(environment === "remote" || environment === "remote-test"
        ? ["CLOUDFLARE_ACCOUNT_ID=test-account"]
        : []),
    ].join("\n"),
  );
  for (const migration of migrations) {
    writeFileSync(join(root, "app", "migrations", migration.name), "-- test\n");
  }
  return root;
}

function fullHistory() {
  return {
    names: migrations.map(({ name }) => name),
    tableExists: true,
  };
}

function validResetState() {
  return {
    area_count: 1,
    inbox_count: 1,
    manual_order_count: 0,
    owner_settings_count: 1,
    tag_count: 0,
    task_count: 0,
    task_tag_count: 0,
    today_order_count: 0,
    view_count: 0,
  };
}
