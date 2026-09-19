import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe } from "node:test";

import {
  assertExportSchema,
  runExport,
  runWranglerExportQuery,
  validateExportDocument,
} from "../database-maintenance/export.mjs";
import {
  parseArguments,
  runCli,
} from "../database-maintenance/export-cli.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const temporaryDirectories = [];
const caseMeta = createCaseMetadata("export", "unit");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("task JSON export", () => {
  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-001",
      "writes every editable field without management metadata",
    ),
    () => {
      const project = makeProject();
      const outputDirectory = makeExternalDirectory();
      writeConfig(project, "local", outputDirectory);

      const result = runExport({
        environment: "local",
        now: () => new Date("2026-09-09T01:02:03.004Z"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runQuery() {
          return [
            {
              area: "Work",
              description: "quoted \"text\"\n次の行;",
              due: "2026-09-10T03:04:05+09:00",
              id: "child-id",
              parentId: "parent-id",
              recurrenceRule: "mon, wed",
              start: "2026-09-09",
              tag: "alpha",
              title: "子Task",
              workNotes: "作業中",
            },
            {
              area: "Work",
              description: "quoted \"text\"\n次の行;",
              due: "2026-09-10T03:04:05+09:00",
              id: "child-id",
              parentId: "parent-id",
              recurrenceRule: "mon, wed",
              start: "2026-09-09",
              tag: "beta",
              title: "子Task",
              workNotes: "作業中",
            },
            {
              area: "Inbox",
              description: "",
              due: null,
              id: "parent-id",
              parentId: null,
              recurrenceRule: null,
              start: null,
              tag: null,
              title: "Parent",
              workNotes: "",
            },
          ];
        },
        validate() {},
        verifySchema() {},
      });

      assert.match(
        result.path,
        /local-export-20260909-010203-004Z\.json$/u,
      );
      assert.deepEqual(JSON.parse(readFileSync(result.path, "utf8")), {
        tasks: [
          {
            id: "child-id",
            title: "子Task",
            description: "quoted \"text\"\n次の行;",
            workNotes: "作業中",
            area: "Work",
            parentId: "parent-id",
            start: "2026-09-09",
            due: "2026-09-10T03:04:05+09:00",
            recurrenceRule: "mon, wed",
            tags: ["alpha", "beta"],
          },
          {
            id: "parent-id",
            title: "Parent",
            description: "",
            workNotes: "",
            area: "Inbox",
            parentId: null,
            start: null,
            due: null,
            recurrenceRule: null,
            tags: [],
          },
        ],
      });
    },
  );

  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-002",
      "queries the fixed remote target read-only and parses Wrangler JSON",
    ),
    () => {
      const calls = [];
      const environmentConfig = {
        childEnvironment: { CLOUDFLARE_ACCOUNT_ID: "account" },
        databaseName: "taskseq",
        scope: "--remote",
      };

      const rows = runWranglerExportQuery(
        environmentConfig,
        "/project/app",
        "/tmp/wrangler.json",
        (command, args, options) => {
          calls.push({ args, command, options });
          return JSON.stringify([
            {
              results: [
                {
                  area: "Inbox",
                  description: "",
                  due: null,
                  id: "task-1",
                  parentId: null,
                  recurrenceRule: null,
                  start: null,
                  tag: null,
                  title: "Task",
                  workNotes: "",
                },
              ],
              success: true,
            },
          ]);
        },
      );

      assert.equal(calls[0].command, "pnpm");
      assert.deepEqual(calls[0].args.slice(0, 5), [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "taskseq",
      ]);
      assert.equal(calls[0].args.includes("--remote"), true);
      assert.equal(calls[0].args.includes("--json"), true);
      assert.equal(calls[0].options.cwd, "/project/app");
      assert.equal(
        calls[0].options.env.CLOUDFLARE_ACCOUNT_ID,
        "account",
      );
      const sql = calls[0].args[calls[0].args.indexOf("--command") + 1];
      assert.match(sql, /WHERE t\.trashed_at IS NULL/u);
      assert.match(sql, /LEFT JOIN areas AS a/u);
      assert.doesNotMatch(sql, /t\.status\s*=/u);
      assert.deepEqual(rows, [
        {
          area: "Inbox",
          description: "",
          due: null,
          id: "task-1",
          parentId: null,
          recurrenceRule: null,
          start: null,
          tag: null,
          title: "Task",
          workNotes: "",
        },
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-003",
      "validates the generated document against the update JSON Schema",
    ),
    () => {
      const schemaPath = resolve(
        import.meta.dirname,
        "../database-maintenance/schemas/task-update.schema.json",
      );
      const valid = {
        tasks: [
          {
            id: "task-1",
            title: "Task",
            description: "",
            workNotes: "",
            area: "Inbox",
            parentId: null,
            start: "2026-09-09",
            due: null,
            recurrenceRule: null,
            tags: [],
          },
        ],
      };

      assert.doesNotThrow(() =>
        validateExportDocument(valid, schemaPath),
      );
      assert.throws(
        () =>
          validateExportDocument(
            { ...valid, tasks: [{ ...valid.tasks[0], title: null }] },
            schemaPath,
          ),
        /更新用JSON Schemaに一致しません/u,
      );
      assert.throws(
        () =>
          validateExportDocument(
            {
              ...valid,
              tasks: [{ ...valid.tasks[0], start: "2026-02-30" }],
            },
            schemaPath,
          ),
        /更新用JSON Schemaに一致しません/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-004",
      "does not overwrite a same-timestamp JSON export",
    ),
    () => {
      const project = makeProject();
      const outputDirectory = makeExternalDirectory();
      writeConfig(project, "local", outputDirectory);
      const options = {
        environment: "local",
        now: () => new Date("2026-09-09T01:02:03.004Z"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runQuery: () => [],
        validate() {},
        verifySchema() {},
      };

      const first = runExport(options);
      const second = runExport(options);

      assert.notEqual(first.path, second.path);
      assert.match(second.path, /local-export-20260909-010203-004Z-1\.json$/u);
      assert.deepEqual(JSON.parse(readFileSync(first.path, "utf8")), {
        tasks: [],
      });
    },
  );

  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-005",
      "provides fixed-environment CLI help and reports the saved path without prompting",
    ),
    () => {
      assert.deepEqual(parseArguments(["--environment", "local"]), {
        environment: "local",
        help: false,
      });
      assert.throws(
        () => parseArguments(["--environment", "production"]),
        /localまたはremote/u,
      );

      let output = "";
      const exitCode = runCli(
        ["--environment", "remote"],
        {
          output: { write: (text) => (output += text) },
          errorOutput: { write() {} },
        },
        ({ environment }) => ({
          environment,
          path: "/outside/remote-export.json",
        }),
      );

      assert.equal(exitCode, 0);
      assert.equal(output, "exportを保存しました: /outside/remote-export.json\n");

      const repositoryRoot = resolve(import.meta.dirname, "../..");
      for (const [entrypoint, environment] of [
        ["local-export.sh", "local"],
        ["remote-export.sh", "remote"],
      ]) {
        const path = join(repositoryRoot, "scripts", entrypoint);
        assert.equal(existsSync(path), true);
        assert.notEqual(statSync(path).mode & 0o111, 0);
        const source = readFileSync(path, "utf8");
        assert.match(source, new RegExp(`--environment ${environment}`, "u"));
        assert.match(source, /export-cli\.mjs/u);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-006",
      "does not leave a successful or partial file after Schema or output failure",
    ),
    () => {
      const project = makeProject();
      const outputDirectory = makeExternalDirectory();
      const appDirectory = resolve(import.meta.dirname, "../../app");
      const schemaPath = resolve(
        import.meta.dirname,
        "../database-maintenance/schemas/task-update.schema.json",
      );
      writeConfig(project, "local", outputDirectory);

      assert.throws(
        () =>
          runExport({
            appDirectory,
            environment: "local",
            projectRoot: project,
            runQuery: () => [
              {
                area: "Inbox",
                description: "",
                due: null,
                id: "",
                parentId: null,
                recurrenceRule: null,
                start: null,
                tag: null,
                title: "Task",
                workNotes: "",
              },
            ],
            schemaPath,
            scriptDirectory: join(project, "scripts"),
            verifySchema() {},
          }),
        /更新用JSON Schemaに一致しません/u,
      );
      assert.deepEqual(readdirSync(outputDirectory), []);

      assert.throws(() =>
        runExport({
          environment: "local",
          projectRoot: project,
          runQuery() {
            rmSync(outputDirectory, { recursive: true });
            return [];
          },
          scriptDirectory: join(project, "scripts"),
          validate() {},
          verifySchema() {},
        }),
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-007",
      "rejects malformed Wrangler result JSON instead of treating it as an empty database",
    ),
    () => {
      assert.throws(
        () =>
          runWranglerExportQuery(
            {
              childEnvironment: {},
              databaseName: "taskseq-local",
              scope: "--local",
            },
            "/project/app",
            undefined,
            () => JSON.stringify({ success: true }),
          ),
        /Wrangler export query JSONが不正です/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "EXPORT-UNIT-008",
      "stops before the Task query when the target schema is behind the repository",
    ),
    () => {
      const project = makeProject();

      assert.throws(
        () =>
          assertExportSchema({
            appDirectory: join(project, "app"),
            environmentConfig: {
              childEnvironment: {},
              databaseName: "taskseq-local",
              scope: "--local",
            },
            migrationDirectory: join(project, "app", "migrations"),
            runQuery: () => ({ names: [], tableExists: false }),
          }),
        /schemaがrepositoryと一致しない.*通常のmigration／deployment手順/su,
      );
    },
  );
});

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "taskseq-export-unit-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "app", "migrations"), { recursive: true });
  writeFileSync(
    join(root, "app", "migrations", "0001_example.sql"),
    "CREATE TABLE example (id INTEGER);\n",
  );
  return root;
}

function makeExternalDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "taskseq-export-output-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeConfig(project, environment, outputDirectory) {
  writeFileSync(
    join(project, "scripts", `.env.${environment}`),
    `D1_DATABASE_NAME=taskseq-${environment}\nD1_BACKUP_DIR=${outputDirectory}\n`,
  );
}
