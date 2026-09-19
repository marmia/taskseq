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
import {
  assertImportSchema,
  runWranglerImport,
  runWranglerImportQuery,
} from "./import.mjs";
import { validateJsonSchema } from "./json-schema.mjs";
import { isMigrationResultUnknown } from "./migration.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectRoot = resolve(scriptsDirectory, "..");

export async function runUpdate({
  projectRoot = defaultProjectRoot,
  appDirectory = resolve(projectRoot, "app"),
  confirm = askForConfirmation,
  environment,
  inputPath,
  inspectTarget = inspectUpdateTarget,
  migrationDirectory = resolve(projectRoot, "app", "migrations"),
  now = () => new Date(),
  persistTo,
  processEnvironment = process.env,
  runApply = runWranglerImport,
  runBackup = defaultRunBackup,
  runVerify = inspectUpdateReadback,
  schemaPath = resolve(
    import.meta.dirname,
    "schemas",
    "task-update.schema.json",
  ),
  scriptDirectory = scriptsDirectory,
  verifyReadback = assertUpdateReadback,
  verifySchema = validateUpdateDocument,
  verifyTargetSchema = assertImportSchema,
  wranglerConfigPath,
} = {}) {
  const resolvedInputPath = resolveInputPath(inputPath);
  const inputBytes = statSync(resolvedInputPath).size;
  const document = readUpdateDocument(resolvedInputPath);
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
  const plan = createUpdatePlan(document, target, { now });
  const confirmed = await confirm({
    databaseName: environmentConfig.databaseName,
    environmentConfig,
    inputPath: resolvedInputPath,
    operation: "update",
    plan,
  });
  if (!confirmed) {
    return Object.freeze({
      databaseName: environmentConfig.databaseName,
      environment: environmentConfig.environment,
      inputPath: resolvedInputPath,
      label: environmentConfig.label,
      skipped: plan.skipped,
      status: "cancelled",
    });
  }

  const sql = buildUpdateSql(plan);
  const statementBytes = sql
    .trimEnd()
    .split("\n")
    .map((statement) => Buffer.byteLength(statement));
  const backup = await runBackup({
    appDirectory,
    configPath: wranglerConfigPath,
    environment,
    operation: "update",
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  const backupPath = backup?.path;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "taskseq-update-"));
  const sqlPath = join(temporaryDirectory, "update.sql");
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
      throw new UpdateExecutionError(error.message, {
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
      throw new UpdateExecutionError("update後の状態を確認できませんでした。", {
        backupPath,
        cause: error,
        resultUnknown: true,
      });
    }
    try {
      verifyReadback(readback, plan);
    } catch (error) {
      throw new UpdateExecutionError(
        `update後の状態が期待値と一致しません: ${error.message}`,
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
      tagRelationCount: plan.tagUpdates.reduce(
        (count, update) => count + update.tags.length,
        0,
      ),
      taskCount: plan.tasks.length,
    }),
    skipped: plan.skipped,
    status: "applied",
  });
}

export class UpdateExecutionError extends Error {
  constructor(message, { backupPath, cause, resultUnknown }) {
    super(message, { cause });
    this.name = "UpdateExecutionError";
    this.backupPath = backupPath;
    this.resultUnknown = resultUnknown === true;
  }
}

export function resolveInputPath(inputPath, launchDirectory = process.cwd()) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error("updateするJSON入力パスが必要です。");
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

export function readUpdateDocument(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("update入力が有効なJSONではありません。", {
      cause: error,
    });
  }
}

export function validateUpdateDocument(document, schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const errors = validateJsonSchema(document, schema);
  if (errors.length > 0) {
    throw new Error(
      `update入力が更新用JSON Schemaに一致しません: ${errors.join("; ")}`,
    );
  }
}

