import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  askForConfirmation,
  ImportExecutionError,
  runImport,
} from "./import.mjs";

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
      throw new Error("JSON入力パスは1つだけ指定してください。");
    }
    options.inputPath = argument;
  }

  if (options.help) return options;
  if (options.environment !== "local" && options.environment !== "remote") {
    throw new Error("environmentにはlocalまたはremoteを指定してください。");
  }
  if (!options.inputPath) {
    throw new Error("importするJSON入力パスが必要です。");
  }
  return options;
}

export async function runCli(
  args = process.argv.slice(2),
  {
    input = process.stdin,
    output = process.stdout,
    errorOutput = process.stderr,
  } = {},
  execute = runImport,
) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      output.write(`${usage()}\n`);
      return 0;
    }
    const result = await execute({
      confirm: (details) => askForConfirmation({ ...details, input, output }),
      environment: options.environment,
      inputPath: options.inputPath,
    });
    if (result.status === "cancelled") {
      output.write("importをキャンセルしました。\n");
      return 0;
    }
    output.write(
      `importを実行しました: ${result.label} (${result.databaseName})\n`,
    );
    output.write(`変更前backup: ${result.backupPath}\n`);
    output.write(
      `${result.metrics.taskCount} Task / ${result.metrics.areaCount ?? 0} Area / ${result.metrics.tagCount ?? 0} Tag\n`,
    );
    output.write(
      `入力 ${result.metrics.inputBytes} bytes / SQL ${result.metrics.sqlBytes} bytes / ${result.durationMs ?? 0} ms\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ImportExecutionError) {
      errorOutput.write(
        `${error.resultUnknown ? "import実行結果は不明です" : "importに失敗しました"}: ${error.message}\n`,
      );
      if (error.backupPath) {
        errorOutput.write(`変更前backup: ${error.backupPath}\n`);
      }
    } else {
      errorOutput.write(`importに失敗しました: ${error.message}\n`);
    }
    return 1;
  }
}

function usage() {
  return `Database maintenance task JSON import

Usage:
  scripts/local-import.sh <tasks.json> | --help
  scripts/remote-import.sh <tasks.json> | --help

Each entrypoint fixes the target environment and loads its scripts/.env.* file.`;
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
