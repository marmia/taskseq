import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  loadRemoteDeploymentEnvironment,
  runRemoteDeploy,
} from "./remote-deploy.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe("remote deployment wrapper", () => {
  it("loads the remote config safely and passes configured values to deploy", () => {
    const project = makeProject();
    const backupDirectory = mkdtempSync(join(tmpdir(), "taskseq-deploy-test-"));
    temporaryDirectories.push(backupDirectory);
    writeRemoteConfig(project, backupDirectory);

    const calls = [];
    const result = runRemoteDeploy({
      appDirectory: join(project, "app"),
      processEnvironment: {
        ACCESS_JWT_AUD: "ambient-aud",
        ACCESS_JWT_TEAM_DOMAIN: "ambient-domain",
        CLOUDFLARE_API_TOKEN: "ambient-token",
      },
      projectRoot: project,
      runCommand(options) {
        calls.push(options);
        return 17;
      },
      scriptDirectory: join(project, "scripts"),
    });

    assert.equal(result, 17);
    assert.equal(calls[0].appDirectory, join(project, "app"));
    assert.equal(calls[0].childEnvironment.D1_DATABASE_NAME, "taskseq");
    assert.equal(
      calls[0].childEnvironment.CLOUDFLARE_API_TOKEN,
      "config-token",
    );
    assert.equal(
      calls[0].childEnvironment.ACCESS_JWT_TEAM_DOMAIN,
      "https://config.example.com",
    );
    assert.equal(calls[0].childEnvironment.ACCESS_JWT_AUD, "config-aud");
  });

  it("rejects a production config without a deployment token or Access values", () => {
    const project = makeProject();
    const backupDirectory = mkdtempSync(join(tmpdir(), "taskseq-deploy-test-"));
    temporaryDirectories.push(backupDirectory);
    writeFileSync(
      join(project, "scripts", ".env.remote"),
      [
        "D1_DATABASE_NAME=taskseq",
        `D1_BACKUP_DIR=${backupDirectory}`,
        "CLOUDFLARE_ACCOUNT_ID=config-account",
      ].join("\n"),
    );

    assert.throws(
      () =>
        loadRemoteDeploymentEnvironment({
          projectRoot: project,
          scriptDirectory: join(project, "scripts"),
        }),
      /CLOUDFLARE_API_TOKENは空にできません/u,
    );
  });

  it("rejects a config that targets a database other than production taskseq", () => {
    const project = makeProject();
    const backupDirectory = mkdtempSync(join(tmpdir(), "taskseq-deploy-test-"));
    temporaryDirectories.push(backupDirectory);
    writeRemoteConfig(project, backupDirectory, "other-db");

    assert.throws(
      () =>
        loadRemoteDeploymentEnvironment({
          projectRoot: project,
          scriptDirectory: join(project, "scripts"),
        }),
      /D1_DATABASE_NAMEはtaskseqで指定してください/u,
    );
  });
});

function makeProject() {
  const project = mkdtempSync(join(tmpdir(), "taskseq-deploy-project-"));
  temporaryDirectories.push(project);
  mkdirSync(join(project, "scripts"));
  mkdirSync(join(project, "app"));
  return project;
}

function writeRemoteConfig(project, backupDirectory, databaseName = "taskseq") {
  writeFileSync(
    join(project, "scripts", ".env.remote"),
    [
      `D1_DATABASE_NAME=${databaseName}`,
      `D1_BACKUP_DIR=${backupDirectory}`,
      "CLOUDFLARE_ACCOUNT_ID=config-account",
      "CLOUDFLARE_API_TOKEN=config-token",
      "ACCESS_JWT_TEAM_DOMAIN=https://config.example.com",
      "ACCESS_JWT_AUD=config-aud",
    ].join("\n"),
  );
}
