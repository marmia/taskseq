import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMaintenanceEnvironment } from "../database-maintenance/environment.mjs";
import { runMigration } from "../database-maintenance/migration.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(scriptsDirectory, "..");
const appDirectory = resolve(repositoryRoot, "app");
const migrationDirectory = resolve(appDirectory, "migrations");

export function createLocalTestTarget({ execFile = execFileSync } = {}) {
  const root = mkdtempSync(join(tmpdir(), "taskseq-local-test-"));
  const scriptDirectory = join(root, "scripts");
  const backupDirectory = join(root, "backups");
  const databaseName = `taskseq-local-test-${randomUUID()}`;
  mkdirSync(scriptDirectory);
  mkdirSync(backupDirectory);
  writeFileSync(
    join(scriptDirectory, ".env.local-test"),
    `D1_DATABASE_NAME=${databaseName}\nD1_BACKUP_DIR=${backupDirectory}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const configPath = join(root, "wrangler.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        name: "taskseq-maintenance-local-test",
        d1_databases: [
          {
            binding: "DB",
            database_name: databaseName,
            database_id: "local",
            migrations_dir: migrationDirectory,
          },
        ],
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const environmentConfig = loadMaintenanceEnvironment({
    environment: "local-test",
    projectRoot: repositoryRoot,
    scriptDirectory,
  });

  const target = {
    appDirectory,
    backupDirectory,
    configPath,
    databaseName,
    migrationDirectory,
    projectRoot: repositoryRoot,
    repositoryMigrationCount: countRepositoryMigrations(),
    repositoryMigrationNames: listRepositoryMigrations(),
    root,
    scriptDirectory,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    executeCommand(sql) {
      return runWrangler({ sql });
    },
    executeFile(path) {
      return runWrangler({ file: path });
    },
    async migrateToRepositorySchema() {
      return runMigration({
        appDirectory,
        confirm: async () => true,
        environment: "local-test",
        projectRoot: repositoryRoot,
        scriptDirectory,
        wranglerConfigPath: configPath,
      });
    },
    query(sql) {
      return parseWranglerRows(runWrangler({ sql }));
    },
  };
  return Object.freeze(target);

  function runWrangler({ file, sql }) {
    const args = [
      "exec",
      "wrangler",
      "d1",
      "execute",
      databaseName,
      "--local",
      "--config",
      configPath,
      ...(file ? ["--file", file] : ["--command", sql]),
      ...(file ? ["--yes"] : []),
      "--json",
    ];
    return execFile("pnpm", args, {
      cwd: appDirectory,
      encoding: "utf8",
      env: environmentConfig.childEnvironment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
}

export function parseWranglerRows(output) {
  const payload = typeof output === "string" ? JSON.parse(output) : output;
  const responses = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : [payload];
  const rows = [];
  for (const response of responses) {
    if (response?.success === false) {
      throw new Error(response.error ?? "Wrangler query failed");
    }
    if (Array.isArray(response?.results)) {
      rows.push(...response.results);
    }
  }
  return rows;
}

function countRepositoryMigrations() {
  return listRepositoryMigrations().length;
}

function listRepositoryMigrations() {
  return readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}
