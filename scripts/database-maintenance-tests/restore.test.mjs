import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe } from "node:test";
import { PassThrough } from "node:stream";

import {
  askForConfirmation,
  formatRestoreConfirmation,
  RestoreExecutionError,
  runRestore,
} from "../database-maintenance/restore.mjs";
import {
  parseArguments as parseRestoreCliArguments,
  runCli as runRestoreCli,
} from "../database-maintenance/restore-cli.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
  manualMaintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const temporaryDirectories = [];
const caseMeta = createCaseMetadata("restore", "unit");
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("database restore", () => {
  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-001",
      "validates the input and target before cancellation without backup or write",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "input.sql");
      writeFileSync(inputPath, "-- compatible backup\n");
      const events = [];

      const result = await runRestore({
        confirm: async () => {
          events.push("confirm");
          return false;
        },
        environment: "local",
        inputPath,
        inspectInput: () => {
          events.push("inspect-input");
          return compatibleInspection();
        },
        inspectRepository: () => {
          events.push("inspect-repository");
          return compatibleInspection();
        },
        inspectTarget: () => {
          events.push("inspect-target");
          return compatibleInspection();
        },
        projectRoot: project,
        runApply: () => events.push("apply"),
        runBackup: () => events.push("backup"),
        scriptDirectory: join(project, "scripts"),
      });

      assert.equal(result.status, "cancelled");
      assert.deepEqual(events, [
        "inspect-input",
        "inspect-repository",
        "inspect-target",
        "confirm",
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-002",
      "backs up, atomically replaces the target with the exact input SQL, and verifies readback",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "input.sql");
      const inputSql =
        "PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO tasks VALUES('引用符''・改行\nUnicode雪;');\n";
      writeFileSync(inputPath, inputSql);
      const expected = compatibleInspection({
        data: { areas: [{ id: 1, name: "Inbox" }] },
      });
      const targetBefore = compatibleInspection({
        data: { areas: [{ id: 99, name: "sentinel" }] },
      });
      let targetInspectionCount = 0;
      const events = [];
      let appliedSql;

      const result = await runRestore({
        confirm: async () => {
          events.push("confirm");
          return true;
        },
        environment: "local",
        inputPath,
        inspectInput: () => {
          events.push("inspect-input");
          return expected;
        },
        inspectRepository: () => {
          events.push("inspect-repository");
          return compatibleInspection();
        },
        inspectTarget: () => {
          targetInspectionCount += 1;
          events.push(`inspect-target-${targetInspectionCount}`);
          return targetInspectionCount === 1 ? targetBefore : expected;
        },
        projectRoot: project,
        runApply: ({ sqlPath }) => {
          events.push("apply");
          appliedSql = readFileSync(sqlPath, "utf8");
        },
        runBackup: ({ operation }) => {
          events.push(`backup-${operation}`);
          return { path: "/tmp/local-restore.sql" };
        },
        scriptDirectory: join(project, "scripts"),
      });

      assert.equal(result.status, "applied");
      assert.equal(result.backupPath, "/tmp/local-restore.sql");
      assert.deepEqual(events, [
        "inspect-input",
        "inspect-repository",
        "inspect-target-1",
        "confirm",
        "backup-restore",
        "apply",
        "inspect-target-2",
      ]);
      assert.match(appliedSql, /DROP TABLE IF EXISTS "areas";/u);
      assert.equal(appliedSql.endsWith(inputSql), true);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-003",
      "accepts a latest-schema SQL backup after isolated repository and domain validation",
    ),
    async () => {
      const project = makeLatestSchemaProject();
      const inputPath = join(project, "compatible.sql");
      writeFileSync(inputPath, latestSchemaSql(project));

      const result = await runRestore({
        confirm: async () => false,
        environment: "local",
        inputPath,
        inspectTarget: ({ repository }) => repository,
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
      });

      assert.equal(result.status, "cancelled");
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-004",
      "rejects malformed SQL, missing required data, and broken references before target access",
    ),
    async () => {
      const project = makeLatestSchemaProject();
      const baseSql = latestSchemaSql(project);
      const invalidInputs = [
        ["malformed.sql", `${baseSql}\nTHIS IS NOT SQL;`, /入力SQLを復元できません/u],
        [
          "missing-inbox.sql",
          `${baseSql}\nDELETE FROM areas WHERE is_system_managed = 1;`,
          /必須のInboxまたはOwner設定/u,
        ],
        [
          "broken-reference.sql",
          `${baseSql}\nPRAGMA foreign_keys=OFF;\nINSERT INTO tasks (id, title, status, area_id, created_at, updated_at) VALUES ('broken', 'Broken', 'OPEN', 9999, '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z');`,
          /参照整合性/u,
        ],
      ];

      for (const [name, sql, message] of invalidInputs) {
        const inputPath = join(project, name);
        writeFileSync(inputPath, sql);
        const events = [];
        await assert.rejects(
          () =>
            runRestore({
              confirm: async () => events.push("confirm"),
              environment: "local",
              inputPath,
              inspectTarget: () => events.push("target"),
              projectRoot: project,
              scriptDirectory: join(project, "scripts"),
            }),
          message,
        );
        assert.deepEqual(events, []);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-005",
      "classifies apply failures without retrying or automatically restoring the backup",
    ),
    async () => {
      for (const [code, resultUnknown] of [
        ["SQLITE_ERROR", false],
        ["ETIMEDOUT", true],
      ]) {
        const project = makeProject();
        const inputPath = join(project, `${code}.sql`);
        writeFileSync(inputPath, "-- compatible backup\n");
        let applyCount = 0;
        let backupCount = 0;
        const failure = Object.assign(new Error(`apply ${code}`), { code });

        await assert.rejects(
          () =>
            runRestore({
              confirm: async () => true,
              environment: "local",
              inputPath,
              inspectInput: () => compatibleInspection(),
              inspectRepository: () => compatibleInspection(),
              inspectTarget: () => compatibleInspection(),
              projectRoot: project,
              runApply: () => {
                applyCount += 1;
                throw failure;
              },
              runBackup: () => {
                backupCount += 1;
                return { path: "/tmp/pre-restore.sql" };
              },
              scriptDirectory: join(project, "scripts"),
            }),
          (error) => {
            assert.equal(error instanceof RestoreExecutionError, true);
            assert.equal(error.resultUnknown, resultUnknown);
            assert.equal(error.backupPath, "/tmp/pre-restore.sql");
            return true;
          },
        );
        assert.equal(applyCount, 1);
        assert.equal(backupCount, 1);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-006",
      "classifies unreadable post-restore state as unknown and a known mismatch as failed",
    ),
    async () => {
      for (const [postRestore, resultUnknown] of [
        [() => { throw new Error("invalid JSON"); }, true],
        [
          () => compatibleInspection({ data: { areas: [{ id: 8 }] } }),
          false,
        ],
      ]) {
        const project = makeProject();
        const inputPath = join(project, `readback-${resultUnknown}.sql`);
        writeFileSync(inputPath, "-- compatible backup\n");
        let inspectionCount = 0;

        await assert.rejects(
          () =>
            runRestore({
              confirm: async () => true,
              environment: "local",
              inputPath,
              inspectInput: () =>
                compatibleInspection({ data: { areas: [{ id: 1 }] } }),
              inspectRepository: () => compatibleInspection(),
              inspectTarget: () => {
                inspectionCount += 1;
                return inspectionCount === 1
                  ? compatibleInspection()
                  : postRestore();
              },
              projectRoot: project,
              runApply: () => {},
              runBackup: () => ({ path: "/tmp/pre-restore.sql" }),
              scriptDirectory: join(project, "scripts"),
            }),
          (error) => {
            assert.equal(error instanceof RestoreExecutionError, true);
            assert.equal(error.resultUnknown, resultUnknown);
            assert.equal(error.backupPath, "/tmp/pre-restore.sql");
            return true;
          },
        );
        assert.equal(inspectionCount, 2);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-007",
      "requires one SQL path, supports help, and resolves relative input from the launch directory",
    ),
    async () => {
      assert.deepEqual(parseRestoreCliArguments(["--help"]), {
        environment: null,
        help: true,
        inputPath: null,
      });
      assert.throws(
        () => parseRestoreCliArguments(["--environment", "local"]),
        /SQL入力パス/u,
      );
      assert.throws(
        () =>
          parseRestoreCliArguments([
            "--environment",
            "local",
            "one.sql",
            "two.sql",
          ]),
        /SQL入力パスは1つ/u,
      );

      const project = makeProject();
      const inputPath = join(project, "relative.sql");
      writeFileSync(inputPath, "-- backup\n");
      const output = [];
      const exitCode = await runRestoreCli(
        ["--environment", "local", "relative.sql"],
        {
          executeRestore: async (options) => {
            assert.equal(options.inputPath, inputPath);
            return {
              backupPath: "/tmp/pre-restore.sql",
              databaseName: "taskseq-local",
              label: "local D1",
              status: "applied",
            };
          },
          launchDirectory: project,
          output: { write: (value) => output.push(value) },
        },
      );
      assert.equal(exitCode, 0);
      assert.match(output.join(""), /restoreを実行しました/u);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-008",
      "rejects input or target schema and migration mismatches before confirmation or backup",
    ),
    async () => {
      const variants = [
        compatibleInspection({ schemaName: "old_areas" }),
        compatibleInspection({ migrations: ["0000_unknown.sql"] }),
      ];
      for (const input of variants) {
        const project = makeProject();
        const inputPath = join(project, "mismatch.sql");
        writeFileSync(inputPath, "-- mismatch\n");
        const events = [];
        await assert.rejects(
          () =>
            runRestore({
              confirm: async () => events.push("confirm"),
              environment: "local",
              inputPath,
              inspectInput: () => input,
              inspectRepository: () => compatibleInspection(),
              inspectTarget: () => events.push("target"),
              projectRoot: project,
              runBackup: () => events.push("backup"),
              scriptDirectory: join(project, "scripts"),
            }),
          /repository/u,
        );
        assert.deepEqual(events, []);
      }

      const project = makeProject();
      const inputPath = join(project, "target-mismatch.sql");
      writeFileSync(inputPath, "-- target mismatch\n");
      const events = [];
      await assert.rejects(
        () =>
          runRestore({
            confirm: async () => events.push("confirm"),
            environment: "local",
            inputPath,
            inspectInput: () => compatibleInspection(),
            inspectRepository: () => compatibleInspection(),
            inspectTarget: () =>
              compatibleInspection({ schemaName: "unexpected" }),
            projectRoot: project,
            runBackup: () => events.push("backup"),
            scriptDirectory: join(project, "scripts"),
          }),
        /復元先DBとrepository/u,
      );
      assert.deepEqual(events, []);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-009",
      "accepts environment-specific migration row IDs and applied timestamps",
    ),
    async () => {
      const project = makeLatestSchemaProject();
      const inputPath = join(project, "different-migration-metadata.sql");
      const sql = latestSchemaSql(project)
        .replaceAll(
          /(INSERT INTO d1_migrations \(id, name, applied_at\) VALUES \()(\d+),/gu,
          (_match, prefix, id) => `${prefix}${Number(id) + 100},`,
        )
        .replaceAll("2026-09-08 00:00:00", "2040-12-31 23:59:59");
      writeFileSync(inputPath, sql);

      const result = await runRestore({
        confirm: async () => false,
        environment: "local",
        inputPath,
        inspectTarget: ({ repository }) => repository,
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
      });
      assert.equal(result.status, "cancelled");
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-010",
      "does not apply when the pre-restore backup fails",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "backup-failure.sql");
      writeFileSync(inputPath, "-- compatible\n");
      const events = [];
      await assert.rejects(
        () =>
          runRestore({
            confirm: async () => true,
            environment: "local",
            inputPath,
            inspectInput: () => compatibleInspection(),
            inspectRepository: () => compatibleInspection(),
            inspectTarget: () => compatibleInspection(),
            projectRoot: project,
            runApply: () => events.push("apply"),
            runBackup: () => {
              events.push("backup");
              throw new Error("backup failed");
            },
            scriptDirectory: join(project, "scripts"),
          }),
        /backup failed/u,
      );
      assert.deepEqual(events, ["backup"]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-011",
      "shows target, complete replacement scope, input path, and accepts only y or Y",
    ),
    async () => {
      const details = {
        databaseName: "taskseq-local",
        environmentConfig: { label: "local D1" },
        inputPath: "/backup/taskseq.sql",
      };
      const view = formatRestoreConfirmation(details);
      assert.match(view.message, /local D1 \(taskseq-local\)/u);
      assert.match(view.message, /DB全体/u);
      assert.match(view.message, /\/backup\/taskseq\.sql/u);

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

  manualMaintenanceCase({
    ...caseMeta(
      "RESTORE-UNIT-012",
      "Owner confirms that restore target, input, and replacement scope are unambiguous",
    ),
    acceptedReviewRevision: "restore-confirmation-v1",
    reviewOutput: restoreManualReviewOutput(),
    reviewRevision: "restore-confirmation-v1",
  });

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-013",
      "rejects old-schema and reordered migration backup SQL before target access",
    ),
    async () => {
      const project = makeLatestSchemaProject();
      const latest = latestSchemaSql(project);
      const names = migrationNames(project);
      const oldSql = latestSchemaSql(project, names.slice(0, -1));
      const reorderedSql = latest
        .replace(names[0], "restore-swap-placeholder.sql")
        .replace(names[1], names[0])
        .replace("restore-swap-placeholder.sql", names[1]);

      for (const [name, sql] of [
        ["old-schema.sql", oldSql],
        ["reordered-history.sql", reorderedSql],
      ]) {
        const inputPath = join(project, name);
        writeFileSync(inputPath, sql);
        let targetInspected = false;
        await assert.rejects(
          () =>
            runRestore({
              environment: "local",
              inputPath,
              inspectTarget: () => {
                targetInspected = true;
              },
              projectRoot: project,
              scriptDirectory: join(project, "scripts"),
            }),
          /repository/u,
        );
        assert.equal(targetInspected, false);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-014",
      "passes one test-target config through inspection, backup, apply, and readback",
    ),
    async () => {
      const project = makeProject("local-test");
      const inputPath = join(project, "config.sql");
      const configPath = join(project, "wrangler.json");
      writeFileSync(inputPath, "-- compatible\n");
      writeFileSync(configPath, "{}\n");
      const seen = [];
      let targetCount = 0;
      await runRestore({
        confirm: async () => true,
        environment: "local-test",
        inputPath,
        inspectInput: () => compatibleInspection(),
        inspectRepository: () => compatibleInspection(),
        inspectTarget: (options) => {
          targetCount += 1;
          seen.push(["inspect", options.configPath]);
          return compatibleInspection();
        },
        projectRoot: project,
        runApply: (options) => seen.push(["apply", options.configPath]),
        runBackup: (options) => {
          seen.push(["backup", options.configPath]);
          return { path: "/tmp/pre-restore.sql" };
        },
        scriptDirectory: join(project, "scripts"),
        wranglerConfigPath: configPath,
      });
      assert.equal(targetCount, 2);
      assert.deepEqual(seen, [
        ["inspect", configPath],
        ["backup", configPath],
        ["apply", configPath],
        ["inspect", configPath],
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-015",
      "provides executable fixed local and remote restore entrypoints",
    ),
    () => {
      for (const [entrypoint, environment] of [
        ["local-restore.sh", "local"],
        ["remote-restore.sh", "remote"],
      ]) {
        const path = resolve(repositoryRoot, "scripts", entrypoint);
        assert.equal(existsSync(path), true);
        assert.notEqual(statSync(path).mode & 0o111, 0);
        const source = readFileSync(path, "utf8");
        assert.match(source, new RegExp(`--environment ${environment}`, "u"));
        assert.match(source, /restore-cli\.mjs/u);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-016",
      "applies the same SQL bytes that passed validation even if the input file changes",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "captured-input.sql");
      const validatedSql = "-- validated backup\n";
      writeFileSync(inputPath, validatedSql);
      let targetInspectionCount = 0;
      let appliedSql;

      await runRestore({
        confirm: async () => true,
        environment: "local",
        inputPath,
        inspectInput: ({ inputSql }) => {
          assert.equal(inputSql, validatedSql);
          writeFileSync(inputPath, "-- changed after validation\n");
          return compatibleInspection();
        },
        inspectRepository: () => compatibleInspection(),
        inspectTarget: () => {
          targetInspectionCount += 1;
          return compatibleInspection();
        },
        projectRoot: project,
        runApply: ({ sqlPath }) => {
          appliedSql = readFileSync(sqlPath, "utf8");
        },
        runBackup: () => ({ path: "/tmp/pre-restore.sql" }),
        scriptDirectory: join(project, "scripts"),
      });

      assert.equal(targetInspectionCount, 2);
      assert.equal(appliedSql.endsWith(validatedSql), true);
      assert.equal(appliedSql.includes("changed after validation"), false);
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-017",
      "rejects transaction control and attached databases in restore input",
    ),
    async () => {
      const project = makeLatestSchemaProject();
      const baseSql = latestSchemaSql(project);
      for (const [name, suffix] of [
        ["transaction.sql", "BEGIN; COMMIT;"],
        ["attach.sql", "ATTACH DATABASE ':memory:' AS attached;"],
      ]) {
        const inputPath = join(project, name);
        writeFileSync(inputPath, `${baseSql}\n${suffix}\n`);
        let targetInspected = false;

        await assert.rejects(
          () =>
            runRestore({
              environment: "local",
              inputPath,
              inspectTarget: () => {
                targetInspected = true;
              },
              projectRoot: project,
              scriptDirectory: join(project, "scripts"),
            }),
          /入力SQLを復元できません/u,
        );
        assert.equal(targetInspected, false);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-018",
      "preserves a known post-restore inspection failure classification",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "known-readback-failure.sql");
      writeFileSync(inputPath, "-- compatible backup\n");
      let inspectionCount = 0;

      await assert.rejects(
        () =>
          runRestore({
            confirm: async () => true,
            environment: "local",
            inputPath,
            inspectInput: () => compatibleInspection(),
            inspectRepository: () => compatibleInspection(),
            inspectTarget: () => {
              inspectionCount += 1;
              if (inspectionCount === 1) {
                return compatibleInspection();
              }
              throw Object.assign(new Error("known schema mismatch"), {
                resultUnknown: false,
              });
            },
            projectRoot: project,
            runApply: () => {},
            runBackup: () => ({ path: "/tmp/pre-restore.sql" }),
            scriptDirectory: join(project, "scripts"),
          }),
        (error) => {
          assert.equal(error instanceof RestoreExecutionError, true);
          assert.equal(error.resultUnknown, false);
          return true;
        },
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-019",
      "rejects repository-external objects even when their names use the D1 system prefix",
    ),
    async () => {
      const project = makeLatestSchemaProject();
      for (const tableName of [
        "_cf_KV",
        "_cf_METADATA",
        "_cf_unexpected",
      ]) {
        const inputPath = join(project, `${tableName}.sql`);
        writeFileSync(
          inputPath,
          `${latestSchemaSql(project)}\nCREATE TABLE "${tableName}" (id INTEGER);\n`,
        );
        let targetInspected = false;

        await assert.rejects(
          () =>
            runRestore({
              environment: "local",
              inputPath,
              inspectTarget: () => {
                targetInspected = true;
              },
              projectRoot: project,
              scriptDirectory: join(project, "scripts"),
            }),
          /入力SQLとrepositoryのschemaが一致しません/u,
        );
        assert.equal(targetInspected, false);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "RESTORE-UNIT-020",
      "accepts SQL emitted through the existing pnpm backup entrypoint and Wrangler export contract",
    ),
    async () => {
      const project = makeLatestSchemaProject();
      const packageJson = JSON.parse(
        readFileSync(resolve(repositoryRoot, "app", "package.json"), "utf8"),
      );
      assert.match(
        packageJson.scripts.backup,
        /wrangler d1 export taskseq --remote --output/u,
      );
      assert.doesNotMatch(
        packageJson.scripts.backup,
        /database-maintenance|restore/u,
      );
      writeFileSync(
        join(project, "package.json"),
        `${JSON.stringify({
          name: "taskseq-existing-backup-contract-test",
          private: true,
          scripts: { backup: packageJson.scripts.backup },
          type: "module",
        })}\n`,
      );
      const binDirectory = join(project, "node_modules", ".bin");
      mkdirSync(binDirectory, { recursive: true });
      const mockWranglerPath = join(binDirectory, "wrangler");
      const sourceSqlPath = join(project, "wrangler-export.sql");
      const invocationPath = join(project, "wrangler-args.json");
      const backupDirectory = join(project, "pnpm-backups");
      writeFileSync(sourceSqlPath, latestSchemaSql(project));
      writeFileSync(
        mockWranglerPath,
        `#!/usr/bin/env node
import { copyFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(process.env.TASKSEQ_TEST_WRANGLER_ARGS, JSON.stringify(args));
const outputIndex = args.indexOf("--output");
if (outputIndex === -1 || !args[outputIndex + 1]) process.exit(2);
copyFileSync(process.env.TASKSEQ_TEST_WRANGLER_SQL, args[outputIndex + 1]);
`,
        { mode: 0o700 },
      );
      chmodSync(mockWranglerPath, 0o700);

      execFileSync("pnpm", ["run", "backup"], {
        cwd: project,
        env: {
          ...process.env,
          D1_BACKUP_DIR: backupDirectory,
          TASKSEQ_TEST_WRANGLER_ARGS: invocationPath,
          TASKSEQ_TEST_WRANGLER_SQL: sourceSqlPath,
        },
        shell: false,
        stdio: "pipe",
      });
      const invocation = JSON.parse(readFileSync(invocationPath, "utf8"));
      assert.deepEqual(invocation.slice(0, 4), [
        "d1",
        "export",
        "taskseq",
        "--remote",
      ]);
      assert.equal(invocation[4], "--output");
      const backupFiles = readdirSync(backupDirectory);
      assert.equal(backupFiles.length, 1);

      const result = await runRestore({
        confirm: async () => false,
        environment: "local",
        inputPath: join(backupDirectory, backupFiles[0]),
        inspectTarget: ({ repository }) => repository,
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
      });
      assert.equal(result.status, "cancelled");
    },
  );
});

function compatibleInspection({ data, migrations, schemaName = "areas" } = {}) {
  return {
    data: data ?? { areas: [] },
    migrations: migrations ?? ["0001_initial.sql"],
    schema: [
      {
        name: schemaName,
        sql: `CREATE TABLE ${schemaName} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`,
        tbl_name: schemaName,
        type: "table",
      },
    ],
    sequence: [],
  };
}

function restoreManualReviewOutput() {
  return [
    {
      databaseName: "taskseq-local",
      heading: "local restore",
      inputPath: "/Users/owner/Backups/taskseq-local-backup.sql",
      label: "local D1",
    },
    {
      databaseName: "taskseq",
      heading: "remote production restore",
      inputPath: "/Users/owner/Backups/taskseq-remote-backup.sql",
      label: "remote D1",
    },
  ]
    .map(({ databaseName, heading, inputPath, label }) => {
      const view = formatRestoreConfirmation({
        databaseName,
        environmentConfig: { label },
        inputPath,
      });
      return `[${heading}]\n${view.message}${view.prompt}`;
    })
    .join("\n\n");
}

function makeProject(environment = "local") {
  const root = mkdtempSync(join(tmpdir(), "taskseq-maintenance-restore-"));
  temporaryDirectories.push(root);
  const backupDirectory = mkdtempSync(
    join(tmpdir(), "taskseq-maintenance-restore-output-"),
  );
  temporaryDirectories.push(backupDirectory);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "app", "migrations"), { recursive: true });
  writeFileSync(
    join(root, "scripts", `.env.${environment}`),
    `D1_DATABASE_NAME=${environment === "local-test" ? "case-local-test" : "taskseq-local"}\nD1_BACKUP_DIR=${backupDirectory}\n`,
  );
  writeFileSync(
    join(root, "app", "migrations", "0001_initial.sql"),
    "CREATE TABLE areas (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n",
  );
  return root;
}

function makeLatestSchemaProject() {
  const root = makeProject();
  const migrationDirectory = join(root, "app", "migrations");
  rmSync(migrationDirectory, { force: true, recursive: true });
  cpSync(join(repositoryRoot, "app", "migrations"), migrationDirectory, {
    recursive: true,
  });
  return root;
}

function migrationNames(project) {
  return readdirSync(join(project, "app", "migrations"))
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function latestSchemaSql(project, names = migrationNames(project)) {
  const migrationDirectory = join(project, "app", "migrations");
  return [
    "PRAGMA foreign_keys=ON;",
    'CREATE TABLE "d1_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);',
    ...names.flatMap((name, index) => [
      readFileSync(join(migrationDirectory, name), "utf8"),
      `INSERT INTO d1_migrations (id, name, applied_at) VALUES (${index + 1}, '${name}', '2026-09-08 00:00:00');`,
    ]),
  ].join("\n");
}
