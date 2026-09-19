import assert from "node:assert/strict";
import {
  existsSync,
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
  buildMigrationPlan,
  formatMigrationConfirmation,
  parseMigrationHistoryOutput,
  resolveMigrationHistory,
  runMigration,
  runWranglerApply,
  runWranglerQuery,
} from "../database-maintenance/migration.mjs";
import { parseArguments as parseCliArguments } from "../database-maintenance/migration-cli.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
  manualMaintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const migrations = [
  { name: "0001_initial.sql" },
  { name: "0002_add_tasks.sql" },
  { name: "0003_add_views.sql" },
];
const caseMeta = createCaseMetadata("migration", "unit");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("database migration plan", () => {
  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-001",
      "plans every repository migration when the history table is absent",
    ),
    () => {
      assert.deepEqual(
        buildMigrationPlan({
          migrations,
          history: { tableExists: false, names: [] },
        }),
        {
          appliedNames: [],
          historyTableExists: false,
          pendingMigrations: migrations,
        },
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-002",
      "plans only the suffix after an ordered applied prefix",
    ),
    () => {
      assert.deepEqual(
        buildMigrationPlan({
          migrations,
          history: {
            tableExists: true,
            names: ["0001_initial.sql", "0002_add_tasks.sql"],
          },
        }),
        {
          appliedNames: ["0001_initial.sql", "0002_add_tasks.sql"],
          historyTableExists: true,
          pendingMigrations: [migrations[2]],
        },
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-003",
      "rejects an unknown migration, a gap, and an out-of-order history",
    ),
    () => {
      for (const names of [
        ["0001_initial.sql", "0099_unknown.sql"],
        ["0001_initial.sql", "0003_add_views.sql"],
        ["0002_add_tasks.sql", "0001_initial.sql"],
      ]) {
        assert.throws(
          () =>
            buildMigrationPlan({
              migrations,
              history: { tableExists: true, names },
            }),
          /migration履歴がrepositoryと一致しません/u,
        );
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-004",
      "parses local and remote Wrangler JSON query results",
    ),
    () => {
      assert.deepEqual(
        parseMigrationHistoryOutput(
          JSON.stringify({
            results: [
              { name: "0001_initial.sql" },
              { name: "0002_add_tasks.sql" },
            ],
            success: true,
          }),
        ),
        {
          names: ["0001_initial.sql", "0002_add_tasks.sql"],
          tableExists: true,
        },
      );
      assert.deepEqual(
        parseMigrationHistoryOutput({
          result: [
            {
              results: [{ name: "0001_initial.sql" }],
              success: true,
            },
          ],
        }),
        { names: ["0001_initial.sql"], tableExists: true },
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-005",
      "treats only a missing d1_migrations table as an initial database",
    ),
    () => {
      const missingTableError = Object.assign(new Error("command failed"), {
        stdout: JSON.stringify({
          error: { text: "no such table: d1_migrations: SQLITE_ERROR" },
        }),
      });
      assert.deepEqual(
        resolveMigrationHistory({
          runQuery: () => {
            throw missingTableError;
          },
        }),
        { names: [], tableExists: false },
      );

      const authenticationError = Object.assign(new Error("command failed"), {
        stdout: JSON.stringify({ error: { text: "Authentication error" } }),
      });
      assert.throws(
        () =>
          resolveMigrationHistory({
            runQuery: () => {
              throw authenticationError;
            },
          }),
        /command failed/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-006",
      "does not confirm, back up, or apply when no migration is pending",
    ),
    async () => {
      const project = makeProject();
      const events = [];

      const result = await runMigration({
        appDirectory: join(project, "app"),
        environment: "local",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runApply: () => events.push("apply"),
        runBackup: () => events.push("backup"),
        runQuery: () => ({
          names: migrations.map(({ name }) => name),
          tableExists: true,
        }),
        confirm: async () => events.push("confirm"),
      });

      assert.equal(result.status, "up-to-date");
      assert.deepEqual(events, []);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-007",
      "confirms once, backs up, then applies the pending migrations in order",
    ),
    async () => {
      const project = makeProject();
      const events = [];
      const backupPath = join(project, "outside", "local-backup.sql");

      const result = await runMigration({
        appDirectory: join(project, "app"),
        confirm: async (details) => {
          events.push([
            "confirm",
            details.pendingMigrations.map(({ name }) => name),
          ]);
          return true;
        },
        environment: "local",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runApply: ({ pendingMigrations }) => {
          events.push(["apply", pendingMigrations.map(({ name }) => name)]);
        },
        runBackup: () => {
          events.push("backup");
          return { path: backupPath };
        },
        runQuery: () => ({
          names: [migrations[0].name],
          tableExists: true,
        }),
      });

      assert.equal(result.status, "applied");
      assert.equal(result.backupPath, backupPath);
      assert.deepEqual(events, [
        ["confirm", ["0002_add_tasks.sql", "0003_add_views.sql"]],
        "backup",
        ["apply", ["0002_add_tasks.sql", "0003_add_views.sql"]],
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-008",
      "does not back up or apply when confirmation is cancelled",
    ),
    async () => {
      const project = makeProject();
      const events = [];

      const result = await runMigration({
        appDirectory: join(project, "app"),
        confirm: async () => false,
        environment: "local",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runApply: () => events.push("apply"),
        runBackup: () => events.push("backup"),
        runQuery: () => ({ names: [], tableExists: false }),
      });

      assert.equal(result.status, "cancelled");
      assert.deepEqual(events, []);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-009",
      "queries migration history without using Wrangler's mutating migration command",
    ),
    () => {
      const calls = [];
      const output = runWranglerQuery({
        appDirectory: "/project/app",
        environmentConfig: {
          childEnvironment: { D1_DATABASE_NAME: "taskseq-local" },
          databaseName: "taskseq-local",
          scope: "--local",
        },
        execFile(command, args, options) {
          calls.push({ args, command, options });
          return '{"results":[],"success":true}';
        },
      });

      assert.equal(output, '{"results":[],"success":true}');
      assert.deepEqual(calls, [
        {
          args: [
            "exec",
            "wrangler",
            "d1",
            "execute",
            "taskseq-local",
            "--local",
            "--command",
            "SELECT name FROM d1_migrations ORDER BY id",
            "--json",
          ],
          command: "pnpm",
          options: {
            cwd: "/project/app",
            encoding: "utf8",
            env: { D1_DATABASE_NAME: "taskseq-local" },
            shell: false,
            stdio: ["inherit", "pipe", "pipe"],
          },
        },
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-010",
      "applies through Wrangler once with its confirmation disabled",
    ),
    () => {
      const calls = [];
      runWranglerApply({
        appDirectory: "/project/app",
        environmentConfig: {
          childEnvironment: { CLOUDFLARE_ACCOUNT_ID: "account" },
          databaseName: "taskseq",
          scope: "--remote",
        },
        execFile(command, args, options) {
          calls.push({ args, command, options });
        },
      });

      assert.deepEqual(calls, [
        {
          args: [
            "exec",
            "wrangler",
            "d1",
            "migrations",
            "apply",
            "taskseq",
            "--remote",
          ],
          command: "pnpm",
          options: {
            cwd: "/project/app",
            encoding: "utf8",
            env: { CLOUDFLARE_ACCOUNT_ID: "account", CI: "1" },
            shell: false,
            stdio: ["inherit", "pipe", "pipe"],
          },
        },
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-011",
      "keeps the backup and never applies when the pre-migration backup fails",
    ),
    async () => {
      const project = makeProject();
      const events = [];

      await assert.rejects(
        () =>
          runMigration({
            appDirectory: join(project, "app"),
            confirm: async () => true,
            environment: "local",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            scriptDirectory: join(project, "scripts"),
            runApply: () => events.push("apply"),
            runBackup: () => {
              events.push("backup");
              throw new Error("backup failed");
            },
            runQuery: () => ({ names: [], tableExists: false }),
          }),
        /backup failed/u,
      );
      assert.deepEqual(events, ["backup"]);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-012",
      "reports a known migration failure with the backup path and does not retry",
    ),
    async () => {
      const project = makeProject();
      const backupPath = join(project, "outside", "local-backup.sql");
      let applyCalls = 0;

      await assert.rejects(
        () =>
          runMigration({
            appDirectory: join(project, "app"),
            confirm: async () => true,
            environment: "local",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            scriptDirectory: join(project, "scripts"),
            runApply: () => {
              applyCalls += 1;
              throw new Error("SQL migration failed");
            },
            runBackup: () => ({ path: backupPath }),
            runQuery: () => ({ names: [], tableExists: false }),
          }),
        (error) => {
          assert.equal(error.name, "MigrationExecutionError");
          assert.equal(error.resultUnknown, false);
          assert.equal(error.backupPath, backupPath);
          assert.match(error.message, /SQL migration failed/u);
          return true;
        },
      );
      assert.equal(applyCalls, 1);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-013",
      "marks transport failures as result unknown",
    ),
    async () => {
      const project = makeProject();

      await assert.rejects(
        () =>
          runMigration({
            appDirectory: join(project, "app"),
            confirm: async () => true,
            environment: "local",
            migrationDirectory: join(project, "app", "migrations"),
            projectRoot: project,
            scriptDirectory: join(project, "scripts"),
            runApply: () => {
              throw new Error("fetch failed");
            },
            runBackup: () => ({ path: "/tmp/local-backup.sql" }),
            runQuery: () => ({ names: [], tableExists: false }),
          }),
        (error) =>
          error.name === "MigrationExecutionError" && error.resultUnknown,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-014",
      "uses a temporary remote Wrangler config without requiring Access settings",
    ),
    async () => {
      const project = makeProject("remote");
      const events = [];
      let configDuringApply;

      const result = await runMigration({
        appDirectory: join(project, "app"),
        confirm: async () => true,
        environment: "remote",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runApply: ({ configPath, environmentConfig }) => {
          configDuringApply = JSON.parse(readFileSync(configPath, "utf8"));
          events.push([environmentConfig.databaseName, configPath]);
        },
        runBackup: () => ({ path: "/tmp/remote-backup.sql" }),
        runQuery: ({ configPath, environmentConfig }) => {
          const config = JSON.parse(readFileSync(configPath, "utf8"));
          assert.equal(
            environmentConfig.childEnvironment.ACCESS_JWT_AUD,
            undefined,
          );
          assert.equal(config.d1_databases[0].database_name, "taskseq");
          assert.equal(config.d1_databases[0].database_id, undefined);
          return { names: [], tableExists: false };
        },
      });

      assert.equal(result.status, "applied");
      assert.equal(
        configDuringApply.d1_databases[0].migrations_dir,
        join(project, "app", "migrations"),
      );
      assert.equal(events.length, 1);
      assert.equal(existsSync(events[0][1]), false);
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-015",
      "requires an environment fixed by the shell entrypoint",
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
    },
  );

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-017",
      "keeps a case-specific local-test config through query, backup, and apply",
    ),
    async () => {
      const project = makeProject("local-test");
      const wranglerConfigPath = join(project, "wrangler.json");
      writeFileSync(
        wranglerConfigPath,
        JSON.stringify({
          d1_databases: [
            {
              binding: "DB",
              database_id: "local",
              database_name: "case-specific-local-test",
            },
          ],
          name: "taskseq-maintenance-test",
        }),
      );
      const calls = [];

      const result = await runMigration({
        appDirectory: join(project, "app"),
        confirm: async () => true,
        environment: "local-test",
        migrationDirectory: join(project, "app", "migrations"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        wranglerConfigPath,
        runApply: (options) => calls.push(["apply", options]),
        runBackup: (options) => {
          calls.push(["backup", options]);
          return { path: "/tmp/local-test-backup.sql" };
        },
        runQuery: (options) => {
          calls.push([
            "query",
            options,
            JSON.parse(readFileSync(options.configPath, "utf8")),
          ]);
          return { names: [], tableExists: false };
        },
      });

      assert.equal(result.status, "applied");
      assert.equal(calls[0][1].configPath, wranglerConfigPath);
      assert.equal(calls[1][1].configPath, wranglerConfigPath);
      assert.equal(calls[2][1].configPath, wranglerConfigPath);
      assert.equal(calls[0][2].d1_databases[0].database_id, "local");
    },
  );

  manualMaintenanceCase({
    ...caseMeta(
      "MIGRATION-UNIT-016",
      "Owner confirms that the migration target and confirmation prompt are unambiguous",
    ),
    acceptedReviewRevision: "migration-confirmation-v1",
    reviewOutput: migrationManualReviewOutput(),
    reviewRevision: "migration-confirmation-v1",
  });

  maintenanceCase(
    caseMeta(
      "MIGRATION-UNIT-019",
      "renders the actual prompt and accepts only y or Y without touching a database",
    ),
    async () => {
      const details = {
        environmentConfig: {
          databaseName: "taskseq-local",
          label: "local D1",
        },
        pendingMigrations: [
          { name: "0012_example.sql" },
          { name: "0013_example.sql" },
        ],
      };
      const view = formatMigrationConfirmation(details);
      assert.deepEqual(view, {
        message:
          "対象: local D1 (taskseq-local)\n適用するmigration:\n- 0012_example.sql\n- 0013_example.sql\n",
        prompt: "上記のmigrationを適用しますか？ [y/N]: ",
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
});

function migrationManualReviewOutput() {
  const pendingMigrations = [{ name: "0012_example_candidate.sql" }];
  const examples = [
    {
      databaseName: "taskseq-local",
      heading: "local migration",
      label: "local D1",
    },
    {
      databaseName: "taskseq",
      heading: "remote production migration",
      label: "remote D1",
    },
  ];
  return examples
    .map(({ databaseName, heading, label }) => {
      const view = formatMigrationConfirmation({
        environmentConfig: { databaseName, label },
        pendingMigrations,
      });
      return `[${heading}]\n${view.message}${view.prompt}`;
    })
    .join("\n\n");
}

function makeProject(environment = "local") {
  const root = mkdtempSync(join(tmpdir(), "taskseq-maintenance-migration-"));
  temporaryDirectories.push(root);
  const backupDirectory = mkdtempSync(
    join(tmpdir(), "taskseq-maintenance-migration-output-"),
  );
  temporaryDirectories.push(backupDirectory);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "app", "migrations"), { recursive: true });
  writeFileSync(
    join(root, "scripts", `.env.${environment}`),
    [
      `D1_DATABASE_NAME=${environment === "remote" ? "taskseq" : environment === "local-test" ? "case-specific-local-test" : "taskseq-local"}`,
      `D1_BACKUP_DIR=${backupDirectory}`,
      ...(environment === "remote"
        ? ["CLOUDFLARE_ACCOUNT_ID=test-account"]
        : []),
    ].join("\n"),
  );
  for (const migration of migrations) {
    writeFileSync(join(root, "app", "migrations", migration.name), "-- test\n");
  }
  return root;
}
