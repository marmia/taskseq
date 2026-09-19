import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { runBackup as defaultRunBackup } from "./backup.mjs";
import { loadMaintenanceEnvironment } from "./environment.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectRoot = resolve(scriptsDirectory, "..");
const defaultAppDirectory = resolve(defaultProjectRoot, "app");
const defaultMigrationDirectory = resolve(defaultAppDirectory, "migrations");

export function readMigrations(migrationDirectory = defaultMigrationDirectory) {
  const names = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  if (names.length === 0) {
    throw new Error(`migrationがありません: ${migrationDirectory}`);
  }
  return names.map((name) => ({
    name,
    sql: readFileSync(join(migrationDirectory, name), "utf8"),
  }));
}

export function buildMigrationPlan({ migrations, history }) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error("適用するmigrationがありません。");
  }
  if (!history || !Array.isArray(history.names)) {
    throw new Error("migration履歴を読み取れませんでした。");
  }

  const repositoryNames = migrations.map(({ name }) => name);
  const appliedNames = history.names;
  if (history.tableExists !== true && appliedNames.length > 0) {
    throw migrationHistoryMismatchError(repositoryNames, appliedNames);
  }
  const mismatchIndex = appliedNames.findIndex(
    (name, index) => name !== repositoryNames[index],
  );
  if (mismatchIndex !== -1 || appliedNames.length > repositoryNames.length) {
    throw migrationHistoryMismatchError(repositoryNames, appliedNames);
  }

  return Object.freeze({
    appliedNames: [...appliedNames],
    historyTableExists: history.tableExists === true,
    pendingMigrations: migrations.slice(appliedNames.length),
  });
}

export async function runMigration({
  appDirectory = defaultAppDirectory,
  confirm = askForConfirmation,
  environment,
  migrationDirectory = resolve(appDirectory, "migrations"),
  persistTo,
  processEnvironment = process.env,
  projectRoot = defaultProjectRoot,
  runBackup = defaultRunBackup,
  runQuery = runWranglerQuery,
  runApply = runWranglerApply,
  scriptDirectory = scriptsDirectory,
  wranglerConfigPath,
} = {}) {
  const environmentConfig = loadMaintenanceEnvironment({
    environment,
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  const migrations = readMigrations(migrationDirectory);
  const wranglerConfig = createWranglerConfig({
    environmentConfig,
    migrationDirectory,
    persistTo,
    wranglerConfigPath,
  });
  try {
    const history = resolveMigrationHistory({
      runQuery: () =>
        runQuery({
          appDirectory,
          configPath: wranglerConfig.path,
          environmentConfig,
          persistTo,
        }),
    });
    const plan = buildMigrationPlan({ migrations, history });

    if (plan.pendingMigrations.length === 0) {
      return Object.freeze({
        ...plan,
        databaseName: environmentConfig.databaseName,
        environment: environmentConfig.environment,
        label: environmentConfig.label,
        status: "up-to-date",
      });
    }

    const confirmed = await confirm({
      environmentConfig,
      pendingMigrations: plan.pendingMigrations,
    });
    if (!confirmed) {
      return Object.freeze({
        ...plan,
        databaseName: environmentConfig.databaseName,
        environment: environmentConfig.environment,
        label: environmentConfig.label,
        status: "cancelled",
      });
    }

    const backup = await runBackup({
      appDirectory,
      configPath: wranglerConfig.path,
      environment,
      processEnvironment,
      projectRoot,
      scriptDirectory,
    });
    const backupPath = backup?.path;

    try {
      await runApply({
        appDirectory,
        configPath: wranglerConfig.path,
        environmentConfig,
        persistTo,
        pendingMigrations: plan.pendingMigrations,
      });
    } catch (error) {
      throw new MigrationExecutionError(error.message, {
        backupPath,
        cause: error,
        pendingMigrations: plan.pendingMigrations,
        resultUnknown: isMigrationResultUnknown(error),
      });
    }

    return Object.freeze({
      ...plan,
      backupPath,
      databaseName: environmentConfig.databaseName,
      environment: environmentConfig.environment,
      label: environmentConfig.label,
      status: "applied",
    });
  } finally {
    wranglerConfig.cleanup();
  }
}

export class MigrationExecutionError extends Error {
  constructor(
    message,
    { backupPath, cause, pendingMigrations, resultUnknown },
  ) {
    super(message, { cause });
    this.name = "MigrationExecutionError";
    this.backupPath = backupPath;
    this.pendingMigrations = pendingMigrations;
    this.resultUnknown = resultUnknown === true;
  }
}

export function askForConfirmation({
  environmentConfig,
  input = process.stdin,
  output = process.stdout,
  pendingMigrations,
}) {
  const view = formatMigrationConfirmation({
    environmentConfig,
    pendingMigrations,
  });
  output.write(view.message);

  const readline = createInterface({ input, output });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed) => {
      if (settled) {
        return;
      }
      settled = true;
      readline.close();
      resolve(confirmed);
    };
    readline.once("close", () => finish(false));
    readline.question(view.prompt, (answer) => {
      finish(/^[yY]$/u.test(answer.trim()));
    });
  });
}

