import { describe, expect, it } from "vitest";
import type { Task } from "../domain/task";
import { previewTaskMove, type TaskTreeMoveContext } from "./task-tree-move";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    path: ["Inbox", id],
    areaId: 1,
    status: "OPEN",
    start: null,
    due: null,
    completedAt: null,
    updatedAt: "2026-08-30T00:00:00.000Z",
    tags: [],
    description: "",
    workNotes: "",
    version: 1,
    ...overrides,
  };
}

function context(
  allTasks: Task[],
  visibleTasks = allTasks,
  siblingOrders: Record<string, string[]> = {},
): TaskTreeMoveContext {
  return {
    rootGroupKey: "inbox",
    tasks: visibleTasks,
    allTasks,
    rootOrder: allTasks
      .filter((candidate) => !candidate.parentId)
      .map((candidate) => candidate.id),
    siblingOrders,
  };
}

describe("previewTaskMove", () => {
  it("emits only versioned relative-position data for a sibling move", () => {
    const source = task("source", { version: 4 });
    const target = task("target", { version: 7 });
    const preview = previewTaskMove(
      context([source, target]),
      source.id,
      target.id,
      "after",
    );

    expect(preview.valid).toBe(true);
    expect(preview.input).toEqual({
      taskId: source.id,
      taskVersion: 4,
      targetTaskId: target.id,
      targetTaskVersion: 7,
      position: "after",
    });
    expect(preview.input).not.toHaveProperty("ids");
    expect(preview.input).not.toHaveProperty("groupKey");
  });

  it("anchors as-last-child after the last visible child", () => {
    const source = task("source");
    const parent = task("parent");
    const visibleChild = task("visible-child", {
      parentId: parent.id,
      path: ["Inbox", parent.id, "visible-child"],
      version: 3,
    });
    const hiddenCompletedChild = task("hidden-completed-child", {
      parentId: parent.id,
      path: ["Inbox", parent.id, "hidden-completed-child"],
      status: "COMPLETED",
      completedAt: "2026-08-29T00:00:00.000Z",
      version: 5,
    });
    const preview = previewTaskMove(
      context(
        [source, parent, visibleChild, hiddenCompletedChild],
        [source, parent, visibleChild],
        { [`parent:${parent.id}`]: [visibleChild.id, hiddenCompletedChild.id] },
      ),
      source.id,
      parent.id,
      "as-last-child",
    );

    expect(preview.input).toEqual({
      taskId: source.id,
      taskVersion: 1,
      targetTaskId: parent.id,
      targetTaskVersion: 1,
      position: "as-last-child",
      anchorTaskId: visibleChild.id,
      anchorTaskVersion: 3,
      anchorPosition: "after",
    });
  });

  it("anchors before the first hidden sibling when no child is visible", () => {
    const source = task("source");
    const parent = task("parent");
    const hiddenCompletedChild = task("hidden-completed-child", {
      parentId: parent.id,
      path: ["Inbox", parent.id, "hidden-completed-child"],
      status: "COMPLETED",
      completedAt: "2026-08-29T00:00:00.000Z",
      version: 5,
    });
    const preview = previewTaskMove(
      context([source, parent, hiddenCompletedChild], [source, parent], {
        [`parent:${parent.id}`]: [hiddenCompletedChild.id],
      }),
      source.id,
      parent.id,
      "as-last-child",
    );

    expect(preview.input).toEqual({
      taskId: source.id,
      taskVersion: 1,
      targetTaskId: parent.id,
      targetTaskVersion: 1,
      position: "as-last-child",
      anchorTaskId: hiddenCompletedChild.id,
      anchorTaskVersion: 5,
      anchorPosition: "before",
    });
  });

  it("accepts same-Area reparenting and rejects cross-Area or cyclic destinations", () => {
    const source = task("source", { areaId: 1 });
    const targetParent = task("target-parent", { areaId: 1 });
    const otherAreaParent = task("other-area-parent", { areaId: 2 });
    const descendant = task("descendant", {
      areaId: 1,
      parentId: source.id,
      path: ["Inbox", source.id, "descendant"],
    });
    const allTasks = [source, targetParent, otherAreaParent, descendant];
    expect(
      previewTaskMove(
        context(allTasks),
        source.id,
        targetParent.id,
        "as-last-child",
      ),
    ).toMatchObject({
      valid: true,
      destinationParentId: targetParent.id,
      newDepth: 2,
    });
    expect(
      previewTaskMove(
        context(allTasks),
        source.id,
        otherAreaParent.id,
        "as-last-child",
      ),
    ).toMatchObject({
      valid: false,
      reason: "A Task subtree must stay within the same Area.",
    });
    expect(
      previewTaskMove(
        context(allTasks),
        source.id,
        descendant.id,
        "as-last-child",
      ),
    ).toMatchObject({
      valid: false,
      reason: "A Task cannot be moved below itself or one of its Subtasks.",
    });
  });
});
