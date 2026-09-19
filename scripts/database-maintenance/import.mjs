import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  normalizeRecurrenceRule,
  recurrenceRuleMatchesDate,
} from "../../app/src/domain/recurrence.ts";
import { runBackup as defaultRunBackup } from "./backup.mjs";
import { loadMaintenanceEnvironment } from "./environment.mjs";
import { validateJsonSchema } from "./json-schema.mjs";
import {
  buildMigrationPlan,
  isMigrationResultUnknown,
  readMigrations,
  resolveMigrationHistory,
  runWranglerQuery,
} from "./migration.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectRoot = resolve(scriptsDirectory, "..");
const importReadbackChunkSize = 500;
const maximumImportStatementBytes = 100_000;

export async function runImport({
  projectRoot = defaultProjectRoot,
  appDirectory = resolve(projectRoot, "app"),
  confirm = askForConfirmation,
  createId = randomUUID,
  environment,
  inputPath,
  inspectTarget = inspectImportTarget,
  migrationDirectory = resolve(projectRoot, "app", "migrations"),
  now = () => new Date(),
  persistTo,
  processEnvironment = process.env,
  runApply = runWranglerImport,
  runBackup = defaultRunBackup,
  runVerify = inspectImportReadback,
  scriptDirectory = scriptsDirectory,
  schemaPath = resolve(
    import.meta.dirname,
    "schemas",
    "task-import.schema.json",
  ),
  verifyReadback = assertImportReadback,
  verifySchema = validateImportDocument,
  verifyTargetSchema = assertImportSchema,
  wranglerConfigPath,
} = {}) {
  const resolvedInputPath = resolveInputPath(inputPath);
  const inputBytes = statSync(resolvedInputPath).size;
  const document = readImportDocument(resolvedInputPath);
  verifySchema(document, schemaPath);
  const environmentConfig = loadMaintenanceEnvironment({
    environment,
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  verifyTargetSchema({
    appDirectory,
    configPath: wranglerConfigPath,
    environmentConfig,
    migrationDirectory,
    persistTo,
  });
  const target = await inspectTarget({
    appDirectory,
    configPath: wranglerConfigPath,
    environmentConfig,
    persistTo,
  });
  const plan = createImportPlan(document, target, { createId, now });
  const confirmed = await confirm({
    databaseName: environmentConfig.databaseName,
    environmentConfig,
    inputPath: resolvedInputPath,
    operation: "import",
    plan,
  });
  if (!confirmed) {
    return Object.freeze({
      databaseName: environmentConfig.databaseName,
      environment: environmentConfig.environment,
      inputPath: resolvedInputPath,
      label: environmentConfig.label,
      status: "cancelled",
    });
  }

  const sql = buildImportSql(plan);
  const statementBytes = sql
    .trimEnd()
    .split("\n")
    .map((statement) => Buffer.byteLength(statement));
  const backup = await runBackup({
    appDirectory,
    configPath: wranglerConfigPath,
    environment,
    operation: "import",
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  const backupPath = backup?.path;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "taskseq-import-"));
  const sqlPath = join(temporaryDirectory, "import.sql");
  writeFileSync(sqlPath, sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const startedAt = performance.now();
  try {
    try {
      await runApply({
        appDirectory,
        configPath: wranglerConfigPath,
        environmentConfig,
        persistTo,
        sqlPath,
      });
    } catch (error) {
      throw new ImportExecutionError(error.message, {
        backupPath,
        cause: error,
        resultUnknown: isMigrationResultUnknown(error),
      });
    }
    let readback;
    try {
      readback = await runVerify({
        appDirectory,
        configPath: wranglerConfigPath,
        environmentConfig,
        persistTo,
        plan,
      });
    } catch (error) {
      throw new ImportExecutionError("import後の状態を確認できませんでした。", {
        backupPath,
        cause: error,
        resultUnknown: true,
      });
    }
    try {
      verifyReadback(readback, plan);
    } catch (error) {
      throw new ImportExecutionError(
        `import後の状態が期待値と一致しません: ${error.message}`,
        { backupPath, cause: error, resultUnknown: false },
      );
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
  return Object.freeze({
    backupPath,
    databaseName: environmentConfig.databaseName,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    environment: environmentConfig.environment,
    inputPath: resolvedInputPath,
    label: environmentConfig.label,
    metrics: Object.freeze({
      areaCount: plan.newAreas.length,
      executionRoute: "wrangler d1 execute --file",
      inputBytes,
      maximumStatementBytes: Math.max(...statementBytes),
      sqlBytes: Buffer.byteLength(sql),
      statementCount: statementBytes.length,
      tagCount: plan.newTags.length,
      tagRelationCount: plan.tasks.reduce(
        (count, task) => count + task.tags.length,
        0,
      ),
      taskCount: plan.tasks.length,
    }),
    status: "applied",
  });
}

export class ImportExecutionError extends Error {
  constructor(message, { backupPath, cause, resultUnknown }) {
    super(message, { cause });
    this.name = "ImportExecutionError";
    this.backupPath = backupPath;
    this.resultUnknown = resultUnknown === true;
  }
}

export function resolveInputPath(inputPath, launchDirectory = process.cwd()) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error("importするJSON入力パスが必要です。");
  }
  const path = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(launchDirectory, inputPath);
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`JSON入力パスが通常のファイルではありません: ${path}`);
  }
  return path;
}

export function readImportDocument(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("import入力が有効なJSONではありません。", {
      cause: error,
    });
  }
}

