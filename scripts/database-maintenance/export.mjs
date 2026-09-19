import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureBackupDirectory,
  loadMaintenanceEnvironment,
} from "./environment.mjs";
import {
  buildMigrationPlan,
  readMigrations,
  resolveMigrationHistory,
  runWranglerQuery,
} from "./migration.mjs";
import { validateJsonSchema } from "./json-schema.mjs";
import { createMaintenanceOutput } from "./output.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultProjectRoot = resolve(scriptsDirectory, "..");
const exportQuery = `
SELECT
  t.id AS id,
  t.title AS title,
  t.description AS description,
  t.work_notes AS workNotes,
  a.name AS area,
  t.parent_task_id AS parentId,
  t.start AS start,
  t.due AS due,
  t.recurrence_rule AS recurrenceRule,
  tag.name AS tag
FROM tasks AS t
LEFT JOIN areas AS a ON a.id = t.area_id
LEFT JOIN task_tags AS task_tag ON task_tag.task_id = t.id
LEFT JOIN tags AS tag ON tag.id = task_tag.tag_id
WHERE t.trashed_at IS NULL
ORDER BY t.id, tag.name, tag.id
`.trim();

export function runExport({
  environment,
  scriptDirectory = scriptsDirectory,
  projectRoot = defaultProjectRoot,
  appDirectory = resolve(projectRoot, "app"),
  configPath,
  migrationDirectory = resolve(appDirectory, "migrations"),
  schemaPath = resolve(
    import.meta.dirname,
    "schemas",
    "task-update.schema.json",
  ),
  runQuery = runWranglerExportQuery,
  validate = validateExportDocument,
  verifySchema = assertExportSchema,
  now = () => new Date(),
} = {}) {
  const environmentConfig = loadMaintenanceEnvironment({
    environment,
    projectRoot,
    scriptDirectory,
  });
  const outputDirectory = ensureBackupDirectory(environmentConfig);
  verifySchema({
    appDirectory,
    configPath,
    environmentConfig,
    migrationDirectory,
  });
  const document = createExportDocument(
    runQuery(environmentConfig, appDirectory, configPath),
  );
  validate(document, schemaPath);

  const path = createMaintenanceOutput({
    environment,
    extension: "json",
    now,
    operation: "export",
    outputDirectory,
    writePartial(partialPath) {
      writeFileSync(partialPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    },
  });
  return Object.freeze({ environment, path });
}

export function assertExportSchema({
  appDirectory,
  configPath,
  environmentConfig,
  migrationDirectory,
  runQuery = runWranglerQuery,
}) {
  const migrations = readMigrations(migrationDirectory);
  const history = resolveMigrationHistory({
    runQuery: () =>
      runQuery({
        appDirectory,
        configPath,
        environmentConfig,
      }),
  });
  const plan = buildMigrationPlan({ migrations, history });
  if (plan.pendingMigrations.length > 0) {
    throw new Error(
      [
        "対象DBのschemaがrepositoryと一致しないためexportを実行できません。",
        `未適用migration: ${plan.pendingMigrations.map(({ name }) => name).join(", ")}`,
        "先に通常のmigration／deployment手順でschemaを揃えてください。",
      ].join("\n"),
    );
  }
}

export function validateExportDocument(document, schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const errors = validateJsonSchema(document, schema);
  if (errors.length > 0) {
    const details = errors.join("; ");
    throw new Error(`export結果が更新用JSON Schemaに一致しません: ${details}`);
  }
}

export function runWranglerExportQuery(
  environmentConfig,
  appDirectory,
  configPath,
  execFile = execFileSync,
) {
  const args = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    environmentConfig.databaseName,
    environmentConfig.scope,
    "--command",
    exportQuery,
    "--json",
  ];
  if (configPath) {
    args.push("--config", configPath);
  }
  const output = execFile("pnpm", args, {
    cwd: appDirectory,
    encoding: "utf8",
    env: environmentConfig.childEnvironment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseWranglerRows(output);
}

export function createExportDocument(rows) {
  const tasks = [];
  let current = null;
  for (const row of rows) {
    if (!current || current.id !== row.id) {
      current = {
        id: row.id,
        title: row.title,
        description: row.description,
        workNotes: row.workNotes,
        area: row.area,
        parentId: row.parentId,
        start: row.start,
        due: row.due,
        recurrenceRule: row.recurrenceRule,
        tags: [],
      };
      tasks.push(current);
    }
    if (row.tag !== null) {
      current.tags.push(row.tag);
    }
  }
  return { tasks };
}

function parseWranglerRows(output) {
  let payload;
  try {
    payload = typeof output === "string" ? JSON.parse(output) : output;
  } catch (error) {
    throw new Error("Wrangler export query JSONが不正です。", {
      cause: error,
    });
  }
  const responses = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.result)
      ? payload.result
      : null;
  if (
    !responses ||
    responses.length === 0 ||
    responses.some(
      (response) =>
        !response ||
        typeof response !== "object" ||
        !Array.isArray(response.results),
    )
  ) {
    throw new Error("Wrangler export query JSONが不正です。");
  }
  const rows = [];
  for (const response of responses) {
    if (response?.success === false) {
      throw new Error(response.error ?? "Wrangler export query failed");
    }
    if (Array.isArray(response?.results)) {
      rows.push(...response.results);
    }
  }
  return rows;
}
