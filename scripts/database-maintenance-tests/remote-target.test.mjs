import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCaseMetadata,
  maintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";
import {
  assertProductionReadonlyQuery,
  createRemoteTestConfiguration,
  orderTablesForDrop,
  parseD1DatabaseList,
  readProductionMigrationSnapshot,
  resolveRemoteDatabaseIdentity,
  validateProductionMigrationPrefix,
  writeProductionMigrationSnapshot,
} from "../database-maintenance-test/remote-target.mjs";

const caseMeta = createCaseMetadata("identity", "unit");

maintenanceCase(
  caseMeta(
    "IDENTITY-UNIT-001",
    "resolves distinct production and remote-test databases without exposing IDs",
  ),
  () => {
    const identity = resolveRemoteDatabaseIdentity({
      databases: [
        { name: "taskseq", uuid: "11111111-1111-4111-8111-111111111111" },
        {
          name: "taskseq-test",
          uuid: "22222222-2222-4222-8222-222222222222",
        },
      ],
      productionAccountId: "same-account",
      productionDatabaseName: "taskseq",
      testAccountId: "same-account",
      testDatabaseName: "taskseq-test",
    });

    assert.equal(identity.production.name, "taskseq");
    assert.equal(identity.remoteTest.name, "taskseq-test");
    assert.notEqual(
      identity.production.databaseId,
      identity.remoteTest.databaseId,
    );
    assert.equal(
      JSON.stringify(identity.publicSummary).includes("11111111"),
      false,
    );
    assert.equal(
      JSON.stringify(identity.publicSummary).includes("22222222"),
      false,
    );
  },
);

maintenanceCase(
  {
    id: "MIGRATION-UNIT-018",
    operation: "migration",
    profile: "unit",
    title:
      "persists and validates a production migration prefix without target identity or data",
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "taskseq-production-schema-test-"));
    try {
      const path = join(root, "production-migrations.json");
      writeProductionMigrationSnapshot({
        capturedAt: new Date("2026-09-08T00:00:00.000Z"),
        migrationNames: ["0001_initial.sql", "0002_tasks.sql"],
        path,
      });
      assert.deepEqual(readProductionMigrationSnapshot(path), {
        capturedAt: "2026-09-08T00:00:00.000Z",
        migrationNames: ["0001_initial.sql", "0002_tasks.sql"],
        schemaVersion: 1,
      });
      assert.equal(readFileSync(path, "utf8").includes("database"), false);
      assert.deepEqual(
        validateProductionMigrationPrefix({
          productionNames: ["0001_initial.sql", "0002_tasks.sql"],
          repositoryNames: [
            "0001_initial.sql",
            "0002_tasks.sql",
            "0003_views.sql",
          ],
        }),
        ["0001_initial.sql", "0002_tasks.sql"],
      );
      assert.throws(
        () =>
          validateProductionMigrationPrefix({
            productionNames: ["0002_tasks.sql"],
            repositoryNames: ["0001_initial.sql", "0002_tasks.sql"],
          }),
        /prefix/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  },
);

maintenanceCase(
  caseMeta(
    "IDENTITY-UNIT-006",
    "rejects non-SELECT and multi-statement production-readonly queries",
  ),
  () => {
    assert.equal(
      assertProductionReadonlyQuery("  SELECT COUNT(*) FROM tasks "),
      "SELECT COUNT(*) FROM tasks",
    );
    for (const sql of [
      "DELETE FROM tasks",
      "PRAGMA user_version = 1",
      "SELECT 1; DELETE FROM tasks",
      "WITH deleted AS (DELETE FROM tasks RETURNING id) SELECT * FROM deleted",
    ]) {
      assert.throws(() => assertProductionReadonlyQuery(sql), /read-only/u);
    }
  },
);

maintenanceCase(
  caseMeta(
    "IDENTITY-UNIT-005",
    "orders dependent tables before their foreign-key parents",
  ),
  () => {
    assert.deepEqual(
      orderTablesForDrop(
        ["areas", "tasks", "tags", "task_tags", "owner_settings"],
        [
          { child: "tasks", parent: "areas" },
          { child: "tasks", parent: "tasks" },
          { child: "task_tags", parent: "tasks" },
          { child: "task_tags", parent: "tags" },
        ],
      ),
      ["owner_settings", "task_tags", "tags", "tasks", "areas"],
    );
  },
);

maintenanceCase(
  caseMeta(
    "IDENTITY-UNIT-004",
    "builds a separate remote-test config without Access settings",
  ),
  () => {
    const text = createRemoteTestConfiguration(
      {
        accountId: "account-id",
        apiToken: "token-value",
      },
      { backupDirectory: "/tmp/backup path" },
    );
    assert.match(text, /^D1_DATABASE_NAME="taskseq-test"/u);
    assert.match(text, /D1_BACKUP_DIR="\/tmp\/backup path"/u);
    assert.match(text, /CLOUDFLARE_ACCOUNT_ID="account-id"/u);
    assert.match(text, /CLOUDFLARE_API_TOKEN="token-value"/u);
    assert.doesNotMatch(text, /ACCESS_JWT/u);
  },
);

maintenanceCase(
  caseMeta(
    "IDENTITY-UNIT-002",
    "rejects unknown, ambiguous, same-ID, wrong-name, and cross-account targets",
  ),
  () => {
    const base = {
      databases: [
        { name: "taskseq", uuid: "11111111-1111-4111-8111-111111111111" },
        {
          name: "taskseq-test",
          uuid: "22222222-2222-4222-8222-222222222222",
        },
      ],
      productionAccountId: "same-account",
      productionDatabaseName: "taskseq",
      testAccountId: "same-account",
      testDatabaseName: "taskseq-test",
    };
    assert.throws(
      () => resolveRemoteDatabaseIdentity({ ...base, databases: [] }),
      /identity/u,
    );
    assert.throws(
      () =>
        resolveRemoteDatabaseIdentity({
          ...base,
          databases: [base.databases[0], base.databases[0], base.databases[1]],
        }),
      /identity/u,
    );
    assert.throws(
      () =>
        resolveRemoteDatabaseIdentity({
          ...base,
          databases: [
            base.databases[0],
            { ...base.databases[1], uuid: base.databases[0].uuid },
          ],
        }),
      /異なる/u,
    );
    assert.throws(
      () =>
        resolveRemoteDatabaseIdentity({ ...base, testDatabaseName: "taskseq" }),
      /taskseq-test/u,
    );
    assert.throws(
      () => resolveRemoteDatabaseIdentity({ ...base, testAccountId: "other" }),
      /account/u,
    );
  },
);

maintenanceCase(
  caseMeta("IDENTITY-UNIT-003", "parses Wrangler D1 list response shapes"),
  () => {
    const databases = [
      { name: "taskseq", uuid: "11111111-1111-4111-8111-111111111111" },
    ];
    assert.deepEqual(parseD1DatabaseList(JSON.stringify(databases)), databases);
    assert.deepEqual(
      parseD1DatabaseList(JSON.stringify({ result: databases })),
      databases,
    );
    assert.throws(() => parseD1DatabaseList("{}"), /JSON/u);
  },
);