export function validateImportDocument(document, schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const errors = validateJsonSchema(document, schema);
  if (errors.length > 0) {
    throw new Error(
      `import入力が新規登録用JSON Schemaに一致しません: ${errors.join("; ")}`,
    );
  }
}

export function createImportPlan(
  document,
  target,
  { createId = randomUUID, now = () => new Date() } = {},
) {
  assertTargetSnapshot(target);
  const inbox = target.areas.find(
    (area) => area.isSystemManaged === true && area.trashedAt === null,
  );
  if (!inbox) {
    throw new Error("対象DBに有効なシステムInboxがありません。");
  }

  const activeAreas = new Map(
    target.areas
      .filter((area) => area.trashedAt === null)
      .map((area) => [area.name, area]),
  );
  const trashedAreaNames = new Set(
    target.areas
      .filter((area) => area.trashedAt !== null)
      .map((area) => area.name),
  );
  const areaDefinitions = [];
  const definedAreaNames = new Set();
  for (const definition of document.areas ?? []) {
    const name = normalizeName(definition.name, "Area");
    if (definedAreaNames.has(name)) {
      throw new Error(`Area定義が重複しています: ${name}`);
    }
    definedAreaNames.add(name);
    areaDefinitions.push({ color: definition.color ?? "blue", name });
  }

  const requestedAreas = new Map(
    areaDefinitions.map((area) => [area.name, area]),
  );
  forEachTask(document.tasks, (task) => {
    if (task.area !== undefined) {
      const name = normalizeName(task.area, "Area");
      if (!requestedAreas.has(name)) {
        requestedAreas.set(name, { color: "blue", name });
      }
    }
  });

  const maximumPosition = target.areas.reduce(
    (maximum, area) => Math.max(maximum, area.position),
    -1,
  );
  const newAreas = [];
  for (const requested of requestedAreas.values()) {
    if (requested.name === "Inbox") {
      continue;
    }
    if (trashedAreaNames.has(requested.name)) {
      throw new Error(
        `Trash内に同名Areaがあるためimportできません: ${requested.name}`,
      );
    }
    if (!activeAreas.has(requested.name)) {
      const area = {
        color: requested.color,
        name: requested.name,
        position: maximumPosition + newAreas.length + 1,
      };
      newAreas.push(area);
      activeAreas.set(requested.name, {
        ...area,
        id: null,
        isSystemManaged: false,
        trashedAt: null,
      });
    }
  }

  const existingTags = new Set(target.tags.map((tag) => tag.name));
  const allTags = new Set();
  for (const name of document.tags ?? []) {
    allTags.add(normalizeTagName(name));
  }
  forEachTask(document.tasks, (task) => {
    for (const name of task.tags ?? []) {
      allTags.add(normalizeTagName(name));
    }
  });
  const newTags = [...allTags].filter((name) => !existingTags.has(name));

  const existingTasks = new Map(target.tasks.map((task) => [task.id, task]));
  const reservedTaskIds = new Set(existingTasks.keys());
  const guardedTasks = new Map();
  const tasks = [];
  const operationTime = now();
  if (
    !(operationTime instanceof Date) ||
    Number.isNaN(operationTime.getTime())
  ) {
    throw new Error("import日時を生成できません。");
  }

  const addTask = (input, structuralParent, inputDepth) => {
    const existingParent =
      structuralParent === null && input.parentId
        ? existingTasks.get(input.parentId)
        : null;
    if (structuralParent === null && input.parentId && !existingParent) {
      throw new Error(`親Taskが見つかりません: ${input.parentId}`);
    }
    const parent = structuralParent ?? existingParent;
    if (parent) {
      assertEligibleParent(parent);
    }

    const explicitAreaName =
      input.area === undefined ? null : normalizeName(input.area, "Area");
    const inheritedAreaId = parent?.areaId ?? null;
    const inheritedArea = parent
      ? parent.areaName
        ? parent.areaName === "Inbox"
          ? inbox
          : activeAreas.get(parent.areaName)
        : target.areas.find((area) => area.id === inheritedAreaId)
      : null;
    const area = explicitAreaName
      ? explicitAreaName === "Inbox"
        ? inbox
        : activeAreas.get(explicitAreaName)
      : parent
        ? (inheritedArea ??
          [...activeAreas.values()].find(
            (entry) => entry.id === inheritedAreaId,
          ))
        : inbox;
    if (!area) {
      throw new Error(`Areaが見つかりません: ${explicitAreaName}`);
    }
    const areaName = area.isSystemManaged ? "Inbox" : area.name;
    const parentAreaName = parent
      ? (parent.areaName ??
        (inheritedArea?.isSystemManaged ? "Inbox" : inheritedArea?.name))
      : null;
    if (parent && areaName !== parentAreaName) {
      throw new Error("SubtaskのAreaは親Taskと同じである必要があります。");
    }

    const ancestorDepth = existingParent
      ? existingTaskDepth(existingParent, existingTasks, guardedTasks)
      : 0;
    if (ancestorDepth + inputDepth > 5) {
      throw new Error("Taskは5階層を超えて作成できません。");
    }
    const recurrenceRule = normalizeRecurringTask(input, target.ownerTimeZone);
    if (recurrenceRule && (input.children?.length ?? 0) > 0) {
      throw new Error("Recurring TaskはSubtaskを持てません。");
    }

    const id = createId();
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Task IDを生成できません。");
    }
    if (reservedTaskIds.has(id)) {
      throw new Error(`Task IDが重複しています: ${id}`);
    }
    reservedTaskIds.add(id);
    const task = {
      areaId: area.id,
      areaName,
      createdAt: new Date(operationTime.getTime() + tasks.length).toISOString(),
      description: input.description ?? "",
      due: input.due ?? null,
      id,
      parentId: parent?.id ?? null,
      recurrenceRule,
      start: input.start ?? null,
      status: "OPEN",
      tags: [...new Set((input.tags ?? []).map(normalizeTagName))],
      title: normalizeTitle(input.title),
      trashedAt: null,
      updatedAt: new Date(operationTime.getTime() + tasks.length).toISOString(),
      workNotes: input.workNotes ?? "",
    };
    tasks.push(task);
    for (const child of input.children ?? []) {
      addTask(child, task, inputDepth + 1);
    }
  };

  for (const task of document.tasks) {
    addTask(task, null, 1);
  }

  return Object.freeze({
    guard: Object.freeze({
      absentAreaNames: Object.freeze(newAreas.map((area) => area.name)),
      areas: Object.freeze([
        inbox,
        ...[...requestedAreas.keys()]
          .filter((name) => name !== "Inbox")
          .map((name) => target.areas.find((area) => area.name === name))
          .filter(Boolean),
      ]),
      maximumAreaPosition: maximumPosition,
      ownerTimeZone: target.ownerTimeZone,
      tasks: Object.freeze([...guardedTasks.values()]),
    }),
    guardTagName: `taskseq-import-guard-${randomUUID()}`,
    newAreas: Object.freeze(newAreas),
    newTags: Object.freeze(newTags),
    ownerTimeZone: target.ownerTimeZone,
    tasks: Object.freeze(tasks),
  });
}

