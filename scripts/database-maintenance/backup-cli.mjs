import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runBackup } from "./backup.mjs";

export function runCli(
  args = process.argv.slice(2),
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      stdout.write(`${usage()}\n`);
      return 0;
    }

    const result = runBackup({ environment: options.environment });
    stdout.write(`backupを保存しました: ${result.path}\n`);
    return 0;
  } catch (error) {
    stderr.write(`backupに失敗しました: ${error.message}\n`);
    return 1;
  }
}

export function parseArguments(args) {
  const options = { environment: null, help: false, operation: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--operation" || argument === "--environment") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument}には値が必要です。`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`不明な引数です: ${argument}`);
  }

  if (options.help) {
    return options;
  }
  if (options.operation !== "backup") {
    throw new Error("operationにはbackupを指定してください。");
  }
  if (options.environment !== "local" && options.environment !== "remote") {
    throw new Error("environmentにはlocalまたはremoteを指定してください。");
  }
  return options;
}

function usage() {
  return `Database maintenance backup

Usage:
  scripts/local-backup.sh [--help]
  scripts/remote-backup.sh [--help]

The environment is fixed by each entrypoint and its scripts/.env.* file.`;
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = runCli();
}
