import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { runBackup as defaultRunBackup } from "./backup.mjs";
import { loadMaintenanceEnvironment } from "./environment.mjs";
import {
  buildMigrationPlan,
  isMigrationResultUnknown,
  readMigrations,
  resolveMigrationHistory,
  runWranglerQuery,
} from "./migration.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectRoot = resolve(scriptsDirectory, "..");
const defaultAppDirectory = resolve(defaultProjectRoot, "app");
const defaultMigrationDirectory = resolve(defaultAppDirectory, "migrations");

export const resetVerificationQuery = `SELECT
  (SELECT COUNT(*) FROM tasks) AS task_count,
  (SELECT COUNT(*) FROM tags) AS tag_count,
  (SELECT COUNT(*) FROM task_tags) AS task_tag_count,
  (SELECT COUNT(*) FROM areas) AS area_count,
  (SELECT COUNT(*) FROM areas
    WHERE name = 'Inbox'
      AND color = 'gray'
      AND position = 0
      AND is_system_managed = 1
      AND trashed_at IS NULL) AS inbox_count,
  (SELECT COUNT(*) FROM views) AS view_count,
  (SELECT COUNT(*) FROM task_manual_orders) AS manual_order_count,
  (SELECT COUNT(*) FROM today_task_orders) AS today_order_count,
  (SELECT COUNT(*) FROM owner_settings
    WHERE id = 1
      AND time_zone = 'Asia/Tokyo'
      AND week_starts_on = 0
      AND trash_retention_days = 30
      AND version = 1) AS owner_settings_count;`;

export const resetSql = `PRAGMA foreign_keys = ON;
DELETE FROM task_manual_orders;
DELETE FROM today_task_orders;
DELETE FROM views;
DELETE FROM task_tags;
DELETE FROM tasks;
DELETE FROM tags;
DELETE FROM areas;
DELETE FROM owner_settings;
INSERT INTO areas (name, color, position, is_system_managed)
VALUES ('Inbox', 'gray', 0, 1);
INSERT INTO owner_settings (
  id,
  time_zone,
  week_starts_on,
  trash_retention_days,
  version
)
VALUES (1, 'Asia/Tokyo', 0, 30, 1);
`;

export async function runReset({
  appDirectory = defaultAppDirectory,
  confirm = askForConfirmation,
  environment,
  migrationDirectory = defaultMigrationDirectory,
  persistTo,
  processEnvironment = process.env,
  projectRoot = defaultProjectRoot,
  runApply = runWranglerReset,
  runBackup = defaultRunBackup,
  runQuery = runWranglerQuery,
  runVerify = runWranglerVerify,
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
  const history = resolveMigrationHistory({
    runQuery: () =>
      runQuery({
        appDirectory,
        configPath: wranglerConfigPath,
        environmentConfig,
        persistTo,
      }),
  });
  const plan = buildMigrationPlan({ migrations, history });
  if (plan.pendingMigrations.length > 0) {
    throw new Error(
      [
        "対象DBのschemaがrepositoryと一致しないためresetを実行できません。",
        `未適用migration: ${plan.pendingMigrations.map(({ name }) => name).join(", ")}`,
        "先に通常のmigration／deployment手順でschemaを揃えてください。",
      ].join("\n"),
    );
  }

  const confirmed = await confirm({
    databaseName: environmentConfig.databaseName,
    environmentConfig,
    operation: "reset",
  });
  if (!confirmed) {
    return Object.freeze({
      databaseName: environmentConfig.databaseName,
      environment: environmentConfig.environment,
      label: environmentConfig.label,
      status: "cancelled",
    });
  }

  const backup = await runBackup({
    appDirectory,
    configPath: wranglerConfigPath,
    environment,
    operation: "reset",
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  const backupPath = backup?.path;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "taskseq-reset-"));
  const sqlPath = join(temporaryDirectory, "reset.sql");
  writeFileSync(sqlPath, resetSql, { flag: "wx", mode: 0o600 });

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
      throw new ResetExecutionError(error.message, {
        backupPath,
        cause: error,
        resultUnknown: isMigrationResultUnknown(error),
      });
    }

    let verification;
    try {
      verification = await runVerify({
        appDirectory,
        configPath: wranglerConfigPath,
        environmentConfig,
        persistTo,
      });
    } catch (error) {
      throw new ResetExecutionError("reset後の状態を確認できませんでした。", {
        backupPath,
        cause: error,
        resultUnknown: true,
      });
    }
    let resetState;
    try {
      resetState = parseResetVerificationOutput(verification);
    } catch (error) {
      throw new ResetExecutionError("reset後の状態を確認できませんでした。", {
        backupPath,
        cause: error,
        resultUnknown: true,
      });
    }
    try {
      assertResetState(resetState);
    } catch (error) {
      throw new ResetExecutionError(
        `reset後の状態が期待値と一致しません: ${error.message}`,
        {
          backupPath,
          cause: error,
          resultUnknown: false,
        },
      );
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }

  return Object.freeze({
    backupPath,
    databaseName: environmentConfig.databaseName,
    environment: environmentConfig.environment,
    label: environmentConfig.label,
    status: "applied",
  });
}

