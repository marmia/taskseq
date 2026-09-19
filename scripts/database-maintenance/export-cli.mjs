import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runExport } from "./export.mjs";

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

export function runCli(
  args = process.argv.slice(2),
  { output = process.stdout, errorOutput = process.stderr } = {},
  execute = runExport,
) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      output.write(`${usage()}\n`);
      return 0;
    }

    const result = execute({ environment: options.environment });
    output.write(`exportを保存しました: ${result.path}\n`);
    return 0;
  } catch (error) {
    errorOutput.write(`exportに失敗しました: ${error.message}\n`);
    return 1;
  }
}

function usage() {
  return `Database maintenance task JSON export

Usage:
  scripts/local-export.sh [--help]
  scripts/remote-export.sh [--help]

Each entrypoint fixes the target environment and loads its scripts/.env.* file.
The operation is read-only and does not prompt for confirmation.`;
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = runCli();
}
