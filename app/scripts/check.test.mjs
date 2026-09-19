import { EventEmitter } from "node:events";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runCheck } from "./check.mjs";

function createSink() {
  const chunks = [];

  return {
    chunks,
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

function createChild({
  stdout = [],
  stderr = [],
  outputEvents = null,
  exitCode = 0,
  signal = null,
  close = true,
  error = null,
} = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killSignals = [];
  child.kill = (killSignal) => {
    child.killSignals.push(killSignal);
    return true;
  };
  if (close || error) {
    queueMicrotask(() => {
      for (const event of outputEvents ?? [
        ...stdout.map((chunk) => ({ chunk, stream: "stdout" })),
        ...stderr.map((chunk) => ({ chunk, stream: "stderr" })),
      ]) {
        child[event.stream].emit("data", Buffer.from(event.chunk));
      }
      if (error) {
        child.emit("error", error);
      }
      child.emit("close", error ? null : exitCode, signal);
    });
  }
  return child;
}

it("runs the five standard stages once in order and suppresses successful tool output", async () => {
  const calls = [];
  const stdout = createSink();
  const stderr = createSink();

  const result = await runCheck({
    spawn(command, args, options) {
      calls.push({ args, command, options });
      return createChild({
        stdout: ["tool output\n"],
        stderr: ["tool warning\n"],
      });
    },
    stdout,
    stderr,
    now: () => 0,
  });

  expect(result).toEqual({ exitCode: 0 });
  expect(calls.map(({ command, args }) => [command, args])).toEqual([
    ["pnpm", ["exec", "biome", "check", "."]],
    ["pnpm", ["exec", "tsc", "--noEmit"]],
    [
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.config.ts",
        "--reporter=agent",
      ],
    ],
    [
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.worker.config.ts",
        "--reporter=agent",
      ],
    ],
    ["pnpm", ["exec", "vite", "build"]],
  ]);
  expect(calls.every(({ options }) => options.cwd.endsWith("/app"))).toBe(true);
  expect(calls.every(({ options }) => options.shell === false)).toBe(true);
  expect(stdout.text()).toMatch(/\[1\/5\] lint \.\.\./);
  expect(stdout.text()).toMatch(/\[5\/5\] build passed \(0\.0s\)/);
  expect(stdout.text()).toMatch(/check passed \(0\.0s\)/);
  expect(stdout.text()).not.toContain("tool output");
  expect(stdout.text()).not.toContain("tool warning");
  expect(stderr.text()).toBe("");
});

describe("failure handling", () => {
  it("replays a failed stage's output and stops before later stages", async () => {
    const calls = [];
    const stdout = createSink();
    const stderr = createSink();
    let invocation = 0;

    const result = await runCheck({
      spawn(command, args, options) {
        calls.push({ args, command, options });
        invocation += 1;
        return invocation === 1
          ? createChild({ stdout: ["hidden lint output\n"] })
          : createChild({
              stdout: ["failed stdout\n"],
              stderr: ["failed stderr\n"],
              exitCode: 7,
            });
      },
      stdout,
      stderr,
      now: () => 0,
    });

    expect(result).toMatchObject({ exitCode: 7, failedStage: "typecheck" });
    expect(calls).toHaveLength(2);
    expect(stdout.text()).not.toContain("hidden lint output");
    expect(stdout.text()).toContain("failed stdout");
    expect(stderr.text()).toContain("failed stderr");
    expect(stderr.text()).toContain("typecheck failed (exit code 7)");
    expect(stderr.text()).toContain("check failed at typecheck");
  });

  it("reports a spawn error and does not invoke a later stage", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const calls = [];

    const result = await runCheck({
      spawn(command, args, options) {
        calls.push({ args, command, options });
        return createChild({
          error: new Error("executable not found"),
          stdout: ["spawn stdout\n"],
          stderr: ["spawn stderr\n"],
        });
      },
      stdout,
      stderr,
      now: () => 0,
    });

    expect(result).toMatchObject({ exitCode: 1, failedStage: "lint" });
    expect(calls).toHaveLength(1);
    expect(stdout.text()).toContain("spawn stdout");
    expect(stderr.text()).toContain("spawn stderr");
    expect(stderr.text()).toContain(
      "lint failed (spawn error: executable not found)",
    );
    expect(stderr.text()).toContain("check failed at lint");
  });

  it("handles a process runner that throws while spawning", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const result = await runCheck({
      spawn() {
        throw new Error("spawn could not be called");
      },
      stdout,
      stderr,
      now: () => 0,
    });

    expect(result).toMatchObject({ exitCode: 1, failedStage: "lint" });
    expect(stderr.text()).toContain("spawn error: spawn could not be called");
  });
});

