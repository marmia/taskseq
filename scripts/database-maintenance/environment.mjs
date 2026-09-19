import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maintenanceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = resolve(maintenanceDirectory, "..");
const cloudflareAuthVariables = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
];

export const maintenanceEnvironments = Object.freeze({
  local: Object.freeze({
    configFile: ".env.local",
    remote: false,
    scope: "--local",
    label: "local D1",
  }),
  "local-test": Object.freeze({
    configFile: ".env.local-test",
    remote: false,
    scope: "--local",
    label: "local-test D1",
  }),
  remote: Object.freeze({
    configFile: ".env.remote",
    remote: true,
    scope: "--remote",
    label: "remote D1",
  }),
  "remote-test": Object.freeze({
    configFile: ".env.remote-test",
    remote: true,
    scope: "--remote",
    label: "remote-test D1",
  }),
});

export function parseDotEnv(text, { sourcePath = ".env" } = {}) {
  const values = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    const trimmedLine = line.trim();
    if (trimmedLine === "" || trimmedLine.startsWith("#")) {
      continue;
    }

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      throw new Error(
        `${sourcePath}:${index + 1}: KEY=value形式で記述してください。`,
      );
    }

    const [, key, rawValue] = match;
    if (Object.hasOwn(values, key)) {
      throw new Error(`${sourcePath}:${index + 1}: ${key}が重複しています。`);
    }
    values[key] = parseDotEnvValue(rawValue.trim(), sourcePath, index + 1);
  }

  return values;
}

export function loadMaintenanceEnvironment({
  environment,
  scriptDirectory = maintenanceDirectory,
  projectRoot = repositoryRoot,
  processEnvironment = process.env,
} = {}) {
  const environmentDefinition = maintenanceEnvironments[environment];
  if (!environmentDefinition) {
    throw new Error(`未対応の環境です: ${environment ?? "(未指定)"}`);
  }

  const configPath = resolve(scriptDirectory, environmentDefinition.configFile);
  if (!existsSync(configPath)) {
    throw new Error(
      `${configPath}がありません。対応する環境設定ファイルを作成してください。`,
    );
  }

  const values = parseDotEnv(readFileSync(configPath, "utf8"), {
    sourcePath: configPath,
  });
  const databaseName = requireValue(values, "D1_DATABASE_NAME", configPath);
  const backupDirectory = requireValue(values, "D1_BACKUP_DIR", configPath);
  if (!isAbsolute(backupDirectory)) {
    throw new Error(
      `${configPath}: D1_BACKUP_DIRはrepository外の絶対パスで指定してください。`,
    );
  }

  const accountId = optionalValue(values, "CLOUDFLARE_ACCOUNT_ID");
  if (environmentDefinition.remote && !accountId) {
    throw new Error(
      `${configPath}: remoteではCLOUDFLARE_ACCOUNT_IDが必須です。`,
    );
  }

  const apiToken = optionalValue(values, "CLOUDFLARE_API_TOKEN");
  const canonicalProjectRoot = realpathSync(projectRoot);
  const canonicalBackupDirectory = assertBackupDirectoryOutsideRepository(
    backupDirectory,
    canonicalProjectRoot,
  );
  const childEnvironment = createChildEnvironment({
    accountId: environmentDefinition.remote ? accountId : undefined,
    apiToken,
    databaseName,
    backupDirectory,
    processEnvironment,
  });

  return Object.freeze({
    accountId,
    apiToken,
    backupDirectory,
    canonicalBackupDirectory,
    childEnvironment,
    configPath,
    databaseName,
    environment,
    label: environmentDefinition.label,
    projectRoot: canonicalProjectRoot,
    scope: environmentDefinition.scope,
  });
}

export function assertBackupDirectoryOutsideRepository(
  backupDirectory,
  canonicalProjectRoot,
) {
  if (!isAbsolute(backupDirectory)) {
    throw new Error("D1_BACKUP_DIRは絶対パスで指定してください。");
  }

  const canonicalBackupDirectory = resolveExistingPath(backupDirectory);
  const relativePath = relative(canonicalProjectRoot, canonicalBackupDirectory);
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    throw new Error(
      "D1_BACKUP_DIRはrepository外のパスを指定してください。repository内や同じパスは使用できません。",
    );
  }

  return canonicalBackupDirectory;
}

export function ensureBackupDirectory(environmentConfig) {
  mkdirSync(environmentConfig.backupDirectory, { recursive: true });
  const canonicalBackupDirectory = assertBackupDirectoryOutsideRepository(
    environmentConfig.backupDirectory,
    environmentConfig.projectRoot,
  );
  return canonicalBackupDirectory;
}

function createChildEnvironment({
  accountId,
  apiToken,
  databaseName,
  backupDirectory,
  processEnvironment,
}) {
  const childEnvironment = { ...processEnvironment };
  for (const variable of cloudflareAuthVariables) {
    delete childEnvironment[variable];
  }

  childEnvironment.D1_DATABASE_NAME = databaseName;
  childEnvironment.D1_BACKUP_DIR = backupDirectory;
  if (accountId) {
    childEnvironment.CLOUDFLARE_ACCOUNT_ID = accountId;
  }
  if (apiToken) {
    childEnvironment.CLOUDFLARE_API_TOKEN = apiToken;
  }
  return childEnvironment;
}

function parseDotEnvValue(rawValue, sourcePath, lineNumber) {
  if (rawValue.startsWith('"')) {
    if (!rawValue.endsWith('"') || rawValue.length === 1) {
      throw new Error(
        `${sourcePath}:${lineNumber}: double quoteが閉じていません。`,
      );
    }
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error(`${sourcePath}:${lineNumber}: 値のquoteが不正です。`);
    }
  }

  if (rawValue.startsWith("'")) {
    if (!rawValue.endsWith("'") || rawValue.length === 1) {
      throw new Error(
        `${sourcePath}:${lineNumber}: single quoteが閉じていません。`,
      );
    }
    return rawValue.slice(1, -1);
  }

  if (rawValue.includes("\0")) {
    throw new Error(`${sourcePath}:${lineNumber}: NUL文字は使用できません。`);
  }
  return rawValue;
}

function requireValue(values, key, sourcePath) {
  const value = optionalValue(values, key);
  if (!value) {
    throw new Error(`${sourcePath}: ${key}は空にできません。`);
  }
  return value;
}

function optionalValue(values, key) {
  const value = values[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function resolveExistingPath(inputPath) {
  let currentPath = resolve(inputPath);
  const missingSegments = [];

  while (true) {
    try {
      const canonicalExistingPath = realpathSync(currentPath);
      return resolve(canonicalExistingPath, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`パスを解決できません: ${inputPath}`);
    }
    missingSegments.push(currentPath.slice(parentPath.length + 1));
    currentPath = parentPath;
  }
}
