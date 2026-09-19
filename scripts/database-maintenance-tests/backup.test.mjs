import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe } from "node:test";

import { runBackup } from "../database-maintenance/backup.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const temporaryDirectories = [];
const fixturePath = new URL("./fixtures/valid-backup.sql", import.meta.url);
const caseMeta = createCaseMetadata("backup", "unit");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("database backup", () => {
  maintenanceCase(
    caseMeta(
      "BACKUP-UNIT-001",
      "exports from the configured app directory and finalizes the SQL file",
    ),
    () => {
      const project = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-output-",
      );
      const calls = [];
      writeConfig(
        project,
        "local",
        `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${backupDirectory}\n`,
      );

      const result = runBackup({
        environment: "local",
        now: () => new Date("2026-09-04T12:34:56.789Z"),
        processEnvironment: { CLOUDFLARE_API_TOKEN: "ambient-token" },
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runCommand(environmentConfig, outputPath, appDirectory) {
          calls.push({ appDirectory, environmentConfig, outputPath });
          cpSync(fileURLPath(fixturePath), outputPath);
        },
      });

      assert.match(result.path, /local-backup-20260904-123456-789Z\.sql$/u);
      assert.equal(
        readFileSync(result.path, "utf8"),
        readFileSync(fileURLPath(fixturePath), "utf8"),
      );
      assert.equal(calls[0].appDirectory, join(project, "app"));
      assert.equal(
        calls[0].environmentConfig.childEnvironment.CLOUDFLARE_API_TOKEN,
        undefined,
      );
      assert.equal(readdirSync(backupDirectory).length, 1);
    },
  );

  maintenanceCase(
    caseMeta("BACKUP-UNIT-002", "does not overwrite a same-timestamp backup"),
    () => {
      const project = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-output-",
      );
      writeConfig(
        project,
        "local",
        `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${backupDirectory}\n`,
      );
      const options = {
        environment: "local",
        now: () => new Date("2026-09-04T12:34:56.789Z"),
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runCommand(_environmentConfig, outputPath) {
          cpSync(fileURLPath(fixturePath), outputPath);
        },
      };

      const first = runBackup(options);
      const second = runBackup(options);

      assert.notEqual(first.path, second.path);
      assert.match(second.path, /local-backup-20260904-123456-789Z-1\.sql$/u);
      assert.equal(readdirSync(backupDirectory).length, 2);
    },
  );

  maintenanceCase(
    caseMeta(
      "BACKUP-UNIT-003",
      "passes the fixed remote scope and configured authentication to Wrangler",
    ),
    () => {
      const project = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-output-",
      );
      const calls = [];
      writeConfig(
        project,
        "remote",
        [
          "D1_DATABASE_NAME=taskseq",
          `D1_BACKUP_DIR=${backupDirectory}`,
          "CLOUDFLARE_ACCOUNT_ID=config-account",
          "CLOUDFLARE_API_TOKEN=config-token",
        ].join("\n"),
      );

      runBackup({
        environment: "remote",
        projectRoot: project,
        scriptDirectory: join(project, "scripts"),
        runCommand(environmentConfig, outputPath) {
          calls.push(environmentConfig);
          cpSync(fileURLPath(fixturePath), outputPath);
        },
      });

      assert.equal(calls[0].databaseName, "taskseq");
      assert.equal(calls[0].scope, "--remote");
      assert.equal(
        calls[0].childEnvironment.CLOUDFLARE_ACCOUNT_ID,
        "config-account",
      );
      assert.equal(
        calls[0].childEnvironment.CLOUDFLARE_API_TOKEN,
        "config-token",
      );
    },
  );

  maintenanceCase(
    caseMeta("BACKUP-UNIT-004", "removes a partial export when Wrangler fails"),
    () => {
      const project = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-output-",
      );
      writeConfig(
        project,
        "local",
        `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${backupDirectory}\n`,
      );

      assert.throws(
        () =>
          runBackup({
            environment: "local",
            projectRoot: project,
            scriptDirectory: join(project, "scripts"),
            runCommand(_environmentConfig, outputPath) {
              writeFileSync(outputPath, "partial");
              throw new Error("wrangler failed");
            },
          }),
        /wrangler failed/u,
      );
      assert.deepEqual(readdirSync(backupDirectory), []);
    },
  );

  maintenanceCase(
    caseMeta(
      "BACKUP-UNIT-005",
      "finalizes old-schema and empty SQL exports without inspecting their contents",
    ),
    () => {
      const project = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-output-",
      );
      writeConfig(
        project,
        "local",
        `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${backupDirectory}\n`,
      );

      const outputs = ["CREATE TABLE old_schema (id INTEGER);", ""];
      const paths = outputs.map(
        (sql) =>
          runBackup({
            environment: "local",
            projectRoot: project,
            scriptDirectory: join(project, "scripts"),
            runCommand(_environmentConfig, outputPath) {
              writeFileSync(outputPath, sql);
            },
          }).path,
      );

      assert.equal(readFileSync(paths[0], "utf8"), outputs[0]);
      assert.equal(readFileSync(paths[1], "utf8"), outputs[1]);
    },
  );
});

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "taskseq-maintenance-backup-test-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "app", "migrations"), { recursive: true });
  writeFileSync(
    join(root, "app", "migrations", "0001_example.sql"),
    "CREATE TABLE example (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL);\nCREATE INDEX example_value_idx ON example (value);\n",
  );
  return root;
}

function makeExternalDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeConfig(project, environment, contents) {
  writeFileSync(join(project, "scripts", `.env.${environment}`), contents);
}

function fileURLPath(url) {
  return new URL(url).pathname;
}