function forEachTask(tasks, visit) {
  for (const task of tasks ?? []) {
    visit(task);
    forEachTask(task.children, visit);
  }
}

function normalizeName(value, kind) {
  const name = String(value).trim();
  if (name.length === 0 || name.includes(",")) {
    throw new Error(`${kind}名が不正です。`);
  }
  return name;
}

function normalizeTagName(value) {
  return normalizeName(value, "Tag").toLowerCase();
}

function normalizeTitle(value) {
  const title = String(value).trim();
  if (title.length === 0) {
    throw new Error("TaskのTitleは空にできません。");
  }
  return title;
}

function assertTargetSnapshot(target) {
  if (
    !target ||
    !Array.isArray(target.areas) ||
    !Array.isArray(target.tags) ||
    !Array.isArray(target.tasks) ||
    typeof target.ownerTimeZone !== "string"
  ) {
    throw new Error("対象DBのsnapshotが不正です。");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: target.ownerTimeZone });
  } catch (error) {
    throw new Error(`Owner timezoneが不正です: ${target.ownerTimeZone}`, {
      cause: error,
    });
  }
}

function assertEligibleParent(parent) {
  if (parent.trashedAt !== null) {
    throw new Error("Trash内のTaskを親にできません。");
  }
  if (parent.status !== "OPEN") {
    throw new Error("Completed Taskを親にできません。");
  }
  if (parent.recurrenceRule) {
    throw new Error("Recurring Taskを親にできません。");
  }
}

