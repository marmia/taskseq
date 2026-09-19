import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMaintenanceEnvironment } from "../database-maintenance/environment.mjs";
import { runExport } from "../database-maintenance/export.mjs";
import { runMigration } from "../database-maintenance/migration.mjs";
import { parseWranglerRows } from "./d1-harness.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(scriptsDirectory, "..");
const appDirectory = resolve(repositoryRoot, "app");
const migrationDirectory = resolve(appDirectory, "migrations");
export const productionMigrationSnapshotPath = resolve(
  scriptsDirectory,
  ".reports",
  "production-migration-history.json",
);
const lockTable = "taskseq_maintenance_test_lock";
const repositoryForeignKeys = Object.freeze([
  Object.freeze({ child: "tasks", parent: "areas" }),
  Object.freeze({ child: "task_tags", parent: "tasks" }),
  Object.freeze({ child: "task_tags", parent: "tags" }),
  Object.freeze({ child: "task_manual_orders", parent: "tasks" }),
  Object.freeze({ child: "today_task_orders", parent: "tasks" }),
]);

export function parseD1DatabaseList(output) {
  let payload;
  try {
    payload = typeof output === "string" ? JSON.parse(output) : output;
  } catch (error) {
    throw new Error("WranglerのD1 database list JSONを解釈できませんでした。", {
      cause: error,
    });
  }
  const databases = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : null;
  if (
    !databases ||
    databases.some(
      (database) =>
        typeof database?.name !== "string" ||
        typeof (database.uuid ?? database.id) !== "string",
    )
  ) {
    throw new Error("WranglerのD1 database list JSONが不正です。");
  }
  return databases;
}

export function writeProductionMigrationSnapshot({
  capturedAt = new Date(),
  migrationNames,
  path = productionMigrationSnapshotPath,
}) {
  const snapshot = {
    capturedAt: capturedAt.toISOString(),
    migrationNames: validateMigrationNames(migrationNames),
    schemaVersion: 1,
  };
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
    mode: 0o600,
  });
  return Object.freeze(snapshot);
}

export function readProductionMigrationSnapshot(
  path = productionMigrationSnapshotPath,
) {
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      "production migration snapshotを読めません。先にproduction-readonlyを明示実行してください。",
      { cause: error },
    );
  }
  if (
    snapshot?.schemaVersion !== 1 ||
    typeof snapshot.capturedAt !== "string" ||
    Number.isNaN(Date.parse(snapshot.capturedAt))
  ) {
    throw new Error("production migration snapshotが不正です。");
  }
  return Object.freeze({
    capturedAt: snapshot.capturedAt,
    migrationNames: validateMigrationNames(snapshot.migrationNames),
    schemaVersion: 1,
  });
}

export function validateProductionMigrationPrefix({
  productionNames,
  repositoryNames,
}) {
  const production = validateMigrationNames(productionNames);
  const repository = validateMigrationNames(repositoryNames);
  if (
    production.length > repository.length ||
    production.some((name, index) => repository[index] !== name)
  ) {
    throw new Error(
      "production migration履歴がrepository migrationのprefixではありません。",
    );
  }
  return production;
}

function validateMigrationNames(names) {
  if (
    !Array.isArray(names) ||
    names.some(
      (name) => typeof name !== "string" || !/^\d+_.+\.sql$/u.test(name),
    )
  ) {
    throw new Error("migration name一覧が不正です。");
  }
  return [...names];
}

