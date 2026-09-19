import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe } from "node:test";

import {
  askForConfirmation,
  assertImportReadback,
  createImportPlan,
  formatImportConfirmation,
  ImportExecutionError,
  inspectImportReadback,
  inspectImportTarget,
  runImport,
  runWranglerImport,
  validateImportDocument,
} from "../database-maintenance/import.mjs";
import {
  parseArguments as parseImportArguments,
  runCli as runImportCli,
} from "../database-maintenance/import-cli.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
  manualMaintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const temporaryDirectories = [];
const caseMeta = createCaseMetadata("import", "unit");
const repositoryRoot = resolve(import.meta.dirname, "../..");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("task JSON import", () => {
  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-001",
      "validates and plans a minimal import before cancellation without backup or write",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "tasks.json");
      writeFileSync(inputPath, JSON.stringify({ tasks: [{ title: "Task" }] }));
      const events = [];

      const result = await runImport({
        confirm: async () => {
          events.push("confirm");
          return false;
        },
        environment: "local",
        inputPath,
        inspectTarget: () => {
          events.push("inspect-target");
          return emptyTarget();
        },
        projectRoot: project,
        runApply: () => events.push("apply"),
        runBackup: () => events.push("backup"),
        verifySchema: () => events.push("verify-schema"),
        verifyTargetSchema: () => events.push("verify-target-schema"),
        scriptDirectory: join(project, "scripts"),
      });

      assert.equal(result.status, "cancelled");
      assert.deepEqual(events, [
        "verify-schema",
        "verify-target-schema",
        "inspect-target",
        "confirm",
      ]);
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-002",
      "normalizes defaults, Area and Tag names, and inherited parent locations",
    ),
    () => {
      const target = emptyTarget();
      target.areas.push({
        color: "green",
        id: 2,
        isSystemManaged: false,
        name: "Work",
        position: 4,
        trashedAt: null,
      });
      target.tags = [{ id: 1, name: "existing" }];
      target.tasks.push({
        areaId: 2,
        id: "existing-parent",
        parentId: null,
        recurrenceRule: null,
        status: "OPEN",
        trashedAt: null,
      });
      let id = 0;

      const plan = createImportPlan(
        {
          areas: [{ name: " New Area ", color: "purple" }],
          tags: [" Standalone ", "standalone"],
          tasks: [
            {
              title: " Parent child ",
              parentId: "existing-parent",
              area: " Work ",
              tags: [" Existing ", "NEW", "new"],
              children: [{ title: " Nested " }],
            },
            { title: " Inbox task " },
          ],
        },
        target,
        {
          createId: () => `new-${++id}`,
          now: () => new Date("2026-09-09T01:02:03.000Z"),
        },
      );

      assert.deepEqual(plan.newAreas, [
        { color: "purple", name: "New Area", position: 5 },
      ]);
      assert.deepEqual(plan.newTags, ["standalone", "new"]);
      assert.deepEqual(
        plan.tasks.map((task) => ({
          areaId: task.areaId,
          description: task.description,
          due: task.due,
          id: task.id,
          parentId: task.parentId,
          recurrenceRule: task.recurrenceRule,
          start: task.start,
          tags: task.tags,
          title: task.title,
          workNotes: task.workNotes,
        })),
        [
          {
            areaId: 2,
            description: "",
            due: null,
            id: "new-1",
            parentId: "existing-parent",
            recurrenceRule: null,
            start: null,
            tags: ["existing", "new"],
            title: "Parent child",
            workNotes: "",
          },
          {
            areaId: 2,
            description: "",
            due: null,
            id: "new-2",
            parentId: "new-1",
            recurrenceRule: null,
            start: null,
            tags: [],
            title: "Nested",
            workNotes: "",
          },
          {
            areaId: 1,
            description: "",
            due: null,
            id: "new-3",
            parentId: null,
            recurrenceRule: null,
            start: null,
            tags: [],
            title: "Inbox task",
            workNotes: "",
          },
        ],
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-003",
      "normalizes a valid Recurrence Rule using the execution target Owner timezone",
    ),
    () => {
      const target = emptyTarget();
      target.ownerTimeZone = "America/Los_Angeles";

      const plan = createImportPlan(
        {
          tasks: [
            {
              title: "Recurring",
              start: "2026-09-09",
              due: "2026-09-09",
              recurrenceRule: "wed, mon",
            },
            {
              title: "Mixed dates",
              start: "2026-09-09T23:30:00Z",
              due: "2026-09-09",
            },
          ],
        },
        target,
        {
          createId: () => crypto.randomUUID(),
          now: () => new Date("2026-09-09T01:02:03.000Z"),
        },
      );

      assert.equal(plan.tasks[0].recurrenceRule, "mon, wed");
      assert.equal(plan.tasks[0].start, "2026-09-09");
      assert.equal(plan.tasks[1].due, "2026-09-09");
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-004",
      "rejects domain-invalid names, parent trees, dates, recurrence, and generated IDs",
    ),
    () => {
      const workArea = {
        color: "green",
        id: 2,
        isSystemManaged: false,
        name: "Work",
        position: 1,
        trashedAt: null,
      };
      const makeTarget = () => {
        const target = emptyTarget();
        target.areas.push(workArea);
        return target;
      };
      const cases = [
        [
          { areas: [{ name: "Work" }, { name: " Work " }], tasks: [] },
          makeTarget(),
          /Area定義が重複/u,
        ],
        [
          { tasks: [{ title: "Task", area: "Archived" }] },
          {
            ...makeTarget(),
            areas: [
              ...makeTarget().areas,
              {
                color: "blue",
                id: 3,
                isSystemManaged: false,
                name: "Archived",
                position: 2,
                trashedAt: "2026-09-01T00:00:00Z",
              },
            ],
          },
          /Trash内に同名Area/u,
        ],
        [
          { tasks: [{ title: "Task", parentId: "parent", area: "Inbox" }] },
          {
            ...makeTarget(),
            tasks: [existingTask("parent", 2)],
          },
          /同じ/u,
        ],
        [
          {
            tasks: [
              {
                title: "Parent",
                area: "New parent area",
                children: [{ title: "Child", area: "New child area" }],
              },
            ],
          },
          makeTarget(),
          /同じ/u,
        ],
        [
          { tasks: [{ title: "Task", parentId: "parent" }] },
          {
            ...makeTarget(),
            tasks: [
              { ...existingTask("ancestor", 2), status: "COMPLETED" },
              { ...existingTask("parent", 2), parentId: "ancestor" },
            ],
          },
          /Completed/u,
        ],
        [
          { tasks: [{ title: "Level 6", parentId: "level-5" }] },
          {
            ...makeTarget(),
            tasks: [1, 2, 3, 4, 5].map((level) => ({
              ...existingTask(`level-${level}`, 2),
              parentId: level === 1 ? null : `level-${level - 1}`,
            })),
          },
          /5階層/u,
        ],
        [
          {
            tasks: [{ title: "Bad date", start: "2026-02-30T09:00:00+09:00" }],
          },
          makeTarget(),
          /実在する日時/u,
        ],
        [
          {
            tasks: [
              {
                title: "Bad range",
                start: "2026-09-10T00:00:00Z",
                due: "2026-09-09T23:59:59Z",
              },
            ],
          },
          makeTarget(),
          /DueをStartより前/u,
        ],
        [
          {
            tasks: [
              {
                title: "Bad repeat",
                start: "2026-09-10",
                recurrenceRule: "wed",
              },
            ],
          },
          makeTarget(),
          /一致しません/u,
        ],
      ];

      for (const [document, target, expected] of cases) {
        assert.throws(() => createImportPlan(document, target), expected);
      }

      assert.throws(
        () =>
          createImportPlan(
            { tasks: [{ title: "One" }, { title: "Two" }] },
            makeTarget(),
            { createId: () => "duplicate-id" },
          ),
        /Task IDが重複/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-005",
      "backs up and applies one injection-safe SQL file before readback",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "special.json");
      writeFileSync(
        inputPath,
        JSON.stringify({
          areas: [{ name: "Area'; DROP TABLE tasks;\n雪", color: "orange" }],
          tasks: [
            {
              title: "Quote ' and semicolon;\nUnicode 🧪",
              description: "NUL \u0000 is data",
              area: "Area'; DROP TABLE tasks;\n雪",
              tags: ["Tag'; --"],
            },
          ],
        }),
      );
      const events = [];
      let appliedSql;
      const inputBytes = statSync(inputPath).size;

      const result = await runImport({
        confirm: async () => {
          events.push("confirm");
          return true;
        },
        createId: () => "new-task-id",
        environment: "local",
        inputPath,
        inspectTarget: () => {
          events.push("inspect-target");
          return emptyTarget();
        },
        now: () => new Date("2026-09-09T01:02:03.000Z"),
        projectRoot: project,
        runApply: ({ sqlPath }) => {
          events.push("apply");
          appliedSql = readFileSync(sqlPath, "utf8");
          unlinkSync(inputPath);
        },
        runBackup: ({ operation }) => {
          events.push(`backup-${operation}`);
          return { path: "/tmp/local-import.sql" };
        },
        runVerify: () => {
          events.push("readback");
          return { taskIds: ["new-task-id"] };
        },
        scriptDirectory: join(project, "scripts"),
        verifyReadback: () => {},
        verifySchema: () => events.push("verify-input-schema"),
        verifyTargetSchema: () => events.push("verify-target-schema"),
      });

      assert.equal(result.status, "applied");
      assert.equal(result.backupPath, "/tmp/local-import.sql");
      assert.equal(result.metrics.inputBytes, inputBytes);
      assert.equal(result.metrics.executionRoute, "wrangler d1 execute --file");
      assert.ok(result.metrics.maximumStatementBytes > 0);
      assert.ok(
        result.metrics.maximumStatementBytes <= result.metrics.sqlBytes,
      );
      assert.equal(result.metrics.statementCount, 7);
      assert.deepEqual(events, [
        "verify-input-schema",
        "verify-target-schema",
        "inspect-target",
        "confirm",
        "backup-import",
        "apply",
        "readback",
      ]);
      assert.doesNotMatch(appliedSql, /DROP TABLE tasks/u);
      assert.doesNotMatch(appliedSql, /Quote ' and semicolon/u);
      assert.doesNotMatch(appliedSql, /BEGIN|COMMIT/u);
      assert.match(appliedSql, /INSERT INTO areas/u);
      assert.match(appliedSql, /INSERT INTO tasks/u);
      assert.match(appliedSql, /INSERT INTO task_tags/u);
      assert.match(appliedSql, /CAST\(X'[0-9a-f]+' AS TEXT\)/u);
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-006",
      "uses fixed Wrangler scope for target inspection and atomic file execution",
    ),
    async () => {
      const calls = [];
      const environmentConfig = {
        childEnvironment: { CLOUDFLARE_ACCOUNT_ID: "account" },
        databaseName: "taskseq",
        scope: "--remote",
      };
      const target = inspectImportTarget({
        appDirectory: "/project/app",
        configPath: "/tmp/wrangler.json",
        environmentConfig,
        runQuery: ({ sql }) => {
          calls.push({ kind: "query", sql });
          return [
            [
              {
                id: 1,
                name: "Inbox",
                color: "gray",
                position: 0,
                isSystemManaged: 1,
                trashedAt: null,
              },
            ],
            [{ id: 2, name: "tag" }],
            [
              {
                id: "task",
                areaId: 1,
                parentId: null,
                status: "OPEN",
                recurrenceRule: null,
                trashedAt: null,
              },
            ],
            [{ ownerTimeZone: "Asia/Tokyo" }],
          ];
        },
      });
      runWranglerImport({
        appDirectory: "/project/app",
        configPath: "/tmp/wrangler.json",
        environmentConfig,
        sqlPath: "/tmp/import.sql",
        execFile(command, args, options) {
          calls.push({ args, command, kind: "apply", options });
          return "ok";
        },
      });

      assert.equal(target.ownerTimeZone, "Asia/Tokyo");
      assert.equal(target.areas[0].isSystemManaged, true);
      assert.match(calls[0].sql, /FROM areas/u);
      assert.match(calls[0].sql, /FROM owner_settings/u);
      assert.doesNotMatch(calls[0].sql, /FROM task_tags/u);
      assert.deepEqual(calls[1].args.slice(0, 6), [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "taskseq",
        "--remote",
      ]);
      assert.equal(calls[1].args.includes("--file"), true);
      assert.equal(calls[1].args.includes("--yes"), true);
      assert.equal(calls[1].args.includes("--config"), true);
      assert.equal(calls[1].options.cwd, "/project/app");
      assert.equal(calls[1].options.env.CLOUDFLARE_ACCOUNT_ID, "account");
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-007",
      "verifies imported Area, Tag, Task management fields, and relations from readback",
    ),
    () => {
      const plan = createImportPlan(
        {
          areas: [{ name: "New", color: "pink" }],
          tasks: [{ title: "Task", area: "New", tags: ["Tag"] }],
        },
        emptyTarget(),
        {
          createId: () => "new-id",
          now: () => new Date("2026-09-09T01:02:03.000Z"),
        },
      );
      const readback = {
        areas: [
          ...emptyTarget().areas,
          {
            color: "pink",
            id: 9,
            isSystemManaged: false,
            name: "New",
            position: 1,
            trashedAt: null,
          },
        ],
        ownerTimeZone: "Asia/Tokyo",
        tags: [{ id: 4, name: "tag" }],
        taskTags: [{ taskId: "new-id", tagName: "tag" }],
        tasks: [
          {
            areaId: 9,
            completedAt: null,
            createdAt: "2026-09-09T01:02:03.000Z",
            description: "",
            due: null,
            generatedFromTaskId: null,
            id: "new-id",
            parentId: null,
            recurrenceRule: null,
            start: null,
            status: "OPEN",
            title: "Task",
            trashOperationId: null,
            trashedAt: null,
            updatedAt: "2026-09-09T01:02:03.000Z",
            version: 1,
            workNotes: "",
          },
        ],
      };

      assert.doesNotThrow(() => assertImportReadback(readback, plan));
      readback.tasks[0].version = 2;
      assert.throws(() => assertImportReadback(readback, plan), /version/u);
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-008",
      "parses one input path and reports applied, cancelled, and unknown CLI outcomes",
    ),
    async () => {
      assert.deepEqual(
        parseImportArguments(["--environment", "local", "tasks.json"]),
        {
          environment: "local",
          help: false,
          inputPath: "tasks.json",
        },
      );
      assert.equal(parseImportArguments(["--help"]).help, true);
      assert.throws(
        () => parseImportArguments(["--environment", "remote"]),
        /JSON入力パス/u,
      );
      assert.throws(
        () =>
          parseImportArguments(["--environment", "local", "a.json", "b.json"]),
        /1つ/u,
      );

      let outputText = "";
      let errorText = "";
      const output = { write: (value) => (outputText += value) };
      const errorOutput = { write: (value) => (errorText += value) };
      let received;
      const exitCode = await runImportCli(
        ["--environment", "remote", "tasks.json"],
        { errorOutput, input: new PassThrough(), output },
        async (options) => {
          received = options;
          return {
            backupPath: "/tmp/backup.sql",
            databaseName: "taskseq",
            label: "remote D1",
            metrics: { inputBytes: 1, sqlBytes: 2, taskCount: 3 },
            status: "applied",
          };
        },
      );

      assert.equal(exitCode, 0);
      assert.equal(received.environment, "remote");
      assert.equal(received.inputPath, "tasks.json");
      assert.match(outputText, /3 Task/u);
      assert.equal(errorText, "");
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-009",
      "keeps the example, JSON Schema, defaults, and runtime validation aligned",
    ),
    () => {
      const schemaPath = resolve(
        repositoryRoot,
        "scripts/database-maintenance/schemas/task-import.schema.json",
      );
      const example = JSON.parse(
        readFileSync(
          resolve(
            repositoryRoot,
            "scripts/database-maintenance/examples/task-import.json",
          ),
          "utf8",
        ),
      );
      assert.doesNotThrow(() => validateImportDocument(example, schemaPath));
      assert.doesNotThrow(() =>
        validateImportDocument(
          { areas: [{ name: "Area" }], tags: ["tag"], tasks: [] },
          schemaPath,
        ),
      );
      for (const invalid of [
        {},
        { tasks: [{ title: "Task", unknown: true }] },
        {
          tasks: [
            { title: "Task", children: [{ title: "Child", parentId: "x" }] },
          ],
        },
        { tasks: [{ title: "Task", tags: null }] },
      ]) {
        assert.throws(
          () => validateImportDocument(invalid, schemaPath),
          /JSON Schema/u,
        );
      }
      const plan = createImportPlan(example, emptyTarget(), {
        now: () => new Date("2026-09-09T00:00:00Z"),
      });
      assert.equal(plan.tasks.length, 4);
      assert.equal(plan.tasks[1].workNotes, "");
      assert.equal(plan.tasks[1].start, null);
      assert.deepEqual(plan.tasks[1].tags, ["preset"]);
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-010",
      "does not write after backup failure and classifies known, unknown, and readback failures without retry",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "tasks.json");
      writeFileSync(inputPath, JSON.stringify({ tasks: [{ title: "Task" }] }));
      const base = {
        confirm: async () => true,
        environment: "local",
        inputPath,
        inspectTarget: () => emptyTarget(),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        verifySchema: () => {},
        verifyTargetSchema: () => {},
      };
      let applyCount = 0;
      await assert.rejects(
        () =>
          runImport({
            ...base,
            runApply: () => {
              applyCount += 1;
            },
            runBackup: () => {
              throw new Error("backup failed");
            },
          }),
        /backup failed/u,
      );
      assert.equal(applyCount, 0);

      for (const [failure, resultUnknown] of [
        [
          Object.assign(new Error("SQLITE_CONSTRAINT"), {
            code: "SQLITE_CONSTRAINT",
          }),
          false,
        ],
        [Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), true],
      ]) {
        applyCount = 0;
        await assert.rejects(
          () =>
            runImport({
              ...base,
              runApply: () => {
                applyCount += 1;
                throw failure;
              },
              runBackup: () => ({ path: "/tmp/import.sql" }),
            }),
          (error) => {
            assert.equal(error instanceof ImportExecutionError, true);
            assert.equal(error.resultUnknown, resultUnknown);
            return true;
          },
        );
        assert.equal(applyCount, 1);
      }

      await assert.rejects(
        () =>
          runImport({
            ...base,
            runApply: () => {},
            runBackup: () => ({ path: "/tmp/import.sql" }),
            runVerify: () => {
              throw new Error("bad JSON");
            },
          }),
        (error) => {
          assert.equal(error instanceof ImportExecutionError, true);
          assert.equal(error.resultUnknown, true);
          return true;
        },
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-011",
      "shows target, input, additive scope, and accepts only y or Y",
    ),
    async () => {
      const details = {
        databaseName: "taskseq-local",
        environmentConfig: { label: "local D1" },
        inputPath: "/data/tasks.json",
        plan: { newAreas: [{}], newTags: [{}, {}], tasks: [{}, {}, {}] },
      };
      const view = formatImportConfirmation(details);
      assert.match(view.message, /local D1 \(taskseq-local\)/u);
      assert.match(view.message, /\/data\/tasks\.json/u);
      assert.match(view.message, /1 Area \/ 2 Tag \/ 3 Task/u);
      assert.match(view.message, /上書きせず新規登録/u);

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
      "IMPORT-UNIT-012",
      "provides executable fixed local and remote entrypoints",
    ),
    () => {
      for (const [name, environment] of [
        ["local-import.sh", "local"],
        ["remote-import.sh", "remote"],
      ]) {
        const path = resolve(repositoryRoot, "scripts", name);
        assert.equal(existsSync(path), true);
        assert.notEqual(statSync(path).mode & 0o111, 0);
        const source = readFileSync(path, "utf8");
        assert.match(source, new RegExp(`--environment ${environment}`, "u"));
        assert.match(source, /import-cli\.mjs/u);
      }
    },
  );

  manualMaintenanceCase({
    ...caseMeta(
      "IMPORT-UNIT-013",
      "Owner confirms that import target, input, additive scope, and duplicate behavior are unambiguous",
    ),
    acceptedReviewRevision: "import-confirmation-v1",
    reviewOutput: importManualReviewOutput(),
    reviewRevision: "import-confirmation-v1",
  });

  maintenanceCase(
    caseMeta(
      "IMPORT-UNIT-014",
      "reads imported Tasks back in bounded chunks instead of buffering the whole database",
    ),
    () => {
      const calls = [];
      const plan = {
        newAreas: [],
        newTags: [],
        tasks: Array.from({ length: 1_005 }, (_, index) => ({
          id: `id-${index}`,
        })),
      };
      const readback = inspectImportReadback({
        plan,
        runQuery: ({ sql }) => {
          calls.push(sql);
          if (sql.includes("FROM owner_settings")) {
            return [[{ ownerTimeZone: "Asia/Tokyo" }]];
          }
          return [[], []];
        },
      });

      assert.equal(calls.length, 4);
      assert.equal(readback.ownerTimeZone, "Asia/Tokyo");
      for (const sql of calls.slice(1)) {
        assert.ok((sql.match(/CAST\(X'/gu) ?? []).length <= 1_000);
        assert.match(sql, /WHERE id IN/u);
        assert.doesNotMatch(sql, /FROM areas ORDER BY id/u);
      }
    },
  );
});

function makeProject() {
  const project = mkdtempSync(join(tmpdir(), "taskseq-import-unit-"));
  const backupDirectory = mkdtempSync(
    join(tmpdir(), "taskseq-import-backups-"),
  );
  temporaryDirectories.push(project);
  temporaryDirectories.push(backupDirectory);
  mkdirSync(join(project, "scripts"));
  writeFileSync(
    join(project, "scripts", ".env.local"),
    `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${backupDirectory}\n`,
  );
  return project;
}

function emptyTarget() {
  return {
    areas: [
      {
        color: "gray",
        id: 1,
        isSystemManaged: true,
        name: "Inbox",
        position: 0,
        trashedAt: null,
      },
    ],
    ownerTimeZone: "Asia/Tokyo",
    tags: [],
    tasks: [],
  };
}

function existingTask(id, areaId) {
  return {
    areaId,
    id,
    parentId: null,
    recurrenceRule: null,
    status: "OPEN",
    trashedAt: null,
  };
}

function importManualReviewOutput() {
  return [
    "[local sample]",
    `${
      formatImportConfirmation({
        databaseName: "taskseq-local",
        environmentConfig: { label: "local D1" },
        inputPath: "/path/to/tasks.json",
        plan: { newAreas: [{}], newTags: [{}, {}], tasks: [{}, {}, {}] },
      }).message
    }${
      formatImportConfirmation({
        databaseName: "taskseq-local",
        environmentConfig: { label: "local D1" },
        inputPath: "/path/to/tasks.json",
        plan: { newAreas: [{}], newTags: [{}, {}], tasks: [{}, {}, {}] },
      }).prompt
    }`,
    "[remote sample]",
    `${
      formatImportConfirmation({
        databaseName: "taskseq",
        environmentConfig: { label: "remote D1" },
        inputPath: "/path/to/tasks.json",
        plan: { newAreas: [{}], newTags: [{}, {}], tasks: [{}, {}, {}] },
      }).message
    }${
      formatImportConfirmation({
        databaseName: "taskseq",
        environmentConfig: { label: "remote D1" },
        inputPath: "/path/to/tasks.json",
        plan: { newAreas: [{}], newTags: [{}, {}], tasks: [{}, {}, {}] },
      }).prompt
    }`,
  ].join("\n");
}
