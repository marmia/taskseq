import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureBackupDirectory,
  loadMaintenanceEnvironment,
} from "./environment.mjs";
import { createMaintenanceOutput } from "./output.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectRoot = resolve(scriptsDirectory, "..");

export function runBackup({
  environment,
  operation = "backup",
  scriptDirectory = scriptsDirectory,
  projectRoot = defaultProjectRoot,
  appDirectory = resolve(projectRoot, "app"),
  configPath,
  processEnvironment = process.env,
  runCommand = runWranglerExport,
  now = () => new Date(),
} = {}) {
  const environmentConfig = loadMaintenanceEnvironment({
    environment,
    processEnvironment,
    projectRoot,
    scriptDirectory,
  });
  const backupDirectory = ensureBackupDirectory(environmentConfig);
  const path = createMaintenanceOutput({
    environment,
    extension: "sql",
    now,
    operation,
    outputDirectory: backupDirectory,
    validatePartial: assertExportedFile,
    writePartial: (temporaryPath) =>
      runCommand(environmentConfig, temporaryPath, appDirectory, configPath),
  });
  return Object.freeze({
    environment: environmentConfig.environment,
    path,
  });
}

function runWranglerExport(
  environmentConfig,
  outputPath,
  appDirectory,
  configPath,
) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "export",
    environmentConfig.databaseName,
    environmentConfig.scope,
    "--output",
    outputPath,
    "--skip-confirmation",
  ];
  if (configPath) {
    args.push("--config", configPath);
  }
  execFileSync("pnpm", args, {
    cwd: appDirectory,
    env: environmentConfig.childEnvironment,
    shell: false,
    stdio: "inherit",
  });
}

function assertExportedFile(path) {
  if (!existsSync(path)) {
    throw new Error("Wranglerがbackup SQLを出力しませんでした。");
  }
  const stat = lstatSync(path);
  if (!stat.isFile()) {
    throw new Error("backup SQLの出力先が通常のファイルではありません。");
  }
}
