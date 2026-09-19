import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireRemoteTestLease } from "./remote-target.mjs";
import {
  parseRunnerArguments,
  reconcileCaseEvents,
  runnerUsage,
} from "./runner-core.mjs";

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(scriptsDirectory, "..");
const casesDirectory = resolve(scriptsDirectory, "database-maintenance-tests");
const targetAliases = Object.freeze({
  unit: "none",
  local: "local-test",
  remote: "remote-test",
  load: "local-test",
  "production-readonly": "production",
});

export function discoverCaseFiles(profile, root = casesDirectory) {
  const directory = profile === "unit" ? root : resolve(root, profile);
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" && profile === "load") {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

export function runProfile(
  profile,
  {
    discover = discoverCaseFiles,
    acquireLease = acquireRemoteTestLease,
    nodePath = process.execPath,
    spawn = spawnSync,
    temporaryDirectory = tmpdir(),
  } = {},
) {
  const files = discover(profile);
  if (files.length === 0 && profile !== "load") {
    return reconcileCaseEvents({
      events: [],
      processExitCode: 1,
      profile,
    });
  }

  const runDirectory = mkdtempSync(
    join(temporaryDirectory, `taskseq-maintenance-${profile}-`),
  );
  const eventsPath = join(runDirectory, "events.jsonl");
  closeSync(openSync(eventsPath, "wx", 0o600));
  let lease = null;
  let result;
  try {
    if (profile === "remote") {
      try {
        lease = acquireLease();
      } catch (error) {
        return profileInfrastructureFailure(profile, error.message);
      }
    }
    if (files.length === 0) {
      return reconcileCaseEvents({ events: [], processExitCode: 0, profile });
    }
    const child = spawn(
      nodePath,
      ["--test", "--test-concurrency=1", "--test-reporter=spec", ...files],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          TASKSEQ_MAINTENANCE_EVENTS_PATH: eventsPath,
          TASKSEQ_MAINTENANCE_PROFILE: profile,
          TASKSEQ_MAINTENANCE_REMOTE_BLOCK_PATH: join(
            runDirectory,
            "remote-cleanup-block",
          ),
        },
        maxBuffer: 64 * 1024 * 1024,
        shell: false,
      },
    );
    const events = parseEventFile(eventsPath);
    result = reconcileCaseEvents({
      events,
      processExitCode: child.status ?? 1,
      profile,
    });
    result = Object.freeze({
      ...result,
      processOutput: result.ok
        ? null
        : truncateFailureOutput(`${child.stdout ?? ""}${child.stderr ?? ""}`),
    });
  } catch (error) {
    result = profileInfrastructureFailure(profile, error.message);
  } finally {
    rmSync(runDirectory, { force: true, recursive: true });
  }
  if (lease) {
    try {
      lease.release();
    } catch (error) {
      return Object.freeze({
        ...result,
        ok: false,
        registryErrors: [
          ...result.registryErrors,
          `remote-test lock cleanup failed: ${redactText(error.message)}`,
        ],
      });
    }
  }
  return result;
}

export function runMaintenanceTests(
  args = process.argv.slice(2),
  {
    now = () => new Date(),
    output = process.stdout,
    errorOutput = process.stderr,
    reportDirectory = resolve(scriptsDirectory, ".reports"),
    run = runProfile,
  } = {},
) {
  let options;
  try {
    options = parseRunnerArguments(args);
  } catch (error) {
    errorOutput.write(`${error.message}\n${runnerUsage()}\n`);
    return 2;
  }
  if (options.help) {
    output.write(`${runnerUsage()}\n`);
    return 0;
  }

  const startedAt = now();
  const profiles = [];
  for (const profile of options.profiles) {
    const result = run(profile);
    profiles.push(result);
    printProfileResult(result, output, errorOutput, options.manualReview);
  }
  const finishedAt = now();
  const report = createReport({
    finishedAt,
    options,
    profiles,
    startedAt,
  });
  const reportPath = writeReport(report, reportDirectory);
  output.write(`report: ${reportPath}\n`);
  return report.ok ? 0 : 1;
}

