import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCaseMetadata,
  maintenanceCase,
} from "../database-maintenance-test/case-registry.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const caseMeta = createCaseMetadata("separation", "unit");

describe("maintenance test boundary", () => {
  maintenanceCase(
    caseMeta(
      "SEPARATION-UNIT-001",
      "keeps maintenance tests out of the app test and check paths",
    ),
    () => {
      const packageJson = readFileSync(
        resolve(repositoryRoot, "app/package.json"),
        "utf8",
      );
      const webConfig = readFileSync(
        resolve(repositoryRoot, "app/vitest.config.ts"),
        "utf8",
      );
      const workerConfig = readFileSync(
        resolve(repositoryRoot, "app/vitest.worker.config.ts"),
        "utf8",
      );
      const checkScript = readFileSync(
        resolve(repositoryRoot, "app/scripts/check.mjs"),
        "utf8",
      );

      assert.doesNotMatch(packageJson, /database-maintenance-test/u);
      assert.doesNotMatch(webConfig, /database-maintenance/u);
      assert.doesNotMatch(workerConfig, /database-maintenance/u);
      assert.doesNotMatch(checkScript, /database-maintenance/u);
      assert.match(webConfig, /src\/worker\/\*\*\/\*\.test\.ts/u);
      assert.match(workerConfig, /src\/worker\/\*\*\/\*\.test\.ts/u);
    },
  );

  maintenanceCase(
    caseMeta(
      "SEPARATION-UNIT-002",
      "keeps maintenance environment and report files ignored by Git",
    ),
    () => {
      const ignoredPaths = execFileSync(
        "git",
        [
          "check-ignore",
          "--no-index",
          "scripts/.env.local",
          "scripts/.env.remote",
          "scripts/.env.local-test",
          "scripts/.env.remote-test",
          "scripts/.reports/result.json",
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.match(ignoredPaths, /scripts\/\.env\.local/u);
      assert.match(ignoredPaths, /scripts\/\.env\.remote/u);
      assert.match(ignoredPaths, /scripts\/\.env\.local-test/u);
      assert.match(ignoredPaths, /scripts\/\.env\.remote-test/u);
      assert.match(ignoredPaths, /scripts\/\.reports\/result\.json/u);
      assert.match(
        readFileSync(resolve(repositoryRoot, ".gitignore"), "utf8"),
        /^\.env\.\*/mu,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "SEPARATION-UNIT-003",
      "connects both package commands to fixed migration entrypoints",
    ),
    () => {
      const packageJson = readFileSync(
        resolve(repositoryRoot, "app/package.json"),
        "utf8",
      );
      assert.match(
        packageJson,
        /"db:migrate:local":\s*"bash \.\.\/scripts\/local-migration\.sh"/u,
      );
      assert.match(
        packageJson,
        /"db:migrate:remote":\s*"bash \.\.\/scripts\/remote-migration\.sh"/u,
      );
      assert.doesNotMatch(packageJson, /wrangler d1 migrations apply/u);

      for (const [entrypoint, environment] of [
        ["local-migration.sh", "local"],
        ["remote-migration.sh", "remote"],
      ]) {
        const path = resolve(repositoryRoot, "scripts", entrypoint);
        assert.equal(existsSync(path), true);
        assert.equal(statSync(path).mode & 0o111, 0o111);
        assert.match(
          readFileSync(path, "utf8"),
          new RegExp(`--environment ${environment}`, "u"),
        );
      }
      assert.equal(
        existsSync(resolve(repositoryRoot, "scripts", "db-migrate.sh")),
        false,
      );
    },
  );

  maintenanceCase(
    caseMeta(
      "SEPARATION-UNIT-004",
      "keeps the full deployment path separate from the migration entrypoint",
    ),
    () => {
      const deploy = readFileSync(
        resolve(repositoryRoot, "app/scripts/deploy.mjs"),
        "utf8",
      );
      assert.match(deploy, /"migrations",\s*"apply"/u);
      assert.doesNotMatch(deploy, /remote-migration\.sh/u);
    },
  );
});
