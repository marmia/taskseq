import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  askForConfirmation,
  MigrationExecutionError,
  runMigration,
} from "./migration.mjs";

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

    const result = await runMigration({
      confirm: (details) => askForConfirmation({ ...details, input, output }),
      environment: options.environment,
    });
    if (result.status === "up-to-date") {
      output.write(`適用不要です: ${result.label} (${result.databaseName})\n`);
    } else if (result.status === "cancelled") {
      output.write("migrationをキャンセルしました。\n");
    } else {
      output.write(
        `migrationを適用しました: ${result.label} (${result.databaseName})\n`,
      );
      output.write(`移行前backup: ${result.backupPath}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof MigrationExecutionError) {
      const statusMessage = error.resultUnknown
        ? "migration適用結果は不明です"
        : "migration適用に失敗しました";
      errorOutput.write(`${statusMessage}: ${error.message}\n`);
      if (error.backupPath) {
        errorOutput.write(`移行前backup: ${error.backupPath}\n`);
      }
    } else {
      errorOutput.write(`migrationに失敗しました: ${error.message}\n`);
    }
    return 1;
  }
}

function usage() {
  return `Database maintenance migration

Usage:
  scripts/local-migration.sh [--help]
  scripts/remote-migration.sh [--help]

Each entrypoint fixes the target environment and loads its scripts/.env.* file.`;
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