function existingTaskDepth(task, tasksById, guardedTasks) {
  let depth = 0;
  let current = task;
  const visited = new Set();
  while (current) {
    if (visited.has(current.id)) {
      throw new Error("既存Task treeに循環があります。");
    }
    visited.add(current.id);
    assertEligibleParent(current);
    guardedTasks.set(current.id, current);
    depth += 1;
    current = current.parentId ? tasksById.get(current.parentId) : null;
    if (current === undefined) {
      throw new Error("既存Taskの親が見つかりません。");
    }
  }
  return depth;
}

export function buildImportSql(plan) {
  const lines = ["PRAGMA foreign_keys = ON;"];
  const conditions = [
    `EXISTS (SELECT 1 FROM owner_settings WHERE id = 1 AND time_zone = ${sqlText(plan.guard.ownerTimeZone)})`,
    `(SELECT COALESCE(MAX(position), -1) FROM areas) = ${plan.guard.maximumAreaPosition}`,
    ...plan.guard.absentAreaNames.map(
      (name) =>
        `NOT EXISTS (SELECT 1 FROM areas WHERE name = ${sqlText(name)})`,
    ),
    ...plan.guard.areas.map((area) => areaGuardSql(area)),
    ...plan.guard.tasks.map((task) => taskGuardSql(task)),
  ];
  lines.push(
    `INSERT INTO tags (name) VALUES (CASE WHEN ${conditions.join(" AND ")} THEN ${sqlText(plan.guardTagName)} ELSE NULL END);`,
  );

  appendInsertBatches(
    lines,
    "INSERT INTO areas (name, color, position, is_system_managed, trashed_at) VALUES ",
    plan.newAreas.map(
      (area) =>
        `(${sqlText(area.name)}, ${sqlText(area.color)}, ${area.position}, 0, NULL)`,
    ),
  );
  appendInsertBatches(
    lines,
    "INSERT INTO tags (name) VALUES ",
    plan.newTags.map((tag) => `(${sqlText(tag)})`),
    " ON CONFLICT (name) DO NOTHING;",
  );
  const taskRows = [];
  const taskTagRows = [];
  for (const task of plan.tasks) {
    const areaId =
      task.areaId ??
      `(SELECT id FROM areas WHERE name = ${sqlText(task.areaName)} AND is_system_managed = 0 AND trashed_at IS NULL)`;
    taskRows.push(
      `(${sqlText(task.id)}, ${sqlText(task.title)}, ${sqlText(task.description)}, ${sqlText(task.workNotes)}, 'OPEN', ${areaId}, ${sqlNullableText(task.parentId)}, ${sqlNullableText(task.start)}, ${sqlNullableText(task.due)}, NULL, NULL, ${sqlText(task.createdAt)}, ${sqlText(task.updatedAt)}, 1, ${sqlNullableText(task.recurrenceRule)}, NULL, NULL)`,
    );
    for (const tag of task.tags) {
      taskTagRows.push(
        `(${sqlText(task.id)}, (SELECT id FROM tags WHERE name = ${sqlText(tag)}))`,
      );
    }
  }
  appendInsertBatches(
    lines,
    "INSERT INTO tasks (id, title, description, work_notes, status, area_id, parent_task_id, start, due, completed_at, trashed_at, created_at, updated_at, version, recurrence_rule, generated_from_task_id, trash_operation_id) VALUES ",
    taskRows,
  );
  appendInsertBatches(
    lines,
    "INSERT INTO task_tags (task_id, tag_id) VALUES ",
    taskTagRows,
  );
  lines.push(`DELETE FROM tags WHERE name = ${sqlText(plan.guardTagName)};`);
  return `${lines.join("\n")}\n`;
}

