import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe } from "node:test";

import {
  loadMaintenanceEnvironment,
  parseDotEnv,
} from "../database-maintenance/environment.mjs";
import {
  createCaseMetadata,
  maintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const temporaryDirectories = [];
const caseMeta = createCaseMetadata("environment", "unit");

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("maintenance environment", () => {
  maintenanceCase(
    caseMeta(
      "ENVIRONMENT-UNIT-001",
      "stops when the matching config is missing or a required value is empty",
    ),
    () => {
      const root = makeProject();
      assert.throws(
        () =>
          loadMaintenanceEnvironment({
            environment: "local",
            projectRoot: root,
            scriptDirectory: join(root, "scripts"),
          }),
        /ありません/u,
      );

      writeFileSync(
        join(root, "scripts", ".env.local"),
        "D1_DATABASE_NAME=\nD1_BACKUP_DIR=/tmp/backup\n",
      );
      assert.throws(
        () =>
          loadMaintenanceEnvironment({
            environment: "local",
            processEnvironment: { D1_DATABASE_NAME: "ambient-name" },
            projectRoot: root,
            scriptDirectory: join(root, "scripts"),
          }),
        /D1_DATABASE_NAMEは空にできません/u,
      );
    },
  );

  maintenanceCase(
    caseMeta("ENVIRONMENT-UNIT-002", "rejects a relative backup directory"),
    () => {
      const root = makeProject();
      writeFileSync(
        join(root, "scripts", ".env.local"),
        "D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=backups\n",
      );

      assert.throws(
        () =>
          loadMaintenanceEnvironment({
            environment: "local",
            projectRoot: root,
            scriptDirectory: join(root, "scripts"),
          }),
        /絶対パス/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "ENVIRONMENT-UNIT-003",
      "parses values without evaluating shell syntax and gives the file priority",
    ),
    () => {
      const values = parseDotEnv(
        'D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR="/tmp/backup dir"\nMARKER=$(touch /tmp/should-not-exist)\n',
      );
      assert.equal(values.D1_DATABASE_NAME, "taskseq-local");
      assert.equal(values.D1_BACKUP_DIR, "/tmp/backup dir");
      assert.equal(values.MARKER, "$(touch /tmp/should-not-exist)");
    },
  );

  maintenanceCase(
    caseMeta(
      "ENVIRONMENT-UNIT-004",
      "requires the matching config and does not inherit an ambient token",
    ),
    () => {
      const root = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-env-backup-",
      );
      writeFileSync(
        join(root, "scripts", ".env.local"),
        `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${backupDirectory}\n`,
      );

      const config = loadMaintenanceEnvironment({
        environment: "local",
        processEnvironment: {
          CLOUDFLARE_ACCOUNT_ID: "ambient-account",
          CLOUDFLARE_API_TOKEN: "ambient-token",
        },
        projectRoot: root,
        scriptDirectory: join(root, "scripts"),
      });

      assert.equal(config.databaseName, "taskseq-local");
      assert.equal(config.childEnvironment.D1_DATABASE_NAME, "taskseq-local");
      assert.equal(config.childEnvironment.CLOUDFLARE_ACCOUNT_ID, undefined);
      assert.equal(config.childEnvironment.CLOUDFLARE_API_TOKEN, undefined);
    },
  );

  maintenanceCase(
    caseMeta(
      "ENVIRONMENT-UNIT-005",
      "requires account ID for remote and uses the configured token when present",
    ),
    () => {
      const root = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-env-backup-",
      );
      writeFileSync(
        join(root, "scripts", ".env.remote"),
        [
          "D1_DATABASE_NAME=taskseq",
          `D1_BACKUP_DIR=${backupDirectory}`,
          "CLOUDFLARE_ACCOUNT_ID=config-account",
          "CLOUDFLARE_API_TOKEN=config-token",
        ].join("\n"),
      );

      const config = loadMaintenanceEnvironment({
        environment: "remote",
        processEnvironment: { CLOUDFLARE_API_TOKEN: "ambient-token" },
        projectRoot: root,
        scriptDirectory: join(root, "scripts"),
      });

      assert.equal(
        config.childEnvironment.CLOUDFLARE_ACCOUNT_ID,
        "config-account",
      );
      assert.equal(
        config.childEnvironment.CLOUDFLARE_API_TOKEN,
        "config-token",
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "ENVIRONMENT-UNIT-006",
      "rejects a backup path inside the repository after resolving a symlink",
    ),
    () => {
      const root = makeProject();
      const link = join(root, "external-link");
      symlinkSync(root, link, "dir");
      writeFileSync(
        join(root, "scripts", ".env.local"),
        `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${join(link, "backups")}\n`,
      );

      assert.throws(
        () =>
          loadMaintenanceEnvironment({
            environment: "local",
            projectRoot: root,
            scriptDirectory: join(root, "scripts"),
          }),
        /repository外/u,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "ENVIRONMENT-UNIT-007",
      "loads isolated local-test and remote-test configuration files",
    ),
    () => {
      const root = makeProject();
      const backupDirectory = makeExternalDirectory(
        "taskseq-maintenance-test-target-",
      );
      writeFileSync(
        join(root, "scripts", ".env.local"),
        `D1_DATABASE_NAME=taskseq-local\nD1_BACKUP_DIR=${backupDirectory}\n`,
      );
      writeFileSync(
        join(root, "scripts", ".env.local-test"),
        `D1_DATABASE_NAME=case-specific-local-test\nD1_BACKUP_DIR=${backupDirectory}\n`,
      );
      writeFileSync(
        join(root, "scripts", ".env.remote-test"),
        [
          "D1_DATABASE_NAME=taskseq-test",
          `D1_BACKUP_DIR=${backupDirectory}`,
          "CLOUDFLARE_ACCOUNT_ID=test-account",
        ].join("\n"),
      );

      const localTest = loadMaintenanceEnvironment({
        environment: "local-test",
        projectRoot: root,
        scriptDirectory: join(root, "scripts"),
      });
      const remoteTest = loadMaintenanceEnvironment({
        environment: "remote-test",
        projectRoot: root,
        scriptDirectory: join(root, "scripts"),
      });

      assert.equal(localTest.databaseName, "case-specific-local-test");
      assert.equal(localTest.scope, "--local");
      assert.equal(localTest.configPath.endsWith(".env.local-test"), true);
      assert.equal(remoteTest.databaseName, "taskseq-test");
      assert.equal(remoteTest.scope, "--remote");
      assert.equal(
        remoteTest.childEnvironment.CLOUDFLARE_ACCOUNT_ID,
        "test-account",
      );
      assert.equal(remoteTest.configPath.endsWith(".env.remote-test"), true);
    },
  );
});

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "taskseq-maintenance-test-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "app", "migrations"), { recursive: true });
  return root;
}

function makeExternalDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
