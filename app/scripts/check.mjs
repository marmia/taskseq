import { spawn as defaultSpawn } from "node:child_process";
import { appendFile, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const heartbeatIntervalMs = 30_000;
const failureOutputLimitBytes = 64 * 1024;
const failureOutputHeadBytes = 32 * 1024;
const failureOutputTailBytes = 32 * 1024;
const forwardedSignals = ["SIGINT", "SIGTERM"];

const defaultFileSystem = {
  appendFile,
  chmod,
  mkdtemp,
  rm,
  writeFile,
};

export const checkStages = Object.freeze([
  Object.freeze({ label: "lint", tool: "biome", args: ["check", "."] }),
  Object.freeze({ label: "typecheck", tool: "tsc", args: ["--noEmit"] }),
  Object.freeze({
    label: "Web test",
    tool: "vitest",
    args: ["run", "--config", "vitest.config.ts"],
  }),
  Object.freeze({
    label: "Worker test",
    tool: "vitest",
    args: ["run", "--config", "vitest.worker.config.ts"],
  }),
  Object.freeze({ label: "build", tool: "vite", args: ["build"] }),
]);

function createStageCommand(stage, verbose) {
  const reporter =
    stage.tool === "vitest"
      ? `--reporter=${verbose ? "default" : "agent"}`
      : null;
  return {
    command: "pnpm",
    args: ["exec", stage.tool, ...stage.args, ...(reporter ? [reporter] : [])],
  };
}

export function getCheckStages({ verbose = false } = {}) {
  return checkStages.map((stage) => ({
    ...stage,
    ...createStageCommand(stage, verbose),
  }));
}

function writeLine(stream, line) {
  stream.write(`${line}\n`);
}

function writeChunk(stream, chunk) {
  stream.write(chunk);
}

function asBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function formatDuration(milliseconds) {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
}

function formatFailureStatus(outcome) {
  if (outcome.kind === "cleanup-error") {
    return `cleanup error: ${outcome.error.message}`;
  }
  if (outcome.receivedSignal) {
    return `signal ${outcome.receivedSignal}`;
  }
  if (outcome.signal) {
    return `signal ${outcome.signal}`;
  }
  if (outcome.kind === "spawn-error") {
    return `spawn error: ${outcome.error.message}`;
  }
  return `exit code ${outcome.exitCode}`;
}

function defaultSignalHandlers() {
  return {
    on(signal, handler) {
      process.on(signal, handler);
    },
    off(signal, handler) {
      process.off(signal, handler);
    },
  };
}

function signalExitCode(signal) {
  const signalNumber = {
    SIGINT: 2,
    SIGTERM: 15,
  }[signal];
  return signalNumber ? 128 + signalNumber : 1;
}

async function persistFailureLog({
  data,
  fileSystem,
  stageLabel,
  tempDirectory,
}) {
  const temporaryLog = await createTemporaryLog({
    fileSystem,
    stageLabel,
    tempDirectory,
  });
  const result = await finalizeTemporaryLog({
    data,
    fileSystem,
    keep: true,
    temporaryLog,
  });
  return result.path ?? { error: result.error };
}

async function createTemporaryLog({ fileSystem, stageLabel, tempDirectory }) {
  let logDirectory;
  try {
    logDirectory = await fileSystem.mkdtemp(
      join(tempDirectory, "taskseq-check-"),
    );
    await fileSystem.chmod(logDirectory, 0o700);
    const logPath = resolve(
      join(
        logDirectory,
        `${stageLabel.toLowerCase().replaceAll(" ", "-")}.log`,
      ),
    );
    await fileSystem.writeFile(logPath, Buffer.alloc(0), {
      flag: "wx",
      mode: 0o600,
    });
    await fileSystem.chmod(logPath, 0o600);
    return {
      directory: logDirectory,
      hasOutput: false,
      path: logPath,
      writeChain: Promise.resolve(),
      writeError: null,
    };
  } catch (error) {
    if (logDirectory) {
      try {
        await fileSystem.rm(logDirectory, { force: true, recursive: true });
      } catch {
        // Preserve the original log-write error as the useful diagnostic.
      }
    }
    return { error };
  }
}

async function finalizeTemporaryLog({ data, fileSystem, keep, temporaryLog }) {
  if (!temporaryLog?.path) {
    return temporaryLog ?? {};
  }

  try {
    await temporaryLog.writeChain;
    if (
      temporaryLog.writeError ||
      !temporaryLog.hasOutput ||
      typeof fileSystem.appendFile !== "function"
    ) {
      await fileSystem.writeFile(temporaryLog.path, data, {
        flag: "w",
        mode: 0o600,
      });
    }
    await fileSystem.chmod(temporaryLog.path, 0o600);
  } catch (error) {
    try {
      await fileSystem.rm(temporaryLog.directory, {
        force: true,
        recursive: true,
      });
    } catch (cleanupError) {
      return {
        cleanupError,
        error,
      };
    }
    return { error };
  }

  if (keep) {
    return { path: temporaryLog.path };
  }

  try {
    await fileSystem.rm(temporaryLog.directory, {
      force: true,
      recursive: true,
    });
  } catch (error) {
    return { cleanupError: error, error, path: temporaryLog.path };
  }
  return {};
}

function replayRange(events, start, end, stdout, stderr) {
  let offset = 0;
  for (const event of events) {
    const eventEnd = offset + event.data.length;
    const overlapStart = Math.max(start, offset);
    const overlapEnd = Math.min(end, eventEnd);
    if (overlapStart < overlapEnd) {
      const dataStart = overlapStart - offset;
      const dataEnd = overlapEnd - offset;
      writeChunk(
        event.stream === "stdout" ? stdout : stderr,
        event.data.subarray(dataStart, dataEnd),
      );
    }
    offset = eventEnd;
    if (offset >= end) {
      break;
    }
  }
}

function outputByteLength(events) {
  return events.reduce((total, event) => total + event.data.length, 0);
}

async function reportFailure({
  outcome,
  stage,
  stageIndex,
  stderr,
  stdout,
  fileSystem,
  tempDirectory,
  verbose,
}) {
  const prefix = `[${stageIndex + 1}/${checkStages.length}] ${stage.label}`;
  writeLine(stderr, `${prefix} failed (${formatFailureStatus(outcome)})`);
  if (outcome.temporaryLog?.error) {
    const pathDescription = outcome.temporaryLog.path
      ? `; path: ${outcome.temporaryLog.path}`
      : "";
    const errorType = outcome.temporaryLog.cleanupError
      ? "cleanup error"
      : "error";
    writeLine(
      stderr,
      `${prefix} temporary log ${errorType}: ${outcome.temporaryLog.error.message}${pathDescription}`,
    );
  }

  if (verbose) {
    writeLine(stderr, `${prefix} stdout/stderr was streamed above`);
    return;
  }

  const outputBytes = outputByteLength(outcome.events);
  if (outputBytes === 0) {
    writeLine(stderr, `${prefix} stdout/stderr was empty`);
    return;
  }

  const combinedOutput = Buffer.concat(
    outcome.events.map((event) => event.data),
  );
  if (outputBytes <= failureOutputLimitBytes) {
    writeLine(stderr, `${prefix} stdout/stderr:`);
    replayRange(outcome.events, 0, outputBytes, stdout, stderr);
    return;
  }

  const logResult =
    typeof outcome.temporaryLog?.path === "string"
      ? outcome.temporaryLog.path
      : await persistFailureLog({
          data: combinedOutput,
          fileSystem,
          stageLabel: stage.label,
          tempDirectory,
        });
  const omittedBytes = outputBytes - failureOutputLimitBytes;
  const logDescription =
    typeof logResult === "string"
      ? `complete log: ${logResult}`
      : `complete log unavailable: ${logResult.error?.message ?? "unknown error"}`;
  writeLine(
    stderr,
    `${prefix} stdout/stderr truncated: showing first ${failureOutputHeadBytes} and last ${failureOutputTailBytes} bytes; omitted ${omittedBytes} bytes; ${logDescription}`,
  );
  writeLine(stderr, `${prefix} output head:`);
  replayRange(outcome.events, 0, failureOutputHeadBytes, stdout, stderr);
  writeLine(stderr, `${prefix} output tail:`);
  replayRange(
    outcome.events,
    outputBytes - failureOutputTailBytes,
    outputBytes,
    stdout,
    stderr,
  );
}

async function runStage({
  stage,
  stageCommand,
  verbose,
  spawn,
  cwd,
  env,
  stdout,
  stderr,
  now,
  setInterval,
  clearInterval,
  signalHandlers,
  fileSystem,
  tempDirectory,
}) {
  const temporaryLog = verbose
    ? null
    : await createTemporaryLog({
        fileSystem,
        stageLabel: stage.label,
        tempDirectory,
      });
  let child;
  try {
    child = spawn(stageCommand.command, stageCommand.args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const finalizedLog = await finalizeTemporaryLog({
      data: Buffer.alloc(0),
      fileSystem,
      keep: false,
      temporaryLog,
    });
    return {
      kind: "spawn-error",
      error,
      exitCode: 1,
      events: [],
      signal: null,
      receivedSignal: null,
      temporaryLog: finalizedLog,
    };
  }

  const events = [];
  let receivedSignal = null;
  let spawnError = null;
  let heartbeatTimer;
  let settled = false;
  const startedAt = now();
  const handlers = new Map();

  const recordOutput = (streamName, chunk) => {
    const data = asBuffer(chunk);
    if (verbose) {
      writeChunk(streamName === "stdout" ? stdout : stderr, data);
    } else if (data.length > 0) {
      events.push({ data, stream: streamName });
      temporaryLog.hasOutput = true;
      if (temporaryLog?.path && typeof fileSystem.appendFile === "function") {
        temporaryLog.writeChain = temporaryLog.writeChain
          .then(() => fileSystem.appendFile(temporaryLog.path, data))
          .catch((error) => {
            temporaryLog.writeError ??= error;
          });
      }
    }
  };

  const cleanup = () => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    for (const [signal, handler] of handlers) {
      signalHandlers.off(signal, handler);
    }
  };

  const addSignalHandler = (signal) => {
    const handler = () => {
      if (receivedSignal) {
        return;
      }
      receivedSignal = signal;
      if (typeof child.kill === "function") {
        child.kill(signal);
      }
    };
    handlers.set(signal, handler);
    signalHandlers.on(signal, handler);
  };

  for (const signal of forwardedSignals) {
    addSignalHandler(signal);
  }

  child.stdout?.on("data", (chunk) => recordOutput("stdout", chunk));
  child.stderr?.on("data", (chunk) => recordOutput("stderr", chunk));

  heartbeatTimer = setInterval(() => {
    const elapsedSeconds = Math.max(30, Math.floor((now() - startedAt) / 1000));
    writeLine(
      stdout,
      `[${stageCommand.index}/${checkStages.length}] ${stage.label} still running (${elapsedSeconds}s)`,
    );
  }, heartbeatIntervalMs);

  return new Promise((resolve) => {
    const finish = async (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const outputBytes = outputByteLength(events);
      const finalizedLog = await finalizeTemporaryLog({
        data: Buffer.concat(events.map((event) => event.data)),
        fileSystem,
        keep:
          !verbose &&
          outcome.kind !== "success" &&
          outputBytes > failureOutputLimitBytes,
        temporaryLog,
      });
      const finalOutcome =
        finalizedLog.error && outcome.kind === "success"
          ? {
              error: finalizedLog.error,
              exitCode: 1,
              kind: "cleanup-error",
              signal: null,
            }
          : outcome;
      resolve({
        ...finalOutcome,
        events,
        receivedSignal,
        temporaryLog: finalizedLog,
      });
    };

    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (exitCode, signal) => {
      if (receivedSignal || signal) {
        void finish({
          kind: "signal",
          exitCode: signalExitCode(receivedSignal ?? signal),
          signal: signal ?? receivedSignal,
        });
        return;
      }
      if (spawnError) {
        void finish({
          kind: "spawn-error",
          error: spawnError,
          exitCode: 1,
          signal: null,
        });
        return;
      }
      void finish({
        kind: exitCode === 0 ? "success" : "exit",
        exitCode: exitCode ?? 1,
        signal: null,
      });
    });
  });
}