function appendInsertBatches(lines, prefix, rows, suffix = ";") {
  let batch = [];
  let statementBytes = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(row);
    const candidateBytes =
      statementBytes + rowBytes + (batch.length > 0 ? 2 : 0);
    if (
      batch.length > 0 &&
      candidateBytes > maximumImportStatementBytes
    ) {
      appendInsertBatch(lines, prefix, batch, suffix);
      batch = [row];
      statementBytes =
        Buffer.byteLength(prefix) + rowBytes + Buffer.byteLength(suffix);
    } else {
      batch.push(row);
      statementBytes = candidateBytes;
    }
  }
  appendInsertBatch(lines, prefix, batch, suffix);
}

function appendInsertBatch(lines, prefix, batch, suffix) {
  if (batch.length === 0) return;
  const statement = `${prefix}${batch.join(", ")}${suffix}`;
  const statementBytes = Buffer.byteLength(statement);
  if (statementBytes > maximumImportStatementBytes) {
    throw new Error(
      `import SQLの1 statementが上限を超えます: ${statementBytes} bytes`,
    );
  }
  lines.push(statement);
}

function areaGuardSql(area) {
  return `EXISTS (SELECT 1 FROM areas WHERE id = ${area.id} AND name = ${sqlText(area.name)} AND color = ${sqlText(area.color)} AND position = ${area.position} AND is_system_managed = ${area.isSystemManaged ? 1 : 0} AND trashed_at ${area.trashedAt === null ? "IS NULL" : `= ${sqlText(area.trashedAt)}`})`;
}

function taskGuardSql(task) {
  return `EXISTS (SELECT 1 FROM tasks WHERE id = ${sqlText(task.id)} AND area_id = ${task.areaId} AND parent_task_id ${task.parentId === null ? "IS NULL" : `= ${sqlText(task.parentId)}`} AND status = ${sqlText(task.status)} AND recurrence_rule ${task.recurrenceRule === null ? "IS NULL" : `= ${sqlText(task.recurrenceRule)}`} AND trashed_at ${task.trashedAt === null ? "IS NULL" : `= ${sqlText(task.trashedAt)}`})`;
}

function sqlNullableText(value) {
  return value === null ? "NULL" : sqlText(value);
}

function sqlText(value) {
  return `CAST(X'${Buffer.from(String(value), "utf8").toString("hex")}' AS TEXT)`;
}

export function assertImportSchema({
  appDirectory,
  configPath,
  environmentConfig,
  migrationDirectory,
  persistTo,
  runQuery = runWranglerQuery,
}) {
  const migrations = readMigrations(migrationDirectory);
  const history = resolveMigrationHistory({
    runQuery: () =>
      runQuery({
        appDirectory,
        configPath,
        environmentConfig,
        persistTo,
      }),
  });
  const plan = buildMigrationPlan({ migrations, history });
  if (plan.pendingMigrations.length > 0) {
    throw new Error(
      [
        "対象DBのschemaがrepositoryと一致しないためimportを実行できません。",
        `未適用migration: ${plan.pendingMigrations.map(({ name }) => name).join(", ")}`,
        "先に通常のmigration／deployment手順でschemaを揃えてください。",
      ].join("\n"),
    );
  }
}

