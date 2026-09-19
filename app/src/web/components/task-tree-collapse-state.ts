const TASK_TREE_COLLAPSE_STORAGE_VERSION = 1;
const TASK_TREE_COLLAPSE_STORAGE_PREFIX = "taskseq:task-tree-collapse:v1:";

type TaskTreeCollapsePayload = {
  version: typeof TASK_TREE_COLLAPSE_STORAGE_VERSION;
  collapsedTaskIds: string[];
};

export type TaskTreeCollapseStorageState = {
  collapsedTaskIds: Set<string>;
  storage: Storage | null;
};

export function taskTreeCollapseStorageKey(rootGroupKey: string) {
  return `${TASK_TREE_COLLAPSE_STORAGE_PREFIX}${rootGroupKey}`;
}

export function readTaskTreeCollapseState(
  rootGroupKey: string,
): TaskTreeCollapseStorageState {
  if (typeof window === "undefined") {
    return { collapsedTaskIds: new Set(), storage: null };
  }

  try {
    const storage = window.sessionStorage;
    const storageKey = taskTreeCollapseStorageKey(rootGroupKey);
    const rawPayload = storage.getItem(storageKey);
    if (rawPayload !== null) storage.setItem(storageKey, rawPayload);
    return {
      collapsedTaskIds: parseTaskTreeCollapsePayload(rawPayload),
      storage,
    };
  } catch {
    return { collapsedTaskIds: new Set(), storage: null };
  }
}

export function writeTaskTreeCollapseState(
  storage: Storage,
  rootGroupKey: string,
  collapsedTaskIds: Iterable<string>,
) {
  const payload: TaskTreeCollapsePayload = {
    version: TASK_TREE_COLLAPSE_STORAGE_VERSION,
    collapsedTaskIds: [...new Set(collapsedTaskIds)].sort(),
  };

  try {
    storage.setItem(
      taskTreeCollapseStorageKey(rootGroupKey),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    try {
      storage.removeItem(taskTreeCollapseStorageKey(rootGroupKey));
    } catch {
      // A storage failure should leave the current tree usable in memory.
    }
    return false;
  }
}

function parseTaskTreeCollapsePayload(rawPayload: string | null) {
  if (!rawPayload) return new Set<string>();

  try {
    const payload: unknown = JSON.parse(rawPayload);
    if (!isTaskTreeCollapsePayload(payload)) return new Set<string>();
    return new Set(payload.collapsedTaskIds);
  } catch {
    return new Set<string>();
  }
}

function isTaskTreeCollapsePayload(
  payload: unknown,
): payload is TaskTreeCollapsePayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<TaskTreeCollapsePayload>;
  return (
    candidate.version === TASK_TREE_COLLAPSE_STORAGE_VERSION &&
    Array.isArray(candidate.collapsedTaskIds) &&
    candidate.collapsedTaskIds.every((taskId) => typeof taskId === "string")
  );
}
