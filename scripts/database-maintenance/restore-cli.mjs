import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  askForConfirmation,
  resolveInputPath,
  RestoreExecutionError,
  runRestore,
} from "./restore.mjs";

export function parseArguments(args) {
  const options = { environment: null, help: false, inputPath: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--environment") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--environmentには値が必要です。");
      }
      options.environment = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`不明な引数です: ${argument}`);
    }
    if (options.inputPath !== null) {
      throw new Error("SQL入力パスは1つだけ指定してください。");
    }
    options.inputPath = argument;
  }

  if (options.help) {
    return options;
  }
  if (options.environment !== "local" && options.environment !== "remote") {
    throw new Error("environmentにはlocalまたはremoteを指定してください。");
  }
  if (options.inputPath === null) {
    throw new Error("SQL入力パスを1つ指定してください。");
  }
  return options;
}

export async function runCli(
  args = process.argv.slice(2),
  {
    errorOutput = process.stderr,
    executeRestore = runRestore,
    input = process.stdin,
    launchDirectory = process.cwd(),
    output = process.stdout,
  } = {},
) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      output.write(`${usage()}\n`);
      return 0;
    }
    const inputPath = resolveInputPath(options.inputPath, launchDirectory);
    const result = await executeRestore({
      confirm: (details) => askForConfirmation({ ...details, input, output }),
      environment: options.environment,
      inputPath,
    });
    if (result.status === "cancelled") {
      output.write("restoreをキャンセルしました。\n");
    } else {
      output.write(
        `restoreを実行しました: ${result.label} (${result.databaseName})\n`,
      );
      output.write(`入力SQL: ${inputPath}\n`);
      output.write(`変更前backup: ${result.backupPath}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof RestoreExecutionError) {
      const statusMessage = error.resultUnknown
        ? "restore実行結果は不明です"
        : "restoreに失敗しました";
      errorOutput.write(`${statusMessage}: ${error.message}\n`);
      if (error.backupPath) {
        errorOutput.write(`変更前backup: ${error.backupPath}\n`);
      }
    } else {
      errorOutput.write(`restoreに失敗しました: ${error.message}\n`);
    }
    return 1;
  }
}

function usage() {
  return `Database maintenance restore

Usage:
  scripts/local-restore.sh <backup.sql>
  scripts/remote-restore.sh <backup.sql>
  scripts/local-restore.sh --help
  scripts/remote-restore.sh --help

Each entrypoint fixes the target environment and replaces the complete database.`;
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