const importTargetQuery = `SELECT id, name, color, position,
  is_system_managed AS isSystemManaged, trashed_at AS trashedAt
FROM areas ORDER BY id;
SELECT id, name FROM tags ORDER BY id;
SELECT id, title, description, work_notes AS workNotes, status,
  area_id AS areaId, parent_task_id AS parentId, start, due,
  completed_at AS completedAt, trashed_at AS trashedAt,
  created_at AS createdAt, updated_at AS updatedAt, version,
  recurrence_rule AS recurrenceRule,
  generated_from_task_id AS generatedFromTaskId,
  trash_operation_id AS trashOperationId
FROM tasks ORDER BY id;
SELECT time_zone AS ownerTimeZone FROM owner_settings WHERE id = 1;`;

export function inspectImportTarget({
  appDirectory,
  configPath,
  environmentConfig,
  persistTo,
  runQuery = runWranglerImportQuery,
}) {
  const resultSets = runQuery({
    appDirectory,
    configPath,
    environmentConfig,
    persistTo,
    sql: importTargetQuery,
  });
  if (
    !Array.isArray(resultSets) ||
    resultSets.length !== 4 ||
    resultSets.some((rows) => !Array.isArray(rows)) ||
    resultSets[3].length !== 1 ||
    typeof resultSets[3][0]?.ownerTimeZone !== "string"
  ) {
    throw new Error("対象DB snapshotのJSONが不正です。");
  }
  return {
    areas: resultSets[0].map((area) => ({
      ...area,
      isSystemManaged: area.isSystemManaged === 1,
    })),
    ownerTimeZone: resultSets[3][0].ownerTimeZone,
    tags: resultSets[1],
    tasks: resultSets[2],
  };
}

export function inspectImportReadback(options) {
  const { plan, runQuery = runWranglerImportQuery } = options;
  const query = (sql) => runQuery({ ...options, runQuery: undefined, sql });
  const ownerResult = query(
    "SELECT time_zone AS ownerTimeZone FROM owner_settings WHERE id = 1;",
  );
  if (
    ownerResult.length !== 1 ||
    ownerResult[0].length !== 1 ||
    typeof ownerResult[0][0]?.ownerTimeZone !== "string"
  ) {
    throw new Error("import readbackのOwner設定が不正です。");
  }
  const readback = {
    areas: [],
    ownerTimeZone: ownerResult[0][0].ownerTimeZone,
    tags: [],
    taskTags: [],
    tasks: [],
  };

  for (const names of chunks(
    plan.newAreas.map((area) => area.name),
    importReadbackChunkSize,
  )) {
    const [areas] = query(
      `SELECT id, name, color, position, is_system_managed AS isSystemManaged, trashed_at AS trashedAt FROM areas WHERE name IN (${names.map(sqlText).join(", ")}) ORDER BY id;`,
    );
    readback.areas.push(
      ...areas.map((area) => ({
        ...area,
        isSystemManaged: area.isSystemManaged === 1,
      })),
    );
  }
  for (const names of chunks(plan.newTags, importReadbackChunkSize)) {
    const [tags] = query(
      `SELECT id, name FROM tags WHERE name IN (${names.map(sqlText).join(", ")}) ORDER BY id;`,
    );
    readback.tags.push(...tags);
  }
  for (const ids of chunks(
    plan.tasks.map((task) => task.id),
    importReadbackChunkSize,
  )) {
    const inList = ids.map(sqlText).join(", ");
    const [tasks, taskTags] = query(`SELECT id, title, description,
  work_notes AS workNotes, status, area_id AS areaId,
  parent_task_id AS parentId, start, due, completed_at AS completedAt,
  trashed_at AS trashedAt, created_at AS createdAt, updated_at AS updatedAt,
  version, recurrence_rule AS recurrenceRule,
  generated_from_task_id AS generatedFromTaskId,
  trash_operation_id AS trashOperationId
FROM tasks WHERE id IN (${inList}) ORDER BY id;
SELECT task_tags.task_id AS taskId, tags.name AS tagName
FROM task_tags
INNER JOIN tags ON tags.id = task_tags.tag_id
WHERE task_tags.task_id IN (${inList})
ORDER BY task_tags.task_id, tags.name;`);
    readback.tasks.push(...tasks);
    readback.taskTags.push(...taskTags);
  }
  return readback;
}