export function formatMigrationConfirmation({
  environmentConfig,
  pendingMigrations,
}) {
  return Object.freeze({
    message: [
      `対象: ${environmentConfig.label} (${environmentConfig.databaseName})`,
      "適用するmigration:",
      ...pendingMigrations.map(({ name }) => `- ${name}`),
      "",
    ].join("\n"),
    prompt: "上記のmigrationを適用しますか？ [y/N]: ",
  });
}

export function runWranglerQuery({
  appDirectory,
  configPath,
  environmentConfig,
  persistTo,
  execFile = execFileSync,
}) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    environmentConfig.databaseName,
    environmentConfig.scope,
    "--command",
    "SELECT name FROM d1_migrations ORDER BY id",
    "--json",
  ];
  if (configPath) {
    args.push("--config", configPath);
  }
  if (persistTo) {
    args.push("--persist-to", persistTo);
  }
  try {
    return execFile("pnpm", args, {
      cwd: appDirectory,
      encoding: "utf8",
      env: environmentConfig.childEnvironment,
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error("Wranglerのmigration履歴取得に失敗しました。", {
      cause: error,
    });
  }
}

export function runWranglerApply({
  appDirectory,
  configPath,
  environmentConfig,
  persistTo,
  execFile = execFileSync,
}) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    environmentConfig.databaseName,
    environmentConfig.scope,
  ];
  if (configPath) {
    args.push("--config", configPath);
  }
  if (persistTo) {
    args.push("--persist-to", persistTo);
  }
  try {
    const output = execFile("pnpm", args, {
      cwd: appDirectory,
      encoding: "utf8",
      env: { ...environmentConfig.childEnvironment, CI: "1" },
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    });
    writeCommandOutput(output, process.stdout);
  } catch (error) {
    writeCommandOutput(error.stdout, process.stdout);
    writeCommandOutput(error.stderr, process.stderr);
    throw error;
  }
}

export function isMigrationResultUnknown(error) {
  if (error?.resultUnknown === true || error?.signal) {
    return true;
  }
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "ENETUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT",
    ].includes(error?.code)
  ) {
    return true;
  }
  return /fetch failed|network error|socket hang up|timed? ?out/iu.test(
    collectErrorText(error),
  );
}

function createWranglerConfig({
  environmentConfig,
  migrationDirectory,
  persistTo,
  wranglerConfigPath,
}) {
  if (wranglerConfigPath) {
    return { cleanup() {}, path: wranglerConfigPath };
  }
  if (environmentConfig.scope === "--local" && !persistTo) {
    return { cleanup() {}, path: null };
  }

  const directory = mkdtempSync(join(tmpdir(), "taskseq-migration-config-"));
  const path = join(directory, "wrangler.json");
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        name: "taskseq-maintenance",
        d1_databases: [
          {
            binding: "DB",
            database_name: environmentConfig.databaseName,
            ...(environmentConfig.scope === "--local"
              ? { database_id: "local" }
              : {}),
            migrations_dir: migrationDirectory,
          },
        ],
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return {
    cleanup() {
      rmSync(directory, { force: true, recursive: true });
    },
    path,
  };
}

export function parseMigrationHistoryOutput(output) {
  let payload;
  try {
    payload = typeof output === "string" ? JSON.parse(output) : output;
  } catch (error) {
    throw new Error("Wranglerのmigration履歴JSONを解釈できませんでした。", {
      cause: error,
    });
  }

  const responses = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : [payload];
  const response = responses[0];
  const errorText = payload?.error?.text ?? response?.error?.text;
  if (errorText) {
    throw new Error(String(errorText));
  }
  if (
    !response ||
    response.success === false ||
    !Array.isArray(response.results)
  ) {
    throw new Error("Wranglerのmigration履歴JSONが不正です。");
  }

  const names = response.results.map((row) => row?.name);
  if (names.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error("migration履歴に不正な名前があります。");
  }
  return { names, tableExists: true };
}

export function resolveMigrationHistory({ runQuery }) {
  try {
    return normalizeMigrationHistory(runQuery());
  } catch (error) {
    if (isMissingMigrationTableError(error)) {
      return { names: [], tableExists: false };
    }
    throw error;
  }
}

export function isMissingMigrationTableError(error) {
  if (error?.missingMigrationTable === true) {
    return true;
  }
  const text = collectErrorText(error);
  return /no such table:\s*[`"']?d1_migrations[`"']?/iu.test(text);
}

function normalizeMigrationHistory(value) {
  if (
    value &&
    typeof value === "object" &&
    value.tableExists !== undefined &&
    Array.isArray(value.names)
  ) {
    return {
      names: [...value.names],
      tableExists: value.tableExists === true,
    };
  }
  return parseMigrationHistoryOutput(value);
}

function collectErrorText(error, visited = new Set()) {
  if (!error || visited.has(error)) {
    return "";
  }
  visited.add(error);
  return [
    error.message,
    error.stdout,
    error.stderr,
    collectErrorText(error.cause, visited),
  ]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join("\n");
}

function writeCommandOutput(output, stream) {
  if (output) {
    stream.write(String(output));
  }
}

function migrationHistoryMismatchError(expected, actual) {
  return new Error(
    [
      "対象DBのmigration履歴がrepositoryと一致しません。履歴の欠落・順序不整合・未知のmigrationを確認してから再実行してください。",
      `repository: ${expected.join(", ") || "(なし)"}`,
      `対象DB: ${actual.join(", ") || "(なし)"}`,
    ].join("\n"),
  );
}
