const supportedProfiles = Object.freeze([
  "unit",
  "local",
  "remote",
  "all",
  "load",
  "production-readonly",
]);

const executableProfiles = Object.freeze(["unit", "local", "remote"]);

export function parseRunnerArguments(args) {
  if (!Array.isArray(args)) {
    throw new TypeError("argsは配列で指定してください。");
  }
  const manualReviewArguments = args.filter(
    (argument) => argument === "--manual-review",
  );
  if (manualReviewArguments.length > 1) {
    throw new Error("--manual-reviewは1回だけ指定してください。");
  }
  const manualReview = manualReviewArguments.length === 1;
  const profileArguments = args.filter(
    (argument) => argument !== "--manual-review",
  );
  if (profileArguments.length > 1) {
    throw new Error("profileは1つだけ指定してください。");
  }
  const requestedProfile = profileArguments[0] ?? "unit";
  if (requestedProfile === "--help" || requestedProfile === "-h") {
    return {
      help: true,
      manualReview: false,
      profiles: [],
      requestedProfile: null,
    };
  }
  if (!supportedProfiles.includes(requestedProfile)) {
    throw new Error(
      `未対応のprofileです: ${requestedProfile}。${supportedProfiles.join(", ")}から指定してください。`,
    );
  }
  if (manualReview && requestedProfile !== "unit") {
    throw new Error("--manual-reviewはunit profileでだけ指定できます。");
  }

  return Object.freeze({
    help: false,
    manualReview,
    profiles:
      requestedProfile === "all" ? [...executableProfiles] : [requestedProfile],
    requestedProfile,
  });
}

export function reconcileCaseEvents({ events, processExitCode, profile }) {
  const declarations = new Map();
  const completions = new Map();
  const registryErrors = [];

  for (const event of events) {
    if (event?.type === "declared") {
      if (declarations.has(event.id)) {
        registryErrors.push(`duplicate ID: ${event.id}`);
      } else {
        declarations.set(event.id, event);
      }
      continue;
    }
    if (event?.type === "completed") {
      if (completions.has(event.id)) {
        registryErrors.push(`duplicate result: ${event.id}`);
      } else {
        completions.set(event.id, event);
      }
    }
  }

  for (const declaration of declarations.values()) {
    if (declaration.profile !== profile) {
      registryErrors.push(
        `profile mismatch: ${declaration.id} declared ${declaration.profile}, executed ${profile}`,
      );
    }
    if (declaration.hasExecution !== true && declaration.manual !== true) {
      registryErrors.push(`execution definition missing: ${declaration.id}`);
    }
  }

  const cases = [];
  for (const declaration of declarations.values()) {
    const completion = completions.get(declaration.id);
    const result = completion ?? {
      id: declaration.id,
      type: "completed",
      status: "unexecuted",
      durationMs: 0,
    };
    cases.push(Object.freeze({ ...declaration, ...result }));
    if (!completion) {
      registryErrors.push(`unexecuted: ${declaration.id}`);
    } else if (completion.status === "skipped") {
      registryErrors.push(`skipped: ${declaration.id}`);
    }
    if (completion?.cleanup?.status === "failed") {
      registryErrors.push(
        `cleanup failed: ${declaration.id}: ${completion.cleanup.message}`,
      );
    }
  }

  for (const completion of completions.values()) {
    if (!declarations.has(completion.id)) {
      registryErrors.push(`undeclared result: ${completion.id}`);
    }
  }
  if (processExitCode !== 0) {
    registryErrors.push(`test process exited with code ${processExitCode}`);
  }

  const counts = {
    failed: 0,
    "manual-required": 0,
    passed: 0,
    skipped: 0,
    unexecuted: 0,
  };
  for (const testCase of cases) {
    if (Object.hasOwn(counts, testCase.status)) {
      counts[testCase.status] += 1;
    }
  }

  return Object.freeze({
    cases,
    counts: Object.freeze(counts),
    ok: counts.failed === 0 && registryErrors.length === 0,
    profile,
    registryErrors,
  });
}

export function runnerUsage() {
  return `Database maintenance test runner

Usage:
  scripts/database-maintenance-test.sh [unit|local|remote|all|load|production-readonly]
  scripts/database-maintenance-test.sh unit --manual-review

With no profile, only unit cases run. all runs unit, local, and remote in order.
unit --manual-review prints safe Owner review previews without connecting to a database.`;
}