export function assertImportReadback(readback, plan) {
  assertTargetSnapshot(readback);
  if (readback.ownerTimeZone !== plan.ownerTimeZone) {
    throw new Error("Owner timezoneが変更されています。");
  }
  const areasByName = new Map(readback.areas.map((area) => [area.name, area]));
  for (const expected of plan.newAreas) {
    const actual = areasByName.get(expected.name);
    if (!actual) throw new Error(`Areaが見つかりません: ${expected.name}`);
    for (const [field, value] of Object.entries({
      color: expected.color,
      isSystemManaged: false,
      position: expected.position,
      trashedAt: null,
    })) {
      if (actual[field] !== value) {
        throw new Error(`Area ${expected.name} の${field}が一致しません。`);
      }
    }
  }

  const tagNames = new Set(readback.tags.map((tag) => tag.name));
  for (const tag of plan.newTags) {
    if (!tagNames.has(tag)) throw new Error(`Tagが見つかりません: ${tag}`);
  }

  const tasksById = new Map(readback.tasks.map((task) => [task.id, task]));
  for (const expected of plan.tasks) {
    const actual = tasksById.get(expected.id);
    if (!actual) throw new Error(`Taskが見つかりません: ${expected.id}`);
    const expectedAreaId =
      expected.areaId ??
      readback.areas.find(
        (area) =>
          area.trashedAt === null &&
          (expected.areaName === "Inbox"
            ? area.isSystemManaged === true
            : area.name === expected.areaName &&
              area.isSystemManaged === false),
      )?.id;
    const fields = {
      areaId: expectedAreaId,
      completedAt: null,
      createdAt: expected.createdAt,
      description: expected.description,
      due: expected.due,
      generatedFromTaskId: null,
      parentId: expected.parentId,
      recurrenceRule: expected.recurrenceRule,
      start: expected.start,
      status: "OPEN",
      title: expected.title,
      trashOperationId: null,
      trashedAt: null,
      updatedAt: expected.updatedAt,
      version: 1,
      workNotes: expected.workNotes,
    };
    for (const [field, value] of Object.entries(fields)) {
      if (actual[field] !== value) {
        throw new Error(
          `Task ${expected.id} の${field}が一致しません: ${String(actual[field])}`,
        );
      }
    }
    const actualTags = readback.taskTags
      .filter((relation) => relation.taskId === expected.id)
      .map((relation) => relation.tagName)
      .sort();
    const expectedTags = [...expected.tags].sort();
    if (JSON.stringify(actualTags) !== JSON.stringify(expectedTags)) {
      throw new Error(`Task ${expected.id} のTag関連が一致しません。`);
    }
  }
  return readback;
}

export function runWranglerImport({
  appDirectory,
  configPath,
  environmentConfig,
  execFile = execFileSync,
  persistTo,
  sqlPath,
}) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    environmentConfig.databaseName,
    environmentConfig.scope,
    "--file",
    sqlPath,
    "--yes",
  ];
  if (configPath) args.push("--config", configPath);
  if (persistTo) args.push("--persist-to", persistTo);
  try {
    return execFile("pnpm", args, {
      cwd: appDirectory,
      encoding: "utf8",
      env: environmentConfig.childEnvironment,
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error) {
    writeCommandOutput(error.stdout, process.stdout);
    writeCommandOutput(error.stderr, process.stderr);
    throw error;
  }
}

export function askForConfirmation({
  databaseName,
  environmentConfig,
  input = process.stdin,
  inputPath,
  output = process.stdout,
  plan,
}) {
  const view = formatImportConfirmation({
    databaseName,
    environmentConfig,
    inputPath,
    plan,
  });
  output.write(view.message);
  const readline = createInterface({ input, output });
  return new Promise((resolveConfirmation) => {
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      readline.close();
      resolveConfirmation(confirmed);
    };
    readline.once("close", () => finish(false));
    readline.question(view.prompt, (answer) => {
      finish(/^[yY]$/u.test(answer.trim()));
    });
  });
}