export async function runCheck({
  verbose = false,
  spawn = defaultSpawn,
  cwd = appDirectory,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  now = Date.now,
  setInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
  signalHandlers = defaultSignalHandlers(),
  fileSystem = defaultFileSystem,
  tempDirectory = tmpdir(),
} = {}) {
  const stages = getCheckStages({ verbose });
  const checkStartedAt = now();

  for (const [stageIndex, stage] of stages.entries()) {
    const stageStartedAt = now();
    writeLine(
      stdout,
      `[${stageIndex + 1}/${stages.length}] ${stage.label} ...`,
    );
    const outcome = await runStage({
      stage,
      stageCommand: { ...stage, index: stageIndex + 1 },
      verbose,
      spawn,
      cwd,
      env,
      stdout,
      stderr,
      now,
      setInterval,
      clearInterval,
      signalHandlers,
      fileSystem,
      tempDirectory,
    });
    if (outcome.kind !== "success") {
      await reportFailure({
        outcome,
        stage,
        stageIndex,
        stderr,
        stdout,
        fileSystem,
        tempDirectory,
        verbose,
      });
      writeLine(
        stderr,
        `check failed at ${stage.label} (${formatDuration(now() - checkStartedAt)})`,
      );
      return {
        exitCode: outcome.exitCode || 1,
        failedStage: stage.label,
        failure: outcome,
      };
    }
    writeLine(
      stdout,
      `[${stageIndex + 1}/${stages.length}] ${stage.label} passed (${formatDuration(now() - stageStartedAt)})`,
    );
  }

  writeLine(stdout, `check passed (${formatDuration(now() - checkStartedAt)})`);
  return { exitCode: 0 };
}

export async function main(args = process.argv.slice(2)) {
  const verbose = args.length === 1 && args[0] === "--verbose";
  if (args.length > 0 && !verbose) {
    process.stderr.write("Usage: node scripts/check.mjs [--verbose]\n");
    return 2;
  }
  const result = await runCheck({ verbose });
  return result.exitCode;
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      process.stderr.write(`check failed: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