function parseEventFile(path) {
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function printProfileResult(
  result,
  output,
  errorOutput,
  showManualReview = false,
) {
  output.write(`[${result.profile}] target=${targetAliases[result.profile]}\n`);
  for (const testCase of result.cases) {
    if (showManualReview && testCase.status === "passed") {
      continue;
    }
    output.write(
      `${testCase.id} ${testCase.status} ${formatDuration(testCase.durationMs)}\n`,
    );
    if (testCase.status === "manual-required") {
      if (showManualReview && testCase.reviewOutput) {
        output.write(
          `[manual-review ${testCase.id}]\n${testCase.reviewOutput}\n`,
        );
      } else {
        output.write(
          `manual review: scripts/database-maintenance-test.sh unit --manual-review\n`,
        );
      }
    }
    if (testCase.failure) {
      errorOutput.write(
        `${testCase.id} stage=${testCase.failure.stage} expected=${formatDetail(testCase.failure.expected)} actual=${formatDetail(testCase.failure.actual)} error=${testCase.failure.message}\n`,
      );
    }
    if (testCase.cleanup?.status === "failed") {
      errorOutput.write(
        `${testCase.id} cleanup=failed error=${testCase.cleanup.message}\n`,
      );
    }
  }
  for (const error of result.registryErrors) {
    errorOutput.write(`[${result.profile}] ${error}\n`);
  }
  if (result.processOutput) {
    errorOutput.write(`${result.processOutput}\n`);
  }
}

function createReport({ finishedAt, options, profiles, startedAt }) {
  const cases = profiles.flatMap((profile) => profile.cases);
  return {
    schemaVersion: 1,
    commit: currentCommit(),
    requestedProfile: options.requestedProfile,
    targetAliases: Object.fromEntries(
      profiles.map(({ profile }) => [profile, targetAliases[profile]]),
    ),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    ok: profiles.every(({ ok }) => ok),
    counts: sumCounts(profiles),
    profiles: profiles.map(
      ({ cases: profileCases, counts, ok, profile, registryErrors }) => ({
        profile,
        targetAlias: targetAliases[profile],
        ok,
        counts,
        registryErrors,
        cases: profileCases.map((testCase) => ({
          id: testCase.id,
          operation: testCase.operation,
          title: testCase.title,
          status: testCase.status,
          durationMs: testCase.durationMs,
          cleanup: testCase.cleanup,
          ...(testCase.failure ? { failure: testCase.failure } : {}),
        })),
      }),
    ),
    caseCount: cases.length,
  };
}

function writeReport(report, directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const timestamp = report.startedAt.replaceAll(/[-:.]/gu, "");
  const basename = `maintenance-${report.requestedProfile}-${timestamp}.json`;
  for (let suffix = 0; ; suffix += 1) {
    const path = join(
      directory,
      suffix === 0 ? basename : basename.replace(/\.json$/u, `-${suffix}.json`),
    );
    try {
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return path;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }
  }
}

function sumCounts(profiles) {
  const total = {
    failed: 0,
    "manual-required": 0,
    passed: 0,
    skipped: 0,
    unexecuted: 0,
  };
  for (const { counts } of profiles) {
    for (const key of Object.keys(total)) {
      total[key] += counts[key];
    }
  }
  return total;
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function formatDuration(milliseconds) {
  return `${Math.max(0, Number(milliseconds) || 0).toFixed(1)}ms`;
}

function formatDetail(value) {
  return value === undefined ? "(not provided)" : JSON.stringify(value);
}

function truncateFailureOutput(output) {
  const limit = 16 * 1024;
  const truncated =
    output.length <= limit
      ? output.trim()
      : `${output.slice(0, limit)}\n... output truncated ...`;
  return redactText(truncated);
}

function profileInfrastructureFailure(profile, message) {
  const result = reconcileCaseEvents({
    events: [],
    processExitCode: 0,
    profile,
  });
  return Object.freeze({
    ...result,
    ok: false,
    registryErrors: [redactText(message)],
  });
}

function redactText(value) {
  return String(value).replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
    "<redacted-database-id>",
  );
}

if (
  resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))
) {
  process.exitCode = runMaintenanceTests();
}