export function buildUpdateSql(plan) {
  const lines = ["PRAGMA foreign_keys = ON;"];
  const guard = (condition) => {
    lines.push(`INSERT INTO tags (name) SELECT NULL WHERE NOT (${condition});`);
  };
  guard(
    `EXISTS (SELECT 1 FROM owner_settings WHERE id = 1 AND time_zone = ${sqlText(plan.ownerTimeZone)})`,
  );
  guard(
    `(SELECT COALESCE(MAX(position), -1) FROM areas) = ${Math.max(-1, ...plan.snapshot.areas.map((area) => area.position))}`,
  );
  guard(`(SELECT COUNT(*) FROM areas) = ${plan.snapshot.areas.length}`);
  for (const area of plan.snapshot.areas) guard(areaGuardSql(area));
  for (const area of plan.newAreas) {
    guard(
      `NOT EXISTS (SELECT 1 FROM areas WHERE name = ${sqlText(area.name)})`,
    );
  }
  guard(`(SELECT COUNT(*) FROM tags) = ${plan.snapshot.tags.length}`);
  for (const tag of plan.snapshot.tags) guard(tagGuardSql(tag));
  guard(`(SELECT COUNT(*) FROM tasks) = ${plan.snapshot.tasks.length}`);
  for (const task of plan.snapshot.tasks) guard(taskGuardSql(task));
  const snapshotTaskTags = plan.snapshot.taskTags ?? [];
  guard(`(SELECT COUNT(*) FROM task_tags) = ${snapshotTaskTags.length}`);
  for (const relation of snapshotTaskTags) {
    guard(taskTagGuardSql(relation));
  }

  for (const area of plan.newAreas) {
    lines.push(
      `INSERT INTO areas (name, color, position, is_system_managed, trashed_at) VALUES (${sqlText(area.name)}, ${sqlText(area.color)}, ${area.position}, 0, NULL);`,
    );
  }
  for (const tag of plan.newTags) {
    lines.push(
      `INSERT INTO tags (name) VALUES (${sqlText(tag)}) ON CONFLICT (name) DO NOTHING;`,
    );
  }
  for (const task of plan.tasks) {
    lines.push(
      `UPDATE tasks SET title = ${sqlText(task.title)}, description = ${sqlText(task.description)}, work_notes = ${sqlText(task.workNotes)}, area_id = ${areaIdSql(task)}, parent_task_id = ${sqlNullableText(task.parentId)}, start = ${sqlNullableText(task.start)}, due = ${sqlNullableText(task.due)}, recurrence_rule = ${sqlNullableText(task.recurrenceRule)}, updated_at = ${sqlText(task.updatedAt)}, version = version + 1 WHERE id = ${sqlText(task.id)};`,
    );
  }
  for (const update of plan.tagUpdates) {
    lines.push(`DELETE FROM task_tags WHERE task_id = ${sqlText(update.id)};`);
    for (const tag of update.tags) {
      lines.push(
        `INSERT INTO task_tags (task_id, tag_id) VALUES (${sqlText(update.id)}, (SELECT id FROM tags WHERE name = ${sqlText(tag)}));`,
      );
    }
  }
  for (const relocation of [...plan.relocations].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const groupKey = groupKeySql(relocation);
    lines.push(
      `DELETE FROM task_manual_orders WHERE task_id = ${sqlText(relocation.id)};`,
      `INSERT INTO task_manual_orders (group_key, task_id, position) SELECT ${groupKey}, ${sqlText(relocation.id)}, COALESCE((SELECT MAX(position) + 1 FROM task_manual_orders WHERE group_key = ${groupKey}), 0);`,
    );
  }
  for (const statement of lines) {
    const bytes = Buffer.byteLength(statement);
    if (bytes > 100_000) {
      throw new Error(
        `update SQLの1 statementが上限を超えます: ${bytes} bytes`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const updateTargetQuery = `SELECT id, name, color, position,
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
SELECT task_id AS taskId, tag_id AS tagId FROM task_tags ORDER BY task_id, tag_id;
SELECT time_zone AS ownerTimeZone FROM owner_settings WHERE id = 1;`;

export function inspectUpdateTarget({
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
    sql: updateTargetQuery,
  });
  if (
    !Array.isArray(resultSets) ||
    resultSets.length !== 5 ||
    resultSets.some((rows) => !Array.isArray(rows)) ||
    resultSets[4].length !== 1 ||
    typeof resultSets[4][0]?.ownerTimeZone !== "string"
  ) {
    throw new Error("対象DB snapshotのJSONが不正です。");
  }
  return {
    areas: resultSets[0].map((area) => ({
      ...area,
      isSystemManaged: area.isSystemManaged === 1,
    })),
    ownerTimeZone: resultSets[4][0].ownerTimeZone,
    tags: resultSets[1],
    tasks: resultSets[2],
    taskTags: resultSets[3],
  };
}

export function inspectUpdateReadback(options) {
  const { plan, runQuery = runWranglerImportQuery } = options;
  const query = (sql) => runQuery({ ...options, runQuery: undefined, sql });
  const names = plan.newAreas.map((area) => sqlText(area.name));
  const tagNames = plan.newTags.map(sqlText);
  const ids = plan.tasks.map((task) => sqlText(task.id));
  const [settings] = query(
    "SELECT time_zone AS ownerTimeZone FROM owner_settings WHERE id = 1;",
  );
  const readback = {
    areas: [],
    ownerTimeZone: settings?.[0]?.ownerTimeZone,
    tags: [],
    taskTags: [],
    tasks: [],
  };
  for (const values of chunks(names, 500)) {
    const [rows] = query(
      `SELECT id, name, color, position, is_system_managed AS isSystemManaged, trashed_at AS trashedAt FROM areas WHERE name IN (${values.join(", ")}) ORDER BY id;`,
    );
    readback.areas.push(
      ...rows.map((area) => ({
        ...area,
        isSystemManaged: area.isSystemManaged === 1,
      })),
    );
  }
  for (const values of chunks(tagNames, 500)) {
    const [rows] = query(
      `SELECT id, name FROM tags WHERE name IN (${values.join(", ")}) ORDER BY id;`,
    );
    readback.tags.push(...rows);
  }
  for (const values of chunks(ids, 500)) {
    const inList = values.join(", ");
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

export function assertUpdateReadback(readback, plan) {
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
  const actualTagNames = new Set(readback.tags.map((tag) => tag.name));
  for (const tag of plan.newTags) {
    if (!actualTagNames.has(tag))
      throw new Error(`Tagが見つかりません: ${tag}`);
  }
  const tasksById = new Map(readback.tasks.map((task) => [task.id, task]));
  for (const expected of plan.tasks) {
    const actual = tasksById.get(expected.id);
    if (!actual) throw new Error(`Taskが見つかりません: ${expected.id}`);
    const expectedAreaId =
      expected.areaId ?? areasByName.get(expected.areaName)?.id;
    const fields = {
      areaId: expectedAreaId,
      completedAt: expected.completedAt,
      createdAt: expected.createdAt,
      description: expected.description,
      due: expected.due,
      generatedFromTaskId: expected.generatedFromTaskId,
      parentId: expected.parentId,
      recurrenceRule: expected.recurrenceRule,
      start: expected.start,
      status: expected.status,
      title: expected.title,
      trashOperationId: expected.trashOperationId,
      trashedAt: expected.trashedAt,
      updatedAt: expected.updatedAt,
      version: expected.version,
      workNotes: expected.workNotes,
    };
    for (const [field, value] of Object.entries(fields)) {
      if (actual[field] !== value) {
        throw new Error(`Task ${expected.id} の${field}が一致しません。`);
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
}

export function askForConfirmation({
  databaseName,
  environmentConfig,
  input = process.stdin,
  inputPath,
  output = process.stdout,
  plan,
}) {
  const view = formatUpdateConfirmation({
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
    readline.question(view.prompt, (answer) =>
      finish(/^[yY]$/u.test(answer.trim())),
    );
  });
}

export function formatUpdateConfirmation({
  databaseName,
  environmentConfig,
  inputPath,
  plan,
}) {
  const skipped = plan.skipped
    .map(
      ({ id, reason, title }) =>
        `skip: ID=${id} / Title=${title} / 理由=${reason}\n`,
    )
    .join("");
  return Object.freeze({
    message:
      `対象: ${environmentConfig.label} (${databaseName})\n` +
      "操作: JSONで既存Taskを部分更新します。\n" +
      `入力: ${inputPath}\n` +
      `更新予定: ${plan.tasks.length} Task / ${plan.newAreas.length} Area追加 / ${plan.newTags.length} Tag追加\n` +
      skipped +
      "JSONで指定した項目は現在値を上書きし、省略項目は維持します。\n",
    prompt: "上記のupdateを実行しますか？ [y/N]: ",
  });
}

export function createUpdatePlan(
  document,
  target,
  { now = () => new Date() } = {},
) {
  assertTargetSnapshot(target);
  const operationTime = now();
  if (
    !(operationTime instanceof Date) ||
    Number.isNaN(operationTime.getTime())
  ) {
    throw new Error("update日時を生成できません。");
  }

  const inputsById = new Map();
  for (const input of document.tasks) {
    if (inputsById.has(input.id)) {
      throw new Error(`更新対象のTask IDが重複しています: ${input.id}`);
    }
    inputsById.set(input.id, input);
  }

  const existingById = new Map(target.tasks.map((task) => [task.id, task]));
  const skipped = [];
  const validInputs = [];
  for (const input of document.tasks) {
    const existing = existingById.get(input.id);
    if (!existing) {
      skipped.push({
        id: input.id,
        reason: "Taskが見つかりません",
        title: input.title ?? "(未指定)",
      });
    } else if (existing.trashedAt !== null) {
      skipped.push({
        id: input.id,
        reason: "Trash内のTaskです",
        title: input.title ?? "(未指定)",
      });
    } else {
      validInputs.push(input);
    }
  }

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
  const maximumAreaPosition = target.areas.reduce(
    (maximum, area) => Math.max(maximum, area.position),
    -1,
  );
  const newAreas = [];
  for (const input of validInputs) {
    if (input.area === undefined) continue;
    const name = normalizeName(input.area, "Area");
    if (name === "Inbox") continue;
    if (trashedAreaNames.has(name)) {
      throw new Error(`Trash内に同名Areaがあるためupdateできません: ${name}`);
    }
    if (!activeAreas.has(name)) {
      const area = {
        color: "blue",
        id: null,
        isSystemManaged: false,
        name,
        position: maximumAreaPosition + newAreas.length + 1,
        trashedAt: null,
      };
      newAreas.push({ color: area.color, name, position: area.position });
      activeAreas.set(name, area);
    }
  }

  const existingTagNames = new Set(target.tags.map((tag) => tag.name));
  const requestedTagNames = new Set();
  const tagUpdates = [];
  for (const input of validInputs) {
    if (input.tags === undefined) continue;
    const tags = [...new Set(input.tags.map(normalizeTagName))];
    tagUpdates.push({ id: input.id, tags });
    for (const tag of tags) requestedTagNames.add(tag);
  }
  const newTags = [...requestedTagNames].filter(
    (name) => !existingTagNames.has(name),
  );

  const finalById = new Map(
    target.tasks.map((task) => {
      const area = target.areas.find(
        (candidate) => candidate.id === task.areaId,
      );
      return [
        task.id,
        {
          ...task,
          areaName: area?.isSystemManaged === true ? "Inbox" : area?.name,
          tags: [...(task.tags ?? tagsForTask(target, task.id))],
        },
      ];
    }),
  );
  for (const input of validInputs) {
    const task = finalById.get(input.id);
    if (input.title !== undefined) task.title = normalizeTitle(input.title);
    if (input.description !== undefined) task.description = input.description;
    if (input.workNotes !== undefined) task.workNotes = input.workNotes;
    if (input.parentId !== undefined) task.parentId = input.parentId;
    if (input.start !== undefined) task.start = input.start;
    if (input.due !== undefined) task.due = input.due;
    if (input.recurrenceRule !== undefined) {
      task.recurrenceRule = input.recurrenceRule;
    }
    if (input.tags !== undefined) {
      task.tags = tagUpdates.find(({ id }) => id === input.id).tags;
    }
    if (input.area !== undefined) {
      const name = normalizeName(input.area, "Area");
      const area = name === "Inbox" ? inbox : activeAreas.get(name);
      task.areaId = area.id;
      task.areaName = area.isSystemManaged ? "Inbox" : area.name;
    }
  }

  const childrenByParent = buildChildren(finalById.values());
  const cascadedIds = new Set();
  for (const input of validInputs) {
    if (input.area === undefined) continue;
    const root = finalById.get(input.id);
    if (
      taskAreaKey(root, target.areas) ===
      taskAreaKey(existingById.get(input.id), target.areas)
    ) {
      continue;
    }
    const pending = [...(childrenByParent.get(root.id) ?? [])];
    const visited = new Set([root.id]);
    while (pending.length > 0) {
      const child = pending.pop();
      if (visited.has(child.id)) {
        throw new Error("Task treeに循環があります。");
      }
      visited.add(child.id);
      const childInput = inputsById.get(child.id);
      if (childInput?.area === undefined) {
        child.areaId = root.areaId;
        child.areaName = root.areaName;
        cascadedIds.add(child.id);
      }
      pending.push(...(childrenByParent.get(child.id) ?? []));
    }
  }

  const validIds = new Set(validInputs.map((input) => input.id));
  validateFinalTasks({
    finalById,
    inputsById,
    originalById: existingById,
    ownerTimeZone: target.ownerTimeZone,
    validIds,
  });

  const affectedIds = new Set([...validIds, ...cascadedIds]);
  const updatedAt = operationTime.toISOString();
  const tasks = [...affectedIds].sort().map((id) => {
    const task = finalById.get(id);
    return Object.freeze({
      ...task,
      updatedAt,
      version: existingById.get(id).version + 1,
    });
  });
  const relocations = tasks
    .filter((task) => {
      const existing = existingById.get(task.id);
      return (
        taskGroupKey(existing, target.areas) !==
        taskGroupKey(task, target.areas)
      );
    })
    .map((task) => ({
      areaId: task.areaId,
      areaName: task.areaName,
      id: task.id,
      parentId: task.parentId,
    }));

  return Object.freeze({
    newAreas: Object.freeze(newAreas),
    newTags: Object.freeze(newTags),
    ownerTimeZone: target.ownerTimeZone,
    relocations: Object.freeze(relocations),
    skipped: Object.freeze(skipped),
    snapshot: target,
    tagUpdates: Object.freeze(tagUpdates),
    tasks: Object.freeze(tasks),
  });
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

function tagsForTask(target, taskId) {
  const tagNameById = new Map(target.tags.map((tag) => [tag.id, tag.name]));
  return (target.taskTags ?? [])
    .filter((relation) => relation.taskId === taskId)
    .map(
      (relation) =>
        relation.tagName ?? tagNameById.get(relation.tagId ?? relation.tag_id),
    )
    .filter(Boolean);
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

function buildChildren(tasks) {
  const children = new Map();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const siblings = children.get(task.parentId) ?? [];
    siblings.push(task);
    children.set(task.parentId, siblings);
  }
  return children;
}

function taskGroupKey(task, areas) {
  if (task.parentId !== null) return `parent:${task.parentId}`;
  return taskAreaKey(task, areas);
}

function taskAreaKey(task, areas) {
  const area =
    task.areaId === null
      ? null
      : areas.find((candidate) => candidate.id === task.areaId);
  if (area?.isSystemManaged === true || task.areaName === "Inbox") {
    return "inbox";
  }
  return task.areaId === null
    ? `new-area:${task.areaName}`
    : `area:${task.areaId}`;
}

function validateFinalTasks({
  finalById,
  inputsById,
  originalById,
  ownerTimeZone,
  validIds,
}) {
  const activeTasks = [...finalById.values()].filter(
    (task) => task.trashedAt === null,
  );
  const activeById = new Map(activeTasks.map((task) => [task.id, task]));
  const children = buildChildren(activeTasks);

  for (const id of validIds) {
    const task = activeById.get(id);
    const input = inputsById.get(id);
    if (task.parentId !== null) {
      const parent = activeById.get(task.parentId);
      if (!parent) {
        throw new Error(`親Taskが見つかりません: ${task.parentId}`);
      }
      if (parent.areaId !== task.areaId) {
        throw new Error("SubtaskのAreaは親Taskと同じである必要があります。");
      }
      if (
        input.parentId !== undefined &&
        input.parentId !== originalById.get(id).parentId
      ) {
        assertEligibleNewParent(parent);
      }
    }
    task.recurrenceRule = normalizeAndValidateTaskDates(task, ownerTimeZone);
    if (task.recurrenceRule && (children.get(task.id)?.length ?? 0) > 0) {
      throw new Error("Recurring TaskはSubtaskを持てません。");
    }
  }

  for (const task of activeTasks) {
    if (task.parentId !== null) {
      const parent = activeById.get(task.parentId);
      if (!parent) throw new Error(`親Taskが見つかりません: ${task.parentId}`);
      if (parent.areaId !== task.areaId) {
        throw new Error("SubtaskのAreaは親Taskと同じである必要があります。");
      }
    }
    let depth = 0;
    let current = task;
    const visited = new Set();
    while (current) {
      if (visited.has(current.id))
        throw new Error("Task treeに循環があります。");
      visited.add(current.id);
      depth += 1;
      if (depth > 5) throw new Error("Taskは5階層を超えられません。");
      current = current.parentId ? activeById.get(current.parentId) : null;
    }
  }
}

function assertEligibleNewParent(parent) {
  if (parent.status !== "OPEN") {
    throw new Error("Completed Taskを新しい親にできません。");
  }
  if (parent.recurrenceRule) {
    throw new Error("Recurring Taskを親にできません。");
  }
}

function normalizeAndValidateTaskDates(task, ownerTimeZone) {
  validateTaskDate(task.start, "Start");
  validateTaskDate(task.due, "Due");
  if (
    task.start &&
    task.due &&
    compareTaskDates(task.start, task.due, ownerTimeZone) > 0
  ) {
    throw new Error("DueをStartより前に設定できません。");
  }
  if (task.recurrenceRule === null) return null;
  let rule;
  try {
    rule = normalizeRecurrenceRule(task.recurrenceRule);
  } catch (error) {
    throw new Error("Recurrence Ruleが不正です。", { cause: error });
  }
  if (!task.start || !/^\d{4}-\d{2}-\d{2}$/u.test(task.start)) {
    throw new Error("Recurring Taskにはdate-onlyのStartが必要です。");
  }
  if (task.due !== null && task.due !== task.start) {
    throw new Error("Recurring TaskのDueは未設定またはStartと同日だけです。");
  }
  if (!recurrenceRuleMatchesDate(rule, task.start)) {
    throw new Error("Recurring TaskのStartがRecurrence Ruleに一致しません。");
  }
  return rule;
}

function validateTaskDate(value, label) {
  if (value === null) return;
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
  if (!startDateOnly && !dueDateOnly)
    return Date.parse(start) - Date.parse(due);
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
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function areaGuardSql(area) {
  return `EXISTS (SELECT 1 FROM areas WHERE id = ${area.id} AND name = ${sqlText(area.name)} AND color = ${sqlText(area.color)} AND position = ${area.position} AND is_system_managed = ${area.isSystemManaged ? 1 : 0} AND trashed_at ${sqlNullableCondition(area.trashedAt)})`;
}

function tagGuardSql(tag) {
  return `EXISTS (SELECT 1 FROM tags WHERE id = ${Number(tag.id)} AND name = ${sqlText(tag.name)})`;
}

function taskTagGuardSql(relation) {
  return `EXISTS (SELECT 1 FROM task_tags WHERE task_id = ${sqlText(relation.taskId)} AND tag_id = ${Number(relation.tagId)})`;
}

function taskGuardSql(task) {
  const fields = [
    ["title", task.title],
    ["description", task.description],
    ["work_notes", task.workNotes],
    ["status", task.status],
    ["area_id", task.areaId, true],
    ["parent_task_id", task.parentId],
    ["start", task.start],
    ["due", task.due],
    ["completed_at", task.completedAt],
    ["trashed_at", task.trashedAt],
    ["created_at", task.createdAt],
    ["updated_at", task.updatedAt],
    ["version", task.version, true],
    ["recurrence_rule", task.recurrenceRule],
    ["generated_from_task_id", task.generatedFromTaskId],
    ["trash_operation_id", task.trashOperationId],
  ];
  const conditions = fields.map(([column, value, numeric]) =>
    value === null
      ? `${column} IS NULL`
      : `${column} = ${numeric ? Number(value) : sqlText(value)}`,
  );
  return `EXISTS (SELECT 1 FROM tasks WHERE id = ${sqlText(task.id)} AND ${conditions.join(" AND ")})`;
}

function sqlNullableCondition(value) {
  return value === null ? "IS NULL" : `= ${sqlText(value)}`;
}

function sqlNullableText(value) {
  return value === null ? "NULL" : sqlText(value);
}

function sqlText(value) {
  return `CAST(X'${Buffer.from(String(value), "utf8").toString("hex")}' AS TEXT)`;
}

function areaIdSql(task) {
  if (task.areaId !== null) return String(task.areaId);
  return `(SELECT id FROM areas WHERE name = ${sqlText(task.areaName)} AND is_system_managed = 0 AND trashed_at IS NULL)`;
}

function groupKeySql(relocation) {
  if (relocation.parentId !== null) {
    return sqlText(`parent:${relocation.parentId}`);
  }
  if (relocation.areaName === "Inbox") return sqlText("inbox");
  if (relocation.areaId !== null) return sqlText(`area:${relocation.areaId}`);
  return `${sqlText("area:")} || (SELECT id FROM areas WHERE name = ${sqlText(relocation.areaName)} AND is_system_managed = 0 AND trashed_at IS NULL)`;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
