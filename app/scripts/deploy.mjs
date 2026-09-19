import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const productionDatabaseName = "taskseq";
const builtConfigPath = "dist/taskseq/wrangler.json";
const generatedConfigPath = "dist/taskseq/wrangler.production.generated.json";
const dailyTrashCleanupCron = "0 0 * * *";
const accessJwtAudience = requiredEnvironmentVariable("ACCESS_JWT_AUD");
const accessJwtTeamDomain = requiredEnvironmentVariable(
  "ACCESS_JWT_TEAM_DOMAIN",
);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

function productionDatabaseId() {
  const output = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "info", productionDatabaseName, "--json"],
    { encoding: "utf8" },
  );
  const database = JSON.parse(output);
  if (typeof database.uuid !== "string") {
    throw new Error("Could not determine the production D1 database UUID");
  }
  return database.uuid;
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set before production deployment`);
  }
  return value;
}

run("pnpm", ["check"]);
run("pnpm", ["backup"]);

const config = JSON.parse(readFileSync(builtConfigPath, "utf8"));
config.d1_databases = [
  {
    ...config.d1_databases[0],
    database_name: productionDatabaseName,
    database_id: productionDatabaseId(),
  },
];
config.vars = {
  ...config.vars,
  AUTH_MODE: "production",
  ACCESS_JWT_AUD: accessJwtAudience,
  ACCESS_JWT_TEAM_DOMAIN: accessJwtTeamDomain,
};
config.triggers = { crons: [dailyTrashCleanupCron] };
writeFileSync(generatedConfigPath, `${JSON.stringify(config, null, 2)}\n`);

try {
  run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    generatedConfigPath,
  ]);
  run("pnpm", ["exec", "wrangler", "deploy", "--config", generatedConfigPath]);
} finally {
  rmSync(generatedConfigPath, { force: true });
}
