import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { test } from "node:test";

const idPattern =
  /^[A-Z][A-Z0-9-]*-(UNIT|LOCAL|REMOTE|LOAD|PRODUCTION-READONLY)-\d{3}$/u;
const cleanupBlockKey = Symbol.for(
  "taskseq.database-maintenance.cleanup-block",
);

export function createCaseMetadata(operation, profile) {
  return (id, title) => ({ id, operation, profile, title });
}

export function maintenanceCase(metadata, execute) {
  const declaration = validateCaseDefinition(metadata, execute);
  emit({ type: "declared", ...declaration });

  if (declaration.manual) {
    emit({
      type: "completed",
      id: declaration.id,
      status: resolveManualReviewStatus(declaration),
      durationMs: 0,
      cleanup: { status: "not-required" },
    });
    return;
  }

  if (declaration.skip) {
    emit({
      type: "completed",
      id: declaration.id,
      status: "skipped",
      durationMs: 0,
      cleanup: { status: "not-required" },
    });
    test(`${declaration.id} ${declaration.title}`, { skip: true }, execute);
    return;
  }

  test(`${declaration.id} ${declaration.title}`, async (nodeTestContext) => {
    const startedAt = performance.now();
    const cleanups = [];
    let executionError = null;
    let failureStage = "execution";
    const remoteBlock =
      declaration.profile === "remote"
        ? globalThis[cleanupBlockKey] || remoteCleanupBlockId()
        : null;

    if (remoteBlock) {
      executionError = new Error(
        `先行case ${remoteBlock} のcleanup失敗により実行を停止しました。`,
      );
      failureStage = "cleanup-block";
    } else {
      try {
        await execute(nodeTestContext, {
          addCleanup(cleanup) {
            if (typeof cleanup !== "function") {
              throw new TypeError("cleanupはfunctionで指定してください。");
            }
            cleanups.push(cleanup);
          },
          setFailureStage(stage) {
            failureStage = String(stage);
          },
        });
      } catch (error) {
        executionError = error;
      }
    }

    const cleanupErrors = [];
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0 && declaration.profile === "remote") {
      globalThis[cleanupBlockKey] = declaration.id;
      const blockPath = process.env.TASKSEQ_MAINTENANCE_REMOTE_BLOCK_PATH;
      if (blockPath) {
        writeFileSync(blockPath, `${declaration.id}\n`, {
          encoding: "utf8",
          flag: "w",
          mode: 0o600,
        });
      }
    }

    const cleanup =
      cleanups.length === 0
        ? { status: "not-required" }
        : cleanupErrors.length === 0
          ? { status: "passed" }
          : {
              status: "failed",
              message: cleanupErrors.map((error) => error.message).join("; "),
            };
    const failed = executionError !== null || cleanupErrors.length > 0;
    emit({
      type: "completed",
      id: declaration.id,
      status: failed ? "failed" : "passed",
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      cleanup,
      ...(executionError
        ? { failure: serializeFailure(executionError, failureStage) }
        : {}),
    });

    if (executionError && cleanupErrors.length > 0) {
      throw new AggregateError(
        [executionError, ...cleanupErrors],
        `${declaration.id}: executionとcleanupが失敗しました。`,
      );
    }
    if (executionError) {
      throw executionError;
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `${declaration.id}: cleanupが失敗しました。`,
      );
    }
  });
}

function remoteCleanupBlockId() {
  const blockPath = process.env.TASKSEQ_MAINTENANCE_REMOTE_BLOCK_PATH;
  if (!blockPath || !existsSync(blockPath)) {
    return null;
  }
  return "(別test process)";
}

export function manualMaintenanceCase(metadata) {
  maintenanceCase({ ...metadata, manual: true }, undefined);
}

export function resolveManualReviewStatus({
  acceptedReviewRevision,
  reviewRevision,
}) {
  if (typeof reviewRevision !== "string" || reviewRevision.length === 0) {
    throw new Error("manual caseにはreviewRevisionが必要です。");
  }
  if (
    acceptedReviewRevision !== null &&
    acceptedReviewRevision !== undefined &&
    (typeof acceptedReviewRevision !== "string" ||
      acceptedReviewRevision.length === 0)
  ) {
    throw new Error("acceptedReviewRevisionが不正です。");
  }
  return acceptedReviewRevision === reviewRevision
    ? "passed"
    : "manual-required";
}

export function validateCaseDefinition(metadata, execute) {
  if (!metadata || typeof metadata !== "object") {
    throw new TypeError("case metadataが必要です。");
  }
  const { id, operation, profile, title } = metadata;
  const idMatch = String(id ?? "").match(idPattern);
  if (!idMatch) {
    throw new Error(`case IDが不正です: ${id ?? "(未指定)"}`);
  }
  if (
    !["unit", "local", "remote", "load", "production-readonly"].includes(
      profile,
    )
  ) {
    throw new Error(`case profileが不正です: ${profile ?? "(未指定)"}`);
  }
  if (idMatch[1] !== profile.toUpperCase()) {
    throw new Error(`${id}: case IDとregistryのprofileが一致しません。`);
  }
  if (typeof operation !== "string" || operation.length === 0) {
    throw new Error(`${id}: operationが必要です。`);
  }
  if (typeof title !== "string" || title.length === 0) {
    throw new Error(`${id}: titleが必要です。`);
  }
  if (
    metadata.manual === true &&
    (typeof metadata.reviewOutput !== "string" ||
      metadata.reviewOutput.length === 0)
  ) {
    throw new Error(`${id}: manual caseにはreviewOutputが必要です。`);
  }
  return Object.freeze({
    acceptedReviewRevision: metadata.acceptedReviewRevision ?? null,
    hasExecution: typeof execute === "function",
    id,
    manual: metadata.manual === true,
    operation,
    profile,
    reviewOutput: metadata.reviewOutput ?? null,
    reviewRevision: metadata.reviewRevision ?? null,
    skip: metadata.skip === true,
    title,
  });
}

function emit(event) {
  const eventPath = process.env.TASKSEQ_MAINTENANCE_EVENTS_PATH;
  if (!eventPath) {
    return;
  }
  appendFileSync(eventPath, `${JSON.stringify(event)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function serializeFailure(error, stage) {
  return {
    actual: redactValue(error?.actual),
    expected: redactValue(error?.expected),
    message: redactText(error?.message ?? String(error)),
    stage,
  };
}

function redactValue(value, key = "") {
  if (/token|secret|password|database.?id/iu.test(key)) {
    return "<redacted>";
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function redactText(value) {
  let text = String(value);
  for (const secret of [
    process.env.CLOUDFLARE_API_TOKEN,
    process.env.CLOUDFLARE_API_KEY,
  ]) {
    if (secret) {
      text = text.replaceAll(secret, "<redacted>");
    }
  }
  return text.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
    "<redacted-database-id>",
  );
}
