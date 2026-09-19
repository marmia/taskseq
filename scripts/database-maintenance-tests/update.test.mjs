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
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe } from "node:test";

import {
  askForConfirmation,
  buildUpdateSql,
  createUpdatePlan,
  formatUpdateConfirmation,
  inspectUpdateReadback,
  inspectUpdateTarget,
  runUpdate,
  UpdateExecutionError,
  validateUpdateDocument,
} from "../database-maintenance/update.mjs";
import {
  parseArguments as parseUpdateArguments,
  runCli as runUpdateCli,
} from "../database-maintenance/update-cli.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
  manualMaintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const caseMeta = createCaseMetadata("update", "unit");
const temporaryDirectories = [];
const updateSchemaPath = resolve(
  import.meta.dirname,
  "../database-maintenance/schemas/task-update.schema.json",
);

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("task JSON update", () => {
  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-001",
      "plans partial updates and skips unknown or trashed target IDs",
    ),
    () => {
      const target = baseTarget();
      target.tasks.push(
        task("active", { description: "before", tags: ["old"] }),
        task("trashed", { trashedAt: "2026-09-01T00:00:00.000Z" }),
      );

      const plan = createUpdatePlan(
        {
          tasks: [
            { id: "active", description: "after" },
            { id: "missing", title: "Input title" },
            { id: "trashed" },
          ],
        },
        target,
        { now: () => new Date("2026-09-11T01:02:03.000Z") },
      );

      assert.equal(plan.tasks.length, 1);
      assert.deepEqual(
        {
          description: plan.tasks[0].description,
          due: plan.tasks[0].due,
          id: plan.tasks[0].id,
          title: plan.tasks[0].title,
          updatedAt: plan.tasks[0].updatedAt,
          version: plan.tasks[0].version,
          workNotes: plan.tasks[0].workNotes,
        },
        {
          description: "after",
          due: null,
          id: "active",
          title: "Task active",
          updatedAt: "2026-09-11T01:02:03.000Z",
          version: 4,
          workNotes: "notes",
        },
      );
      assert.deepEqual(plan.skipped, [
        { id: "missing", reason: "Taskが見つかりません", title: "Input title" },
        { id: "trashed", reason: "Trash内のTaskです", title: "(未指定)" },
      ]);
      assert.deepEqual(plan.tagUpdates, []);
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-014",
      "clears an explicit parent and replaces Tags without deleting Tag records",
    ),
    () => {
      const target = baseTarget();
      target.tasks.push(
        task("parent"),
        task("child", { parentId: "parent", tags: ["old"] }),
      );
      const plan = createUpdatePlan(
        { tasks: [{ id: "child", parentId: null, tags: [] }] },
        target,
      );
      assert.equal(plan.tasks[0].parentId, null);
      assert.deepEqual(plan.tasks[0].tags, []);
      assert.deepEqual(plan.newTags, []);
      assert.deepEqual(plan.relocations, [
        {
          areaId: 1,
          areaName: "Inbox",
          id: "child",
          parentId: null,
        },
      ]);
      assert.match(
        buildUpdateSql(plan),
        /INSERT INTO task_manual_orders[^\n]+CAST\(X'696e626f78' AS TEXT\)/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-008",
      "stops before writing when the required pre-update backup fails",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "tasks.json");
      writeFileSync(inputPath, JSON.stringify({ tasks: [{ id: "active" }] }));
      const target = baseTarget();
      target.tasks.push(task("active"));
      let applyCount = 0;
      await assert.rejects(
        () =>
          runUpdate({
            confirm: async () => true,
            environment: "local",
            inputPath,
            inspectTarget: () => target,
            projectRoot: project,
            runApply: () => {
              applyCount += 1;
            },
            runBackup: () => {
              throw new Error("backup failed");
            },
            scriptDirectory: join(project, "scripts"),
            verifySchema: () => {},
            verifyTargetSchema: () => {},
          }),
        /backup failed/u,
      );
      assert.equal(applyCount, 0);
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-009",
      "parses the complete target snapshot and bounds update readback queries",
    ),
    () => {
      const snapshot = inspectUpdateTarget({
        runQuery: () => [
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
          [{ id: 1, name: "tag" }],
          [task("active")],
          [{ taskId: "active", tagId: 1 }],
          [{ ownerTimeZone: "Asia/Tokyo" }],
        ],
      });
      assert.equal(snapshot.areas[0].isSystemManaged, true);
      assert.deepEqual(snapshot.taskTags, [{ taskId: "active", tagId: 1 }]);

      const calls = [];
      const readback = inspectUpdateReadback({
        plan: {
          newAreas: [],
          newTags: [],
          tasks: Array.from({ length: 1_001 }, (_, index) => ({
            id: `id-${index}`,
          })),
        },
        runQuery: ({ sql }) => {
          calls.push(sql);
          if (sql.includes("FROM owner_settings")) {
            return [[{ ownerTimeZone: "Asia/Tokyo" }]];
          }
          return [[], []];
        },
      });
      assert.equal(readback.ownerTimeZone, "Asia/Tokyo");
      assert.equal(calls.length, 4);
      for (const sql of calls.slice(1)) {
        assert.ok((sql.match(/CAST\(X'/gu) ?? []).length <= 1_000);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-010",
      "accepts only y or Y at the update confirmation prompt",
    ),
    async () => {
      assert.equal(await confirmationAnswer("y\n"), true);
      assert.equal(await confirmationAnswer("Y\n"), true);
      assert.equal(await confirmationAnswer("yes\n"), false);
      assert.equal(await confirmationAnswer("\n"), false);
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-006",
      "generates guarded atomic SQL without interpolating input values as SQL structure",
    ),
    () => {
      const target = baseTarget();
      target.tasks.push(task("active", { title: "Before", tags: ["old"] }));
      const plan = createUpdatePlan(
        {
          tasks: [
            {
              id: "active",
              title: "Quoted ' ;\nUnicode 雪",
              area: "New Area",
              tags: ["New"],
            },
          ],
        },
        target,
      );
      const sql = buildUpdateSql(plan);

      assert.match(sql, /PRAGMA foreign_keys = ON/u);
      assert.match(sql, /\(SELECT COUNT\(\*\) FROM areas\) = 1/u);
      assert.match(sql, /\(SELECT COUNT\(\*\) FROM tags\) = 1/u);
      assert.match(sql, /\(SELECT COUNT\(\*\) FROM tasks\) = 1/u);
      assert.match(sql, /\(SELECT COUNT\(\*\) FROM task_tags\) = 0/u);
      assert.match(sql, /INSERT INTO areas/u);
      assert.match(sql, /UPDATE tasks SET/u);
      assert.match(sql, /version = version \+ 1/u);
      assert.match(sql, /INSERT INTO task_manual_orders/u);
      assert.doesNotMatch(sql, /Quoted|Unicode|New Area/u);
      const taskUpdate = sql
        .split("\n")
        .find((statement) => statement.startsWith("UPDATE tasks SET"));
      assert.doesNotMatch(
        taskUpdate,
        /\b(status|completed_at|created_at|trashed_at|generated_from_task_id|trash_operation_id)\s*=/u,
      );
      assert.equal(
        sql
          .trimEnd()
          .split("\n")
          .every((statement) => Buffer.byteLength(statement) <= 100_000),
        true,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-012",
      "keeps the documented update example aligned with schema and runtime validation",
    ),
    () => {
      const example = JSON.parse(
        readFileSync(
          resolve(
            import.meta.dirname,
            "../database-maintenance/examples/task-update.json",
          ),
          "utf8",
        ),
      );
      validateUpdateDocument(example, updateSchemaPath);
      const plan = createUpdatePlan(example, baseTarget());
      assert.equal(plan.tasks.length, 0);
      assert.equal(plan.skipped.length, example.tasks.length);
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-007",
      "classifies unknown write results and never retries or restores automatically",
    ),
    async () => {
      const project = makeProject();
      const inputPath = join(project, "tasks.json");
      writeFileSync(inputPath, JSON.stringify({ tasks: [{ id: "active" }] }));
      const target = baseTarget();
      target.tasks.push(task("active"));
      let applyCount = 0;
      let backupCount = 0;

      await assert.rejects(
        () =>
          runUpdate({
            confirm: async () => true,
            environment: "local",
            inputPath,
            inspectTarget: () => target,
            projectRoot: project,
            runApply: () => {
              applyCount += 1;
              const error = new Error("network error");
              error.code = "ETIMEDOUT";
              throw error;
            },
            runBackup: () => {
              backupCount += 1;
              return { path: "/backup.sql" };
            },
            scriptDirectory: join(project, "scripts"),
            verifySchema: () => {},
            verifyTargetSchema: () => {},
          }),
        (error) => {
          assert.equal(error instanceof UpdateExecutionError, true);
          assert.equal(error.resultUnknown, true);
          assert.equal(error.backupPath, "/backup.sql");
          return true;
        },
      );
      assert.equal(backupCount, 1);
      assert.equal(applyCount, 1);
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-005",
      "validates final dates and recurrence while accepting explicit clearing values",
    ),
    () => {
      const target = baseTarget();
      target.tasks.push(
        task("scheduled", {
          start: "2026-09-11T10:00:00+09:00",
          due: "2026-09-11T12:00:00+09:00",
        }),
        task("recurring", {
          start: "2026-09-07",
          due: "2026-09-07",
          recurrenceRule: "mon",
        }),
      );

      assert.throws(
        () =>
          createUpdatePlan(
            { tasks: [{ id: "scheduled", due: "2026-09-11T00:00:00Z" }] },
            target,
          ),
        /DueをStartより前/u,
      );
      assert.throws(
        () =>
          createUpdatePlan(
            { tasks: [{ id: "recurring", start: "2026-09-08", due: null }] },
            target,
          ),
        /一致しません/u,
      );
      const plan = createUpdatePlan(
        {
          tasks: [
            {
              id: "recurring",
              description: "",
              workNotes: "",
              start: null,
              due: null,
              recurrenceRule: null,
            },
          ],
        },
        target,
      );
      assert.deepEqual(
        {
          description: plan.tasks[0].description,
          due: plan.tasks[0].due,
          recurrenceRule: plan.tasks[0].recurrenceRule,
          start: plan.tasks[0].start,
          workNotes: plan.tasks[0].workNotes,
        },
        {
          description: "",
          due: null,
          recurrenceRule: null,
          start: null,
          workNotes: "",
        },
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-002",
      "cascades an Area move while preserving an existing completed parent-child relationship",
    ),
    () => {
      const target = baseTarget();
      target.tasks.push(
        task("parent", {
          status: "COMPLETED",
          completedAt: "2026-09-10T00:00:00.000Z",
        }),
        task("child", {
          parentId: "parent",
          status: "COMPLETED",
          completedAt: "2026-09-10T00:00:00.000Z",
        }),
      );

      const plan = createUpdatePlan(
        {
          tasks: [
            { id: "child", parentId: "parent", tags: [" New ", "new"] },
            { id: "parent", area: " New Area " },
          ],
        },
        target,
        { now: () => new Date("2026-09-11T01:02:03.000Z") },
      );

      assert.deepEqual(plan.newAreas, [
        { color: "blue", name: "New Area", position: 1 },
      ]);
      assert.deepEqual(plan.newTags, ["new"]);
      assert.deepEqual(plan.tagUpdates, [{ id: "child", tags: ["new"] }]);
      assert.deepEqual(plan.relocations, [
        {
          areaId: null,
          areaName: "New Area",
          id: "parent",
          parentId: null,
        },
      ]);
      assert.deepEqual(
        plan.tasks.map(
          ({ id, areaId, areaName, parentId, status, completedAt }) => ({
            id,
            areaId,
            areaName,
            parentId,
            status,
            completedAt,
          }),
        ),
        [
          {
            id: "child",
            areaId: null,
            areaName: "New Area",
            parentId: "parent",
            status: "COMPLETED",
            completedAt: "2026-09-10T00:00:00.000Z",
          },
          {
            id: "parent",
            areaId: null,
            areaName: "New Area",
            parentId: null,
            status: "COMPLETED",
            completedAt: "2026-09-10T00:00:00.000Z",
          },
        ],
      );

      const unchangedAreaTarget = baseTarget();
      unchangedAreaTarget.tasks.push(
        task("unchanged-parent"),
        task("unchanged-child", { parentId: "unchanged-parent" }),
      );
      const unchangedAreaPlan = createUpdatePlan(
        { tasks: [{ id: "unchanged-parent", area: "Inbox" }] },
        unchangedAreaTarget,
        { now: () => new Date("2026-09-11T01:02:03.000Z") },
      );

      assert.deepEqual(
        unchangedAreaPlan.tasks.map(({ id }) => id),
        ["unchanged-parent"],
      );
      assert.deepEqual(unchangedAreaPlan.relocations, []);
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-003",
      "rejects duplicate IDs and invalid final parent trees independent of input order",
    ),
    () => {
      const withTasks = (...tasks) => ({ ...baseTarget(), tasks });
      const cases = [
        [
          { tasks: [{ id: "same" }, { id: "same", title: "later" }] },
          withTasks(task("same")),
          /重複/u,
        ],
        [
          { tasks: [{ id: "child", parentId: "missing" }] },
          withTasks(task("child")),
          /親Taskが見つかりません/u,
        ],
        [
          { tasks: [{ id: "child", parentId: "parent" }] },
          withTasks(task("child"), task("parent", { status: "COMPLETED" })),
          /Completed Task/u,
        ],
        [
          {
            tasks: [
              { id: "child", parentId: "parent" },
              { id: "parent", parentId: "child" },
            ],
          },
          withTasks(task("child"), task("parent")),
          /循環/u,
        ],
        [
          { tasks: [{ id: "level-1", parentId: "level-2" }] },
          withTasks(
            ...Array.from({ length: 6 }, (_, index) =>
              task(`level-${index + 1}`, {
                parentId: index === 5 ? null : `level-${index + 2}`,
              }),
            ),
          ),
          /5階層/u,
        ],
      ];

      for (const [document, target, expected] of cases) {
        assert.throws(() => createUpdatePlan(document, target), expected);
      }
    },
  );

  maintenanceCase(
    caseMeta(
      "UPDATE-UNIT-004",
      "validates the update schema and stops cancellation before backup or write",
    ),
    async () => {
      assert.throws(
        () =>
          validateUpdateDocument(
            { tasks: [{ id: "task", status: "COMPLETED" }] },
            updateSchemaPath,
          ),
        /更新用JSON Schema/u,
      );

      const project = makeProject();
      const inputPath = join(project, "tasks.json");
      writeFileSync(inputPath, JSON.stringify({ tasks: [{ id: "active" }] }));
      const target = baseTarget();
      target.tasks.push(task("active"));
      const events = [];
      const result = await runUpdate({
        confirm: async () => {
          events.push("confirm");
          return false;
        },
        environment: "local",
        inputPath,
        inspectTarget: () => {
          events.push("inspect-target");
          return target;
        },
        projectRoot: project,
        runApply: () => events.push("apply"),
        runBackup: () => events.push("backup"),
        scriptDirectory: join(project, "scripts"),
        verifySchema: () => events.push("verify-schema"),
        verifyTargetSchema: () => events.push("verify-target-schema"),
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
      "UPDATE-UNIT-011",
      "parses the fixed-entrypoint CLI and avoids repeating confirmation skips",
    ),
    async () => {
      assert.deepEqual(
        parseUpdateArguments(["--environment", "local", "tasks.json"]),
        {
          environment: "local",
          help: false,
          inputPath: "tasks.json",
        },
      );
      assert.equal(parseUpdateArguments(["--help"]).help, true);
      assert.throws(
        () =>
          parseUpdateArguments(["--environment", "remote", "a.json", "b.json"]),
        /1つだけ/u,
      );

      let output = "";
      let error = "";
      const exitCode = await runUpdateCli(
        ["--environment", "local", "tasks.json"],
        {
          errorOutput: { write: (value) => (error += value) },
          input: process.stdin,
          output: { write: (value) => (output += value) },
        },
        async () => ({
          backupPath: "/backup.sql",
          databaseName: "taskseq-local",
          durationMs: 12,
          label: "local D1",
          metrics: {
            areaCount: 1,
            inputBytes: 10,
            sqlBytes: 20,
            tagCount: 2,
            taskCount: 3,
          },
          skipped: [
            {
              id: "missing",
              reason: "Taskが見つかりません",
              title: "(未指定)",
            },
          ],
          status: "applied",
        }),
      );
      assert.equal(exitCode, 0);
      assert.equal(error, "");
      assert.match(output, /3 Task/u);
      assert.doesNotMatch(output, /skip: ID=missing/u);
      assert.match(
        formatUpdateConfirmation({
          databaseName: "taskseq-local",
          environmentConfig: { label: "local D1" },
          inputPath: "/tasks.json",
          plan: {
            newAreas: [],
            newTags: [],
            skipped: [
              {
                id: "missing",
                reason: "Taskが見つかりません",
                title: "(未指定)",
              },
            ],
            tasks: [],
          },
        }).message,
        /skip: ID=missing \/ Title=\(未指定\) \/ 理由=Taskが見つかりません/u,
      );

      for (const name of ["local-update.sh", "remote-update.sh"]) {
        const path = resolve(import.meta.dirname, `../${name}`);
        assert.equal(existsSync(path), true);
        assert.match(readFileSync(path, "utf8"), /update-cli\.mjs/u);
      }
    },
  );

  manualMaintenanceCase({
    id: "UPDATE-UNIT-013",
    operation: "update",
    profile: "unit",
    title: "reviews the update confirmation display",
    reviewRevision: "update-confirmation-v1",
    acceptedReviewRevision: "update-confirmation-v1",
    reviewOutput: updateManualReviewOutput(),
  });
});

function baseTarget() {
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
    tags: [{ id: 1, name: "old" }],
    taskTags: [],
    tasks: [],
  };
}

function task(id, overrides = {}) {
  return {
    areaId: 1,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    description: "description",
    due: null,
    generatedFromTaskId: null,
    id,
    parentId: null,
    recurrenceRule: null,
    start: null,
    status: "OPEN",
    tags: [],
    title: `Task ${id}`,
    trashOperationId: null,
    trashedAt: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 3,
    workNotes: "notes",
    ...overrides,
  };
}

function makeProject() {
  const project = mkdtempSync(join(tmpdir(), "taskseq-update-unit-"));
  const backupDirectory = mkdtempSync(
    join(tmpdir(), "taskseq-update-backups-"),
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

function updateManualReviewOutput() {
  return ["[local sample]", "[remote sample]"]
    .flatMap((heading, index) => {
      const view = formatUpdateConfirmation({
        databaseName: index === 0 ? "taskseq-local" : "taskseq",
        environmentConfig: { label: index === 0 ? "local D1" : "remote D1" },
        inputPath: "/path/to/tasks.json",
        plan: {
          newAreas: [{}],
          newTags: [{}, {}],
          skipped: [
            {
              id: "missing-id",
              reason: "Taskが見つかりません",
              title: "(未指定)",
            },
          ],
          tasks: [{}, {}, {}],
        },
      });
      return [heading, `${view.message}${view.prompt}`];
    })
    .join("\n");
}

async function confirmationAnswer(answer) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.end(answer);
  return askForConfirmation({
    databaseName: "taskseq-local",
    environmentConfig: { label: "local D1" },
    input,
    inputPath: "/path/to/tasks.json",
    output,
    plan: { newAreas: [], newTags: [], skipped: [], tasks: [{}] },
  });
}
