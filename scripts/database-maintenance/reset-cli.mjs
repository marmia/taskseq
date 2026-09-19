import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  askForConfirmation,
  ResetExecutionError,
  runReset,
} from "./reset.mjs";

export function parseArguments(args) {
  const options = { environment: null, help: false };
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
    throw new Error(`不明な引数です: ${argument}`);
  }

  if (options.help) {
    return options;
  }
  if (options.environment !== "local" && options.environment !== "remote") {
    throw new Error("environmentにはlocalまたはremoteを指定してください。");
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
) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      output.write(`${usage()}\n`);
      return 0;
    }

    const result = await runReset({
      confirm: (details) => askForConfirmation({ ...details, input, output }),
      environment: options.environment,
    });
    if (result.status === "cancelled") {
      output.write("resetをキャンセルしました。\n");
    } else {
      output.write(
        `resetを実行しました: ${result.label} (${result.databaseName})\n`,
      );
      output.write(`変更前backup: ${result.backupPath}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ResetExecutionError) {
      const statusMessage = error.resultUnknown
        ? "reset実行結果は不明です"
        : "resetに失敗しました";
      errorOutput.write(`${statusMessage}: ${error.message}\n`);
      if (error.backupPath) {
        errorOutput.write(`変更前backup: ${error.backupPath}\n`);
      }
    } else {
      errorOutput.write(`resetに失敗しました: ${error.message}\n`);
    }
    return 1;
  }
}

function usage() {
  return `Database maintenance reset

Usage:
  scripts/local-reset.sh [--help]
  scripts/remote-reset.sh [--help]

Each entrypoint fixes the target environment and loads its scripts/.env.* file.`;
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