export class ResetExecutionError extends Error {
  constructor(message, { backupPath, cause, resultUnknown }) {
    super(message, { cause });
    this.name = "ResetExecutionError";
    this.backupPath = backupPath;
    this.resultUnknown = resultUnknown === true;
  }
}

export function askForConfirmation({
  databaseName,
  environmentConfig,
  input = process.stdin,
  output = process.stdout,
}) {
  const view = formatResetConfirmation({ databaseName, environmentConfig });
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

export function formatResetConfirmation({ databaseName, environmentConfig }) {
  return Object.freeze({
    message:
      `対象: ${environmentConfig.label} (${databaseName})\n` +
      "操作: DBを必須初期データだけにresetします。\n" +
      "Task、Tag、Area、View、並び順を削除し、InboxとOwner設定を既定値へ戻します。\n",
    prompt: "上記のresetを実行しますか？ [y/N]: ",
  });
}

export function runWranglerReset({
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
  try {
    const output = execFile("pnpm", args, {
      cwd: appDirectory,
      encoding: "utf8",
      env: environmentConfig.childEnvironment,
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

export function runWranglerVerify({
  appDirectory,
  configPath,
  environmentConfig,
  execFile = execFileSync,
  persistTo,
}) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    environmentConfig.databaseName,
    environmentConfig.scope,
    "--command",
    resetVerificationQuery,
    "--json",
  ];
  if (persistTo) {
    args.push("--persist-to", persistTo);
  }
  if (configPath) {
    args.push("--config", configPath);
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
    writeCommandOutput(error.stdout, process.stdout);
    writeCommandOutput(error.stderr, process.stderr);
    throw error;
  }
}

export function parseResetVerificationOutput(output) {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return output;
  }

  let payload;
  try {
    payload = typeof output === "string" ? JSON.parse(output) : output;
  } catch (error) {
    throw new Error("reset後のreadback JSONを解釈できませんでした。", {
      cause: error,
    });
  }

  const responses = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : [payload];
  const response = responses[0];
  if (
    !response ||
    response.success === false ||
    !Array.isArray(response.results) ||
    !response.results[0]
  ) {
    throw new Error("reset後のreadback JSONが不正です。");
  }
  return response.results[0];
}

export function assertResetState(state) {
  const expected = {
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
  for (const [key, value] of Object.entries(expected)) {
    if (state?.[key] !== value) {
      throw new Error(`${key}=${String(state?.[key])} (期待値: ${value})`);
    }
  }
  return state;
}

function writeCommandOutput(output, stream) {
  if (output) {
    stream.write(String(output));
  }
}
