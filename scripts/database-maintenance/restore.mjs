import {
  statSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { runBackup as defaultRunBackup } from "./backup.mjs";
import { loadMaintenanceEnvironment } from "./environment.mjs";
import { isMigrationResultUnknown, readMigrations } from "./migration.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectRoot = resolve(scriptsDirectory, "..");
const defaultMigrationDirectory = resolve(defaultProjectRoot, "app", "migrations");
const tableDropOrder = Object.freeze([
  "task_tags",
  "task_manual_orders",
  "today_task_orders",
  "tasks",
  "tags",
  "views",
  "owner_settings",
  "areas",
]);

export async function runRestore({
  projectRoot = defaultProjectRoot,
  appDirectory = resolve(projectRoot, "app"),
  confirm = askForConfirmation,
  environment,
  inputPath,
  inspectInput = inspectRestoreInput,
  inspectRepository = inspectRepositorySchema,
  inspectTarget = inspectRestoreTarget,
  processEnvironment = process.env,
  migrationDirectory = resolve(projectRoot, "app", "migrations"),
  persistTo,
  runApply = runWranglerRestore,
  runBackup = defaultRunBackup,
  runQuery = runWranglerRestoreQuery,
  scriptDirectory = scriptsDirectory,
  wranglerConfigPath,
} = {}) {
  const resolvedInputPath = resolveInputPath(inputPath);
  const inputSql = readFileSync(resolvedInputPath, "utf8");
  const environmentConfig = loadMaintenanceEnvironment({
    environment,
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  const input = await inspectInput({
    environmentConfig,
    inputPath: resolvedInputPath,
    inputSql,
    migrationDirectory,
  });
  const repository = await inspectRepository({
    environmentConfig,
    migrationDirectory,
  });
  assertCompatibleStructure(input, repository, "入力SQL", "repository");
  const target = await inspectTarget({
    appDirectory,
    configPath: wranglerConfigPath,
    environmentConfig,
    persistTo,
    repository,
    runQuery,
  });
  assertCompatibleStructure(target, repository, "復元先DB", "repository");

  const confirmed = await confirm({
    databaseName: environmentConfig.databaseName,
    environmentConfig,
    inputPath: resolvedInputPath,
    operation: "restore",
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

  const backup = await runBackup({
    appDirectory,
    configPath: wranglerConfigPath,
    environment,
    operation: "restore",
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  const backupPath = backup?.path;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "taskseq-restore-"));
  const sqlPath = join(temporaryDirectory, "restore.sql");
  const restoreSql = buildReplacementSql({
    inputSql,
    targetSchema: target.schema,
  });
  writeFileSync(sqlPath, restoreSql, { flag: "wx", mode: 0o600 });
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
      throw new RestoreExecutionError(error.message, {
        backupPath,
        cause: error,
        resultUnknown: isMigrationResultUnknown(error),
      });
    }
    let restored;
    try {
      restored = await inspectTarget({
        appDirectory,
        configPath: wranglerConfigPath,
        environmentConfig,
        persistTo,
        repository,
        runQuery,
      });
    } catch (error) {
      throw new RestoreExecutionError("restore後の状態を確認できませんでした。", {
        backupPath,
        cause: error,
        resultUnknown: error?.resultUnknown !== false,
      });
    }
    try {
      assertEqualInspection(restored, input);
    } catch (error) {
      throw new RestoreExecutionError(error.message, {
        backupPath,
        cause: error,
        resultUnknown: false,
      });
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
  return Object.freeze({
    backupPath,
    databaseName: environmentConfig.databaseName,
    environment: environmentConfig.environment,
    inputPath: resolvedInputPath,
    label: environmentConfig.label,
    status: "applied",
  });
}

export class RestoreExecutionError extends Error {
  constructor(message, { backupPath, cause, resultUnknown }) {
    super(message, { cause });
    this.name = "RestoreExecutionError";
    this.backupPath = backupPath;
    this.resultUnknown = resultUnknown === true;
  }
}

export function askForConfirmation({
  databaseName,
  environmentConfig,
  input = process.stdin,
  inputPath,
  output = process.stdout,
}) {
  const view = formatRestoreConfirmation({
    databaseName,
    environmentConfig,
    inputPath,
  });
  output.write(view.message);
  const readline = createInterface({ input, output });
  return new Promise((resolveConfirmation) => {
    let settled = false;
    const finish = (confirmed) => {
      if (settled) {
        return;
      }
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

export function formatRestoreConfirmation({
  databaseName,
  environmentConfig,
  inputPath,
}) {
  return Object.freeze({
    message:
      `対象: ${environmentConfig.label} (${databaseName})\n` +
      "操作: DB全体を入力SQLの内容で置き換えてrestoreします。\n" +
      `入力: ${inputPath}\n` +
      "既存のTask、Area、Tag、View、Owner設定、並び順、Trashをすべて置き換えます。\n",
    prompt: "上記のrestoreを実行しますか？ [y/N]: ",
  });
}

export function resolveInputPath(inputPath, launchDirectory = process.cwd()) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error("restoreするSQL入力パスが必要です。");
  }
  const path = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(launchDirectory, inputPath);
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`SQL入力パスが通常のファイルではありません: ${path}`);
  }
  return path;
}

export function inspectRestoreInput({ inputPath, inputSql }) {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    database.setAuthorizer(restoreInputAuthorizer);
    database.exec(inputSql ?? readFileSync(inputPath, "utf8"));
    assertRequiredData(database);
    return snapshotDatabase(database);
  } catch (error) {
    throw new Error(`入力SQLを復元できません: ${error.message}`, {
      cause: error,
    });
  } finally {
    database.close();
  }
}

export function inspectRepositorySchema({
  migrationDirectory = defaultMigrationDirectory,
} = {}) {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    database.exec(
      'CREATE TABLE "d1_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);',
    );
    const insertMigration = database.prepare(
      "INSERT INTO d1_migrations (name) VALUES (?)",
    );
    for (const migration of readMigrations(migrationDirectory)) {
      database.exec(migration.sql);
      insertMigration.run(migration.name);
    }
    assertRequiredData(database);
    return snapshotDatabase(database);
  } finally {
    database.close();
  }
}

export function inspectRestoreTarget({
  appDirectory,
  configPath,
  environmentConfig,
  persistTo,
  repository,
  runQuery = runWranglerRestoreQuery,
}) {
  const structureOutput = runQuery({
    appDirectory,
    configPath,
    environmentConfig,
    persistTo,
    sql: `${migrationNamesQuery}; ${schemaQuery(environmentConfig.environment)};`,
  });
  const structureResponses = parseWranglerResponses(structureOutput);
  if (structureResponses.length !== 2) {
    throw new Error("復元先DBのschemaとmigration履歴を確認できませんでした。");
  }
  const migrations = structureResponses[0].map(({ name }) => name);
  const schema = rows(structureResponses[1]);
  try {
    assertCompatibleStructure(
      { migrations, schema },
      repository,
      "復元先DB",
      "repository",
    );
  } catch (error) {
    throw knownInspectionError(error);
  }

  const tableNames = schema
    .filter(({ type }) => type === "table")
    .map(({ name }) => name);
  const dataOutput = runQuery({
    appDirectory,
    configPath,
    environmentConfig,
    persistTo,
    sql: [
      "PRAGMA foreign_key_check",
      ...tableNames.map(
        (name) => `SELECT * FROM ${quoteIdentifier(name)}`,
      ),
      "SELECT name, seq FROM sqlite_sequence ORDER BY name",
    ].join("; "),
  });
  const dataResponses = parseWranglerResponses(dataOutput);
  if (dataResponses.length !== tableNames.length + 2) {
    throw new Error("復元先DBのdataを確認できませんでした。");
  }
  if (dataResponses[0].length > 0) {
    throw knownInspectionError(
      new Error("復元先DBに参照整合性違反があります。"),
    );
  }
  const data = Object.fromEntries(
    tableNames.map((name, index) => [
      name,
      canonicalRows(dataResponses[index + 1]),
    ]),
  );
  return Object.freeze({
    data,
    migrations,
    schema,
    sequence: canonicalRows(dataResponses.at(-1)),
  });
}

export function buildReplacementSql({ inputSql, targetSchema }) {
  const drops = [...(targetSchema ?? [])]
    .filter(({ type }) => ["trigger", "view"].includes(type))
    .sort((left, right) => left.type.localeCompare(right.type))
    .map(({ name, type }) =>
      `DROP ${type.toUpperCase()} IF EXISTS ${quoteIdentifier(name)};`,
    );
  const tables = [...(targetSchema ?? [])]
    .filter(({ type }) => type === "table")
    .sort(
      (left, right) =>
        tableDropRank(left.name) - tableDropRank(right.name) ||
        left.name.localeCompare(right.name),
    )
    .map(({ name }) => `DROP TABLE IF EXISTS ${quoteIdentifier(name)};`);
  tables.push('DROP TABLE IF EXISTS "d1_migrations";');
  return `PRAGMA defer_foreign_keys=TRUE;\n${[...drops, ...tables].join("\n")}\n${inputSql}`;
}

function assertCompatibleStructure(left, right, leftLabel, rightLabel) {
  if (JSON.stringify(left?.schema) !== JSON.stringify(right?.schema)) {
    throw new Error(`${leftLabel}と${rightLabel}のschemaが一致しません。`);
  }
  if (JSON.stringify(left?.migrations) !== JSON.stringify(right?.migrations)) {
    throw new Error(`${leftLabel}と${rightLabel}のmigration履歴が一致しません。`);
  }
}

function assertEqualInspection(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("restore後のDBが入力SQLの内容と一致しません。");
  }
}

function snapshotDatabase(database) {
  const schema = rows(
    database
      .prepare(
        `SELECT name, type, tbl_name, sql
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%'
           AND name != 'd1_migrations'
         ORDER BY type, name`,
      )
      .all(),
  );
  const migrations = database
    .prepare("SELECT name FROM d1_migrations ORDER BY id")
    .all()
    .map(({ name }) => name);
  const data = {};
  for (const { name } of schema.filter(({ type }) => type === "table")) {
    const columns = database
      .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
      .all()
      .map(({ name: columnName }) => columnName);
    data[name] = canonicalRows(
      database
        .prepare(
          `SELECT * FROM ${quoteIdentifier(name)} ORDER BY ${columns.map(quoteIdentifier).join(", ")}`,
        )
        .all(),
    );
  }
  const foreignKeyViolations = rows(
    database.prepare("PRAGMA foreign_key_check").all(),
  );
  if (foreignKeyViolations.length > 0) {
    throw new Error("参照整合性に違反するdataが含まれています。");
  }
  const sequence = canonicalRows(
    database
      .prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name')
      .all(),
  );
  return Object.freeze({ data, migrations, schema, sequence });
}

function assertRequiredData(database) {
  const state = database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM areas
          WHERE name = 'Inbox'
            AND color = 'gray'
            AND position = 0
            AND is_system_managed = 1
            AND trashed_at IS NULL) AS inbox_count,
        (SELECT COUNT(*) FROM areas WHERE is_system_managed = 1) AS system_area_count,
        (SELECT COUNT(*) FROM owner_settings WHERE id = 1) AS owner_count,
        (SELECT COUNT(*) FROM owner_settings) AS owner_total`,
    )
    .get();
  if (
    state.inbox_count !== 1 ||
    state.system_area_count !== 1 ||
    state.owner_count !== 1 ||
    state.owner_total !== 1
  ) {
    throw new Error("必須のInboxまたはOwner設定が不正です。");
  }
}

function rows(values) {
  return values.map((row) => Object.fromEntries(Object.entries(row)));
}

function canonicalRows(values) {
  return rows(values).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

const migrationNamesQuery = "SELECT name FROM d1_migrations ORDER BY id";
function schemaQuery(environment) {
  const systemTable = ["local", "local-test"].includes(environment)
    ? "_cf_METADATA"
    : "_cf_KV";
  return `SELECT name, type, tbl_name, sql
FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%'
  AND name != '${systemTable}'
  AND name != 'd1_migrations'
  ${environment === "remote-test" ? "AND name != 'taskseq_maintenance_test_lock'" : ""}
ORDER BY type, name`;
}

export function parseWranglerResponses(output) {
  let payload;
  try {
    payload = typeof output === "string" ? JSON.parse(output) : output;
  } catch (error) {
    throw new Error("Wranglerのrestore検証JSONを解釈できませんでした。", {
      cause: error,
    });
  }
  const responses = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : [payload];
  if (
    responses.some(
      (response) =>
        !response || response.success === false || !Array.isArray(response.results),
    )
  ) {
    throw new Error("Wranglerのrestore検証JSONが不正です。");
  }
  return responses.map(({ results }) => results);
}

export function runWranglerRestoreQuery({
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
  if (persistTo) {
    args.push("--persist-to", persistTo);
  }
  if (configPath) {
    args.push("--config", configPath);
  }
  return execFile("pnpm", args, {
    cwd: appDirectory,
    encoding: "utf8",
    env: environmentConfig.childEnvironment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function runWranglerRestore({
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
  if (persistTo) {
    args.push("--persist-to", persistTo);
  }
  if (configPath) {
    args.push("--config", configPath);
  }
  return execFile("pnpm", args, {
    cwd: appDirectory,
    encoding: "utf8",
    env: environmentConfig.childEnvironment,
    shell: false,
    stdio: ["inherit", "pipe", "pipe"],
  });
}

function tableDropRank(name) {
  const index = tableDropOrder.indexOf(name);
  return index === -1 ? tableDropOrder.length : index;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function restoreInputAuthorizer(actionCode) {
  if (
    [
      sqliteConstants.SQLITE_ATTACH,
      sqliteConstants.SQLITE_DETACH,
      sqliteConstants.SQLITE_SAVEPOINT,
      sqliteConstants.SQLITE_TRANSACTION,
    ].includes(actionCode)
  ) {
    return sqliteConstants.SQLITE_DENY;
  }
  return sqliteConstants.SQLITE_OK;
}

function knownInspectionError(error) {
  error.resultUnknown = false;
  return error;
}