export function createRemoteTestConfiguration(
  productionConfig,
  { backupDirectory = join(tmpdir(), "taskseq-remote-test-backups") } = {},
) {
  const entries = [
    ["D1_DATABASE_NAME", "taskseq-test"],
    ["D1_BACKUP_DIR", backupDirectory],
    ["CLOUDFLARE_ACCOUNT_ID", productionConfig.accountId],
    ["CLOUDFLARE_API_TOKEN", productionConfig.apiToken],
  ].filter(([, value]) => typeof value === "string" && value.length > 0);
  return `${entries
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

export function resolveConfiguredRemoteTargets({
  execFile = execFileSync,
  projectRoot = repositoryRoot,
  scriptDirectory = scriptsDirectory,
} = {}) {
  const productionConfig = loadMaintenanceEnvironment({
    environment: "remote",
    projectRoot,
    scriptDirectory,
  });
  const testConfig = loadMaintenanceEnvironment({
    environment: "remote-test",
    projectRoot,
    scriptDirectory,
  });
  const output = execFile(
    "pnpm",
    ["exec", "wrangler", "d1", "list", "--json"],
    {
      cwd: resolve(projectRoot, "app"),
      encoding: "utf8",
      env: testConfig.childEnvironment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const identity = resolveRemoteDatabaseIdentity({
    databases: parseD1DatabaseList(output),
    productionAccountId: productionConfig.accountId,
    productionDatabaseName: productionConfig.databaseName,
    testAccountId: testConfig.accountId,
    testDatabaseName: testConfig.databaseName,
  });
  return Object.freeze({ identity, productionConfig, testConfig });
}

export function createRemoteTestTarget({ execFile = execFileSync } = {}) {
  const configured = resolveConfiguredRemoteTargets({ execFile });
  const root = mkdtempSync(join(tmpdir(), "taskseq-remote-test-"));
  const configPath = join(root, "wrangler.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        name: "taskseq-maintenance-remote-test",
        d1_databases: [
          {
            binding: "DB",
            database_name: configured.identity.remoteTest.name,
            database_id: configured.identity.remoteTest.databaseId,
            migrations_dir: migrationDirectory,
          },
        ],
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );

  const target = {
    appDirectory,
    configPath,
    identity: configured.identity,
    migrationDirectory,
    projectRoot: repositoryRoot,
    repositoryMigrationCount: readdirSync(migrationDirectory).filter((name) =>
      /^\d+_.+\.sql$/u.test(name),
    ).length,
    root,
    scriptDirectory: scriptsDirectory,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    clearApplicationSchema() {
      const objects = this.query(
        "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'",
      );
      const commands = objects
        .filter(({ type }) => type !== "table")
        .sort((left, right) => left.type.localeCompare(right.type))
        .map(
          (object) =>
            `DROP ${object.type.toUpperCase()} IF EXISTS ${quoteIdentifier(object.name)}`,
        );
      const tables = objects
        .filter(({ name, type }) => type === "table" && name !== lockTable)
        .map(({ name }) => name);
      if (tables.length > 0) {
        commands.push(
          ...orderTablesForDrop(tables, repositoryForeignKeys).map(
            (name) => `DROP TABLE IF EXISTS ${quoteIdentifier(name)}`,
          ),
        );
      }
      if (commands.length > 0) {
        this.executeCommand(commands.join("; "));
      }
    },
    executeCommand(sql) {
      return runWrangler({ sql });
    },
    executeFile(path) {
      return runWrangler({ file: path });
    },
    async migrateToRepositorySchema({ backup = false } = {}) {
      return runMigration({
        appDirectory,
        confirm: async () => true,
        environment: "remote-test",
        projectRoot: repositoryRoot,
        scriptDirectory: scriptsDirectory,
        wranglerConfigPath: configPath,
        ...(backup ? {} : { runBackup: () => ({ path: "test-harness" }) }),
      });
    },
    query(sql) {
      return parseWranglerRows(runWrangler({ sql }));
    },
    async resetToLatestSchema() {
      this.clearApplicationSchema();
      await this.migrateToRepositorySchema();
    },
  };
  return Object.freeze(target);

  function runWrangler({ file, sql }) {
    return executeRemoteD1({
      configPath,
      databaseName: configured.identity.remoteTest.name,
      environmentConfig: configured.testConfig,
      execFile,
      file,
      sql,
    });
  }
}

export function createProductionReadonlyTarget({
  execFile = execFileSync,
} = {}) {
  const configured = resolveConfiguredRemoteTargets({ execFile });
  const root = mkdtempSync(join(tmpdir(), "taskseq-production-readonly-"));
  const exportDirectory = join(root, "exports");
  mkdirSync(exportDirectory);
  const configPath = join(root, "wrangler.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        name: "taskseq-maintenance-production-readonly",
        d1_databases: [
          {
            binding: "DB",
            database_name: configured.identity.production.name,
            database_id: configured.identity.production.databaseId,
            migrations_dir: migrationDirectory,
          },
        ],
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  writeFileSync(
    join(root, ".env.remote"),
    `${[
      ["D1_DATABASE_NAME", configured.identity.production.name],
      ["D1_BACKUP_DIR", exportDirectory],
      ["CLOUDFLARE_ACCOUNT_ID", configured.productionConfig.accountId],
      ["CLOUDFLARE_API_TOKEN", configured.productionConfig.apiToken],
    ]
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return Object.freeze({
    identity: configured.identity,
    migrationDirectory,
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    exportTasks() {
      return runExport({
        appDirectory,
        configPath,
        environment: "remote",
        projectRoot: repositoryRoot,
        scriptDirectory: root,
      });
    },
    query(sql) {
      const readOnlySql = assertProductionReadonlyQuery(sql);
      return parseWranglerRows(
        executeRemoteD1({
          configPath,
          databaseName: configured.identity.production.name,
          environmentConfig: configured.productionConfig,
          execFile,
          sql: readOnlySql,
        }),
      );
    },
  });
}

function executeRemoteD1({
  configPath,
  databaseName,
  environmentConfig,
  execFile,
  file,
  sql,
}) {
  return execFile(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--config",
      configPath,
      ...(file ? ["--file", file, "--yes"] : ["--command", sql]),
      "--json",
    ],
    {
      cwd: appDirectory,
      encoding: "utf8",
      env: environmentConfig.childEnvironment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export function assertProductionReadonlyQuery(sql) {
  const normalized = String(sql ?? "").trim();
  if (
    !/^SELECT\b/iu.test(normalized) ||
    normalized.includes(";") ||
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA|VACUUM|ATTACH|DETACH)\b/iu.test(
      normalized,
    )
  ) {
    throw new Error(
      "production-readonlyでは単一のread-only SELECTだけを実行できます。",
    );
  }
  return normalized;
}

export function orderTablesForDrop(tableNames, foreignKeys) {
  const names = [...new Set(tableNames)].sort();
  const nameSet = new Set(names);
  const outgoing = new Map(names.map((name) => [name, new Set()]));
  const incomingCount = new Map(names.map((name) => [name, 0]));
  for (const { child, parent } of foreignKeys) {
    if (
      child === parent ||
      !nameSet.has(child) ||
      !nameSet.has(parent) ||
      outgoing.get(child).has(parent)
    ) {
      continue;
    }
    outgoing.get(child).add(parent);
    incomingCount.set(parent, incomingCount.get(parent) + 1);
  }

  const ready = names.filter((name) => incomingCount.get(name) === 0);
  const ordered = [];
  while (ready.length > 0) {
    ready.sort();
    const current = ready.shift();
    ordered.push(current);
    for (const parent of outgoing.get(current)) {
      const count = incomingCount.get(parent) - 1;
      incomingCount.set(parent, count);
      if (count === 0) {
        ready.push(parent);
      }
    }
  }
  if (ordered.length !== names.length) {
    ordered.push(...names.filter((name) => !ordered.includes(name)));
  }
  return ordered;
}

export function acquireRemoteTestLease({ now = () => new Date() } = {}) {
  const target = createRemoteTestTarget();
  const owner = randomUUID();
  const expiresAt = new Date(
    now().getTime() + 2 * 60 * 60 * 1000,
  ).toISOString();
  try {
    target.executeCommand(
      [
        `CREATE TABLE IF NOT EXISTS ${lockTable} (lock_id INTEGER PRIMARY KEY CHECK (lock_id = 1), owner TEXT NOT NULL, expires_at TEXT NOT NULL)`,
        `DELETE FROM ${lockTable} WHERE expires_at < ${quoteSql(now().toISOString())}`,
        `INSERT INTO ${lockTable} (lock_id, owner, expires_at) VALUES (1, ${quoteSql(owner)}, ${quoteSql(expiresAt)})`,
      ].join("; "),
    );
  } catch (error) {
    target.cleanup();
    throw new Error(
      "remote-testは別のrunnerが使用中か、lockを取得できません。DB変更前に停止しました。",
      { cause: error },
    );
  }
  let released = false;
  return Object.freeze({
    release() {
      if (released) {
        return;
      }
      try {
        target.executeCommand(
          `DELETE FROM ${lockTable} WHERE owner = ${quoteSql(owner)}; DROP TABLE IF EXISTS ${lockTable}`,
        );
        released = true;
      } finally {
        target.cleanup();
      }
    },
  });
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function resolveRemoteDatabaseIdentity({
  databases,
  productionAccountId,
  productionDatabaseName,
  testAccountId,
  testDatabaseName,
}) {
  if (!productionAccountId || !testAccountId) {
    throw new Error("remote database identityのaccountを解決できません。");
  }
  if (productionAccountId !== testAccountId) {
    throw new Error(
      "productionとremote-testは同じCloudflare accountで識別してください。",
    );
  }
  if (testDatabaseName !== "taskseq-test") {
    throw new Error(
      `remote-test database nameはtaskseq-testである必要があります: ${testDatabaseName ?? "(不明)"}`,
    );
  }
  if (!productionDatabaseName || productionDatabaseName === testDatabaseName) {
    throw new Error(
      "productionとremote-testのdatabase nameは異なる必要があります。",
    );
  }

  const production = findExactlyOneDatabase(
    databases,
    productionDatabaseName,
    "production",
  );
  const remoteTest = findExactlyOneDatabase(
    databases,
    testDatabaseName,
    "remote-test",
  );
  const productionId = production.uuid ?? production.id;
  const remoteTestId = remoteTest.uuid ?? remoteTest.id;
  if (productionId === remoteTestId) {
    throw new Error(
      "productionとremote-testのdatabase IDは異なる必要があります。",
    );
  }

  return Object.freeze({
    production: Object.freeze({
      databaseId: productionId,
      name: production.name,
    }),
    publicSummary: Object.freeze({
      account: "verified",
      production: production.name,
      remoteTest: remoteTest.name,
    }),
    remoteTest: Object.freeze({
      databaseId: remoteTestId,
      name: remoteTest.name,
    }),
  });
}

function findExactlyOneDatabase(databases, name, target) {
  if (!Array.isArray(databases)) {
    throw new Error(`${target} database identityを解決できません。`);
  }
  const matches = databases.filter((database) => database?.name === name);
  if (matches.length !== 1) {
    throw new Error(
      `${target} database identityを一意に解決できません: ${name}`,
    );
  }
  const databaseId = matches[0].uuid ?? matches[0].id;
  if (typeof databaseId !== "string" || databaseId.length === 0) {
    throw new Error(`${target} database identityを解決できません: ${name}`);
  }
  return matches[0];
}
