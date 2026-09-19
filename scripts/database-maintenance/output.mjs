import { randomUUID } from "node:crypto";
import { linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export function createMaintenanceOutput({
  environment,
  extension,
  now = () => new Date(),
  operation,
  outputDirectory,
  validatePartial = () => {},
  writePartial,
} = {}) {
  const basename = `${environment}-${operation}-${formatTimestamp(now())}`;
  const partialPath = join(
    outputDirectory,
    `.${basename}.${process.pid}-${randomUUID()}.partial`,
  );

  try {
    writePartial(partialPath);
    validatePartial(partialPath);
    const path = linkWithoutOverwrite({
      basename,
      extension,
      outputDirectory,
      partialPath,
    });
    unlinkSync(partialPath);
    return path;
  } catch (error) {
    removePartialFile(partialPath);
    throw error;
  }
}

function linkWithoutOverwrite({
  basename,
  extension,
  outputDirectory,
  partialPath,
}) {
  for (let suffix = 0; ; suffix += 1) {
    const suffixText = suffix === 0 ? "" : `-${suffix}`;
    const path = join(
      outputDirectory,
      `${basename}${suffixText}.${extension}`,
    );
    try {
      linkSync(partialPath, path);
      return path;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }
  }
}

function formatTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace("T", "-")
    .replace(".", "-");
}

function removePartialFile(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      // The original write or validation error is more useful to the caller.
    }
  }
}
