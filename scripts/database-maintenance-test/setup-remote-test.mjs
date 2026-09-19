import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMaintenanceEnvironment } from "../database-maintenance/environment.mjs";
import {
  createRemoteTestConfiguration,
  parseD1DatabaseList,
  resolveRemoteDatabaseIdentity,
} from "./remote-target.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(scriptsDirectory, "..");
const appDirectory = resolve(repositoryRoot, "app");

export function setupRemoteTestConfig({
  output = process.stdout,
  replace = false,
} = {}) {
  const production = loadMaintenanceEnvironment({ environment: "remote" });
  const configPath = resolve(scriptsDirectory, ".env.remote-test");
  if (existsSync(configPath) && !replace) {
    throw new Error(
      `${configPath}は既に存在します。既存設定を上書きしません。`,
    );
  }
  const databases = parseD1DatabaseList(
    execFileSync("pnpm", ["exec", "wrangler", "d1", "list", "--json"], {
      cwd: appDirectory,
      encoding: "utf8",
      env: production.childEnvironment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  resolveRemoteDatabaseIdentity({
    databases,
    productionAccountId: production.accountId,
    productionDatabaseName: production.databaseName,
    testAccountId: production.accountId,
    testDatabaseName: "taskseq-test",
  });
  writeFileSync(configPath, createRemoteTestConfiguration(production), {
    flag: replace ? "w" : "wx",
    mode: 0o600,
  });
  output.write(
    "remote-test設定を作成しました: scripts/.env.remote-test (taskseq-test, ID非表示)\n",
  );
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((argument) => argument !== "--replace")) {
      throw new Error(
        "Usage: scripts/setup-remote-maintenance-test.sh [--replace]",
      );
    }
    setupRemoteTestConfig({ replace: args.includes("--replace") });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