export function formatImportConfirmation({
  databaseName,
  environmentConfig,
  inputPath,
  plan,
}) {
  return Object.freeze({
    message:
      `対象: ${environmentConfig.label} (${databaseName})\n` +
      "操作: JSONからArea、Tag、OPEN Taskを新規登録します。\n" +
      `入力: ${inputPath}\n` +
      `追加予定: ${plan.newAreas.length} Area / ${plan.newTags.length} Tag / ${plan.tasks.length} Task\n` +
      "同名Taskや同じ入力の再実行も、既存Taskを上書きせず新規登録します。\n",
    prompt: "上記のimportを実行しますか？ [y/N]: ",
  });
}

export function runWranglerImportQuery({
  appDirectory,
  configPath,
  environmentConfig,
  execFile = execFileSync,
  persistTo,
  sql,
}) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    environmentConfig.databaseName,
    environmentConfig.scope,
    "--command",
    sql,
    "--json",
  ];
  if (configPath) args.push("--config", configPath);
  if (persistTo) args.push("--persist-to", persistTo);
  const output = execFile("pnpm", args, {
    cwd: appDirectory,
    encoding: "utf8",
    env: environmentConfig.childEnvironment,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseWranglerResultSets(output);
}

function parseWranglerResultSets(output) {
  let payload;
  try {
    payload = typeof output === "string" ? JSON.parse(output) : output;
  } catch (error) {
    throw new Error("Wrangler import query JSONを解釈できませんでした。", {
      cause: error,
    });
  }
  const responses = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : null;
  if (
    !responses ||
    responses.some(
      (response) =>
        !response ||
        response.success === false ||
        !Array.isArray(response.results),
    )
  ) {
    throw new Error("Wrangler import query JSONが不正です。");
  }
  return responses.map((response) => response.results);
}

function writeCommandOutput(output, stream) {
  if (output) stream.write(String(output));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function normalizeRecurringTask(input, ownerTimeZone) {
  const start = input.start ?? null;
  const due = input.due ?? null;
  validateTaskDate(start, "Start");
  validateTaskDate(due, "Due");
  if (start && due && compareTaskDates(start, due, ownerTimeZone) > 0) {
    throw new Error("DueをStartより前に設定できません。");
  }
  if (input.recurrenceRule === undefined || input.recurrenceRule === null) {
    return null;
  }
  let rule;
  try {
    rule = normalizeRecurrenceRule(input.recurrenceRule);
  } catch (error) {
    throw new Error("Recurrence Ruleが不正です。", { cause: error });
  }
  if (!start || !/^\d{4}-\d{2}-\d{2}$/u.test(start)) {
    throw new Error("Recurring Taskにはdate-onlyのStartが必要です。");
  }
  if (due !== null && due !== start) {
    throw new Error("Recurring TaskのDueは未設定またはStartと同日だけです。");
  }
  if (!recurrenceRuleMatchesDate(rule, start)) {
    throw new Error("Recurring TaskのStartがRecurrence Ruleに一致しません。");
  }
  return rule;
}

function validateTaskDate(value, label) {
  if (value === null) {
    return;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (dateOnly) {
    if (!isCalendarDate(...dateOnly.slice(1).map(Number))) {
      throw new Error(`${label}が実在する日付ではありません。`);
    }
    return;
  }
  const timestamp =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!timestamp) {
    throw new Error(
      `${label}はdate-onlyまたはoffset付き日時で指定してください。`,
    );
  }
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second = "0",
    zone,
    offsetHour,
    offsetMinute,
  ] = timestamp;
  if (
    !isCalendarDate(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label}が実在する日時ではありません。`);
  }
}

function compareTaskDates(start, due, ownerTimeZone) {
  const startDateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(start);
  const dueDateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(due);
  if (!startDateOnly && !dueDateOnly) {
    return Date.parse(start) - Date.parse(due);
  }
  const startDate = startDateOnly
    ? start
    : dateInTimeZone(new Date(start), ownerTimeZone);
  const dueDate = dueDateOnly
    ? due
    : dateInTimeZone(new Date(due), ownerTimeZone);
  return startDate.localeCompare(dueDate);
}

function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function isCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