describe("verbose mode", () => {
  it("streams tool output and explicitly selects the default Vitest reporter", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const calls = [];

    const result = await runCheck({
      verbose: true,
      spawn(command, args, options) {
        calls.push({ args, command, options });
        return createChild({
          stdout: ["visible output\n"],
          stderr: ["visible warning\n"],
        });
      },
      stdout,
      stderr,
      now: () => 0,
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(stdout.text()).toContain("visible output");
    expect(stderr.text()).toContain("visible warning");
    expect(calls[2].args.at(-1)).toBe("--reporter=default");
    expect(calls[3].args.at(-1)).toBe("--reporter=default");
  });
});

describe("heartbeat and signal cleanup", () => {
  it("prints a heartbeat after 30 seconds and clears it when the stage ends", async () => {
    vi.useFakeTimers();
    try {
      const stdout = createSink();
      const stderr = createSink();
      let child;
      let invocation = 0;
      let spawnReady;
      const spawned = new Promise((resolve) => {
        spawnReady = resolve;
      });
      const runPromise = runCheck({
        spawn() {
          invocation += 1;
          child = createChild({ close: false });
          spawnReady();
          if (invocation > 1) {
            return createChild();
          }
          return child;
        },
        stdout,
        stderr,
      });

      await spawned;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(stdout.text()).toContain("[1/5] lint still running (30s)");

      child.emit("close", 0, null);
      await runPromise;
      const outputAfterClose = stdout.text();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stdout.text()).toBe(outputAfterClose);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["SIGINT", "SIGTERM"])(
    "forwards %s and exits unsuccessfully",
    async (signal) => {
      const stdout = createSink();
      const stderr = createSink();
      const registered = new Map();
      const removed = [];
      let child;
      let spawnReady;
      const spawned = new Promise((resolve) => {
        spawnReady = resolve;
      });

      const runPromise = runCheck({
        spawn() {
          child = createChild({ close: false });
          spawnReady();
          return child;
        },
        stdout,
        stderr,
        signalHandlers: {
          on(name, handler) {
            registered.set(name, handler);
          },
          off(name, handler) {
            removed.push([name, handler]);
          },
        },
        now: () => 0,
      });

      await spawned;
      registered.get(signal)();
      expect(child.killSignals).toEqual([signal]);
      child.stdout.emit("data", Buffer.from("interrupted stdout\n"));
      child.stderr.emit("data", Buffer.from("interrupted stderr\n"));
      child.emit("close", null, signal);

      const result = await runPromise;
      expect(result.exitCode).toBeGreaterThan(0);
      expect(stderr.text()).toContain(`signal ${signal}`);
      expect(stdout.text()).toContain("interrupted stdout");
      expect(stderr.text()).toContain("interrupted stderr");
      expect(removed).toHaveLength(2);
    },
  );
});

describe("failure output limits", () => {
  it("shows the first and last 32 KiB and retains an unreadable-to-others complete log", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const head = "A".repeat(32 * 1024);
    const omitted = "B".repeat(10);
    const tail = "C".repeat(32 * 1024);
    const result = await runCheck({
      spawn() {
        return createChild({
          outputEvents: [
            { chunk: head, stream: "stdout" },
            { chunk: omitted, stream: "stderr" },
            { chunk: tail, stream: "stdout" },
          ],
          exitCode: 9,
        });
      },
      stdout,
      stderr,
      now: () => 0,
    });

    expect(result).toMatchObject({ exitCode: 9, failedStage: "lint" });
    expect(stderr.text()).toContain("showing first 32768 and last 32768 bytes");
    expect(stderr.text()).toContain("omitted 10 bytes");
    const logPath = stderr.text().match(/complete log: (.+)\n/)?.[1];
    expect(logPath).toBeTruthy();
    expect(logPath.startsWith("/")).toBe(true);
    await expect(readFile(logPath, "utf8")).resolves.toBe(
      head + omitted + tail,
    );
    const logStats = await stat(logPath);
    const directoryStats = await stat(dirname(logPath));
    expect(logStats.mode & 0o777).toBe(0o600);
    expect(directoryStats.mode & 0o777).toBe(0o700);
    expect(stdout.text()).toContain(head);
    expect(stdout.text()).toContain(tail);
    expect(stdout.text()).not.toContain(omitted);

    await rm(logPath);
    await rm(dirname(logPath), { recursive: true, force: true });
  });

  it("does not create a retained log for a small failure", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const fileSystem = {
      chmod: vi.fn(),
      mkdtemp: vi.fn(async () => "/tmp/taskseq-check-test"),
      rm: vi.fn(),
      writeFile: vi.fn(),
    };

    await runCheck({
      spawn() {
        return createChild({ stdout: ["small failure\n"], exitCode: 1 });
      },
      stdout,
      stderr,
      fileSystem,
      now: () => 0,
    });

    expect(fileSystem.mkdtemp).toHaveBeenCalledTimes(1);
    expect(fileSystem.writeFile).toHaveBeenCalledTimes(2);
    expect(fileSystem.rm).toHaveBeenCalledWith("/tmp/taskseq-check-test", {
      force: true,
      recursive: true,
    });
  });

  it("removes each successful stage's temporary log", async () => {
    const stdout = createSink();
    const stderr = createSink();
    let directoryNumber = 0;
    const fileSystem = {
      chmod: vi.fn(),
      mkdtemp: vi.fn(async () => {
        directoryNumber += 1;
        return `/tmp/taskseq-check-${directoryNumber}`;
      }),
      rm: vi.fn(),
      writeFile: vi.fn(),
    };

    const result = await runCheck({
      spawn() {
        return createChild();
      },
      stdout,
      stderr,
      fileSystem,
      now: () => 0,
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(fileSystem.mkdtemp).toHaveBeenCalledTimes(5);
    expect(fileSystem.writeFile).toHaveBeenCalledTimes(10);
    expect(fileSystem.rm).toHaveBeenCalledTimes(5);
  });

  it("fails instead of hiding a temporary-log cleanup error", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const cleanupError = new Error("permission denied while removing log");
    const fileSystem = {
      chmod: vi.fn(),
      mkdtemp: vi.fn(async () => "/tmp/taskseq-check-cleanup-error"),
      rm: vi.fn(async () => {
        throw cleanupError;
      }),
      writeFile: vi.fn(),
    };

    const result = await runCheck({
      spawn() {
        return createChild();
      },
      stdout,
      stderr,
      fileSystem,
      now: () => 0,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      failedStage: "lint",
      failure: { kind: "cleanup-error" },
    });
    expect(stderr.text()).toContain(
      "cleanup error: permission denied while removing log",
    );
    expect(stderr.text()).toContain("temporary log cleanup error");
  });

  it("does not call an incomplete log a complete log", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const writeError = new Error("log write failed");
    const cleanupError = new Error("log cleanup failed");
    let writeCount = 0;
    const fileSystem = {
      chmod: vi.fn(),
      mkdtemp: vi.fn(async () => "/tmp/taskseq-check-incomplete"),
      rm: vi.fn(async () => {
        throw cleanupError;
      }),
      writeFile: vi.fn(async () => {
        writeCount += 1;
        if (writeCount % 2 === 0) {
          throw writeError;
        }
      }),
    };

    const result = await runCheck({
      spawn() {
        return createChild({
          stdout: ["X".repeat(64 * 1024 + 1)],
          exitCode: 1,
        });
      },
      stdout,
      stderr,
      fileSystem,
      now: () => 0,
    });

    expect(result).toMatchObject({ exitCode: 1, failedStage: "lint" });
    expect(stderr.text()).toContain("complete log unavailable");
    expect(stderr.text()).not.toContain(
      "complete log: /tmp/taskseq-check-incomplete",
    );
  });
});
