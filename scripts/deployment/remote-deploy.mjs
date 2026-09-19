import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadMaintenanceEnvironment,
  parseDotEnv,
} from "../database-maintenance/environment.mjs";

const productionDatabaseName = "taskseq";
const deploymentDirectory = resolve(dirname(fileURLToPath(import.meta.url)));
const scriptDirectory = resolve(deploymentDirectory, "..");
const projectRoot = resolve(scriptDirectory, "..");
const appDirectory = resolve(projectRoot, "app");

export function loadRemoteDeploymentEnvironment({
  processEnvironment = process.env,
  projectRoot: configuredProjectRoot = projectRoot,
  scriptDirectory: configuredScriptDirectory = scriptDirectory,
} = {}) {
  const maintenanceEnvironment = loadMaintenanceEnvironment({
    environment: "remote",
    processEnvironment,
    projectRoot: configuredProjectRoot,
    scriptDirectory: configuredScriptDirectory,
  });
  const values = parseDotEnv(
    readFileSync(maintenanceEnvironment.configPath, "utf8"),
    { sourcePath: maintenanceEnvironment.configPath },
  );

  if (maintenanceEnvironment.databaseName !== productionDatabaseName) {
    throw new Error(
      `${maintenanceEnvironment.configPath}: D1_DATABASE_NAMEは${productionDatabaseName}で指定してください。`,
    );
  }

  const apiToken = requireValue(
    values,
    "CLOUDFLARE_API_TOKEN",
    maintenanceEnvironment.configPath,
  );
  const accessJwtTeamDomain = requireValue(
    values,
    "ACCESS_JWT_TEAM_DOMAIN",
    maintenanceEnvironment.configPath,
  );
  const accessJwtAudience = requireValue(
    values,
    "ACCESS_JWT_AUD",
    maintenanceEnvironment.configPath,
  );

  return Object.freeze({
    ...maintenanceEnvironment,
    childEnvironment: Object.freeze({
      ...maintenanceEnvironment.childEnvironment,
      ACCESS_JWT_AUD: accessJwtAudience,
      ACCESS_JWT_TEAM_DOMAIN: accessJwtTeamDomain,
      CLOUDFLARE_API_TOKEN: apiToken,
    }),
  });
}

export function runRemoteDeploy({
  appDirectory: configuredAppDirectory = appDirectory,
  processEnvironment = process.env,
  projectRoot: configuredProjectRoot = projectRoot,
  runCommand = runPnpmDeploy,
  scriptDirectory: configuredScriptDirectory = scriptDirectory,
} = {}) {
  const environment = loadRemoteDeploymentEnvironment({
    processEnvironment,
    projectRoot: configuredProjectRoot,
    scriptDirectory: configuredScriptDirectory,
  });
  return runCommand({
    appDirectory: configuredAppDirectory,
    childEnvironment: environment.childEnvironment,
  });
}

function runPnpmDeploy({ appDirectory: workingDirectory, childEnvironment }) {
  execFileSync("pnpm", ["deploy"], {
    cwd: workingDirectory,
    env: childEnvironment,
    stdio: "inherit",
  });
  return 0;
}

function requireValue(values, key, sourcePath) {
  const value = values[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${sourcePath}: ${key}は空にできません。`);
  }
  return value.trim();
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = runRemoteDeploy();
}
