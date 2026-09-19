import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapResponseSchema,
  defaultViewColumns,
  defaultViewSort,
  taskSearchResponseSchema,
} from "../shared/api-schema";
import { ownerAreaFixtures, workerAreaIds } from "./test/area-fixtures";
import { d1Migrations } from "./test/d1-migrations";

const baseView = {
  name: "  Open planning Tasks  ",
  allTasks: true,
  conditions: [],
  sort: [...defaultViewSort],
  columns: [...defaultViewColumns],
};

describe("View API", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM views"),
      env.DB.prepare("DELETE FROM task_tags"),
      env.DB.prepare("DELETE FROM tags"),
      env.DB.prepare("DELETE FROM tasks"),
      env.DB.prepare("DELETE FROM areas"),
      env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'areas'"),
      ...ownerAreaFixtures.map((area) =>
        env.DB.prepare(
          `INSERT INTO areas (id, name, color, position, is_system_managed)
           VALUES (?, ?, ?, ?, 0)`,
        ).bind(area.id, area.name, area.color, area.position),
      ),
      env.DB.prepare(
        `INSERT INTO areas (id, name, color, position, is_system_managed)
         VALUES (?, 'Inbox', 'gray', 0, 1)`,
      ).bind(workerAreaIds.inbox),
    ]);
  });

  it("persists an explicit All Tasks View with defaults and restores it from bootstrap", async () => {
    const created = await createView({
      name: baseView.name,
      allTasks: true,
    });

    expect(created.status).toBe(201);
    const snapshot = bootstrapResponseSchema.parse(await created.json());
    expect(snapshot.views).toHaveLength(1);
    expect(snapshot.views[0]).toMatchObject({
      name: "Open planning Tasks",
      allTasks: true,
      conditions: [],
      sort: defaultViewSort,
      columns: defaultViewColumns,
      version: 1,
    });
    expect(snapshot.views[0]?.createdAt).toEqual(snapshot.views[0]?.updatedAt);

    const reloaded = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reloaded.json()).views).toEqual(
      snapshot.views,
    );
  });

  it("exposes Views without retaining the removed saved-search API contract", async () => {
    const created = await createView(baseView);
    expect(created.status).toBe(201);

    const bootstrap = await SELF.fetch("http://example.com/api/v1/bootstrap");
    const rawSnapshot = (await bootstrap.json()) as Record<string, unknown>;
    expect(rawSnapshot.views).toEqual(expect.any(Array));
    expect(rawSnapshot).not.toHaveProperty("savedSearches");

    const legacyRequests = await Promise.all([
      SELF.fetch("http://example.com/api/v1/saved-searches"),
      SELF.fetch("http://example.com/api/v1/saved-searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Legacy" }),
      }),
      SELF.fetch("http://example.com/api/v1/saved-searches/legacy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Legacy" }),
      }),
      SELF.fetch("http://example.com/api/v1/saved-searches/legacy", {
        method: "DELETE",
      }),
    ]);

    for (const response of legacyRequests) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "The requested API route does not exist.",
        },
      });
    }

    const reloaded = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reloaded.views).toHaveLength(1);
    expect(reloaded.views[0]?.name).toBe("Open planning Tasks");
  });

  it("leaves Tag-name View conditions unchanged on rename and merge", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tags (name) VALUES ('source')"),
      env.DB.prepare("INSERT INTO tags (name) VALUES ('target')"),
    ]);
    const [sourceId] = await tagIdsFor(["source", "target"]);
    const created = await createView({
      ...baseView,
      name: "Merged Tags",
      allTasks: false,
      conditions: [
        {
          field: "tag",
          operator: "containsAll",
          value: ["source", "target"],
        },
      ],
    });
    const original = bootstrapResponseSchema.parse(await created.json())
      .views[0];
    if (!original) throw new Error("Tag View was not created");

    const renamed = await SELF.fetch(
      `http://example.com/api/v1/tags/${sourceId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "renamed" }),
      },
    );
    expect(renamed.status).toBe(200);
    expect(
      bootstrapResponseSchema.parse(await renamed.json()).views[0],
    ).toMatchObject({
      conditions: original.conditions,
      version: original.version,
      updatedAt: original.updatedAt,
    });

    const merged = await SELF.fetch(
      `http://example.com/api/v1/tags/${sourceId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "target" }),
      },
    );
    expect(merged.status).toBe(200);
    const mergedView = bootstrapResponseSchema.parse(await merged.json())
      .views[0];
    expect(mergedView).toEqual(original);

    const reloaded = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reloaded.views[0]).toEqual(mergedView);
  });

  it("leaves Tag-name View conditions unchanged when a Tag is deleted", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tags (name) VALUES ('deleted')"),
      env.DB.prepare("INSERT INTO tags (name) VALUES ('retained')"),
      insertTask({ id: "tag-cleanup-task", title: "Tag cleanup" }),
    ]);
    const [deletedId] = await tagIdsFor(["deleted", "retained"]);
    await env.DB.prepare(
      "INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)",
    )
      .bind("tag-cleanup-task", deletedId)
      .run();
    await createView({
      ...baseView,
      name: "Keep remaining conditions",
      allTasks: false,
      conditions: [
        {
          field: "tag",
          operator: "containsAll",
          value: ["deleted", "retained"],
        },
        { field: "status", operator: "is", value: "OPEN" },
      ],
    });
    await createView({
      ...baseView,
      name: "Become All Tasks",
      allTasks: false,
      conditions: [
        {
          field: "tag",
          operator: "containsAll",
          value: ["deleted"],
        },
      ],
    });

    const deleted = await SELF.fetch(
      `http://example.com/api/v1/tags/${deletedId}`,
      { method: "DELETE" },
    );

    expect(deleted.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await deleted.json());
    expect(
      snapshot.tasks.find((task) => task.id === "tag-cleanup-task")?.tags,
    ).toEqual([]);
    expect(
      snapshot.views.find((view) => view.name === "Keep remaining conditions"),
    ).toMatchObject({
      allTasks: false,
      conditions: [
        {
          field: "tag",
          operator: "containsAll",
          value: ["deleted", "retained"],
        },
        { field: "status", operator: "is", value: "OPEN" },
      ],
      version: 1,
    });
    expect(
      snapshot.views.find((view) => view.name === "Become All Tasks"),
    ).toMatchObject({
      allTasks: false,
      conditions: [
        { field: "tag", operator: "containsAll", value: ["deleted"] },
      ],
      version: 1,
    });

    const reloaded = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reloaded.views).toEqual(snapshot.views);
  });

  it("does not update Views while deleting a Tag", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tags (name) VALUES ('atomic')"),
      insertTask({ id: "atomic-tag-task", title: "Atomic Tag cleanup" }),
    ]);
    const [tagId] = await tagIdsFor(["atomic"]);
    await env.DB.prepare(
      "INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)",
    )
      .bind("atomic-tag-task", tagId)
      .run();
    const created = await createView({
      ...baseView,
      name: "Atomic Tag View",
      allTasks: false,
      conditions: [
        { field: "tag", operator: "containsAll", value: ["atomic"] },
      ],
    });
    const originalView = bootstrapResponseSchema.parse(await created.json())
      .views[0];
    await env.DB.prepare(
      `CREATE TRIGGER fail_view_reference_update
       BEFORE UPDATE ON views
       BEGIN
         SELECT RAISE(ABORT, 'forced View update failure');
       END`,
    ).run();

    const deleted = await SELF.fetch(
      `http://example.com/api/v1/tags/${tagId}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    await env.DB.prepare("DROP TRIGGER fail_view_reference_update").run();

    const snapshot = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(snapshot.tags).not.toContainEqual({ id: tagId, name: "atomic" });
    expect(
      snapshot.tasks.find((task) => task.id === "atomic-tag-task")?.tags,
    ).toEqual([]);
    expect(snapshot.views[0]).toEqual(originalView);
  });

  it("stores Area names and keeps the View independent from Area lifecycle", async () => {
    const createdArea = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Referenced Area", color: "gray" }),
    });
    const area = bootstrapResponseSchema
      .parse(await createdArea.json())
      .areas.find((candidate) => candidate.name === "Referenced Area");
    if (!area) throw new Error("Referenced Area was not created");
    const createdView = await createView({
      ...baseView,
      name: "Referenced Area View",
      allTasks: false,
      conditions: [
        {
          field: "area",
          operator: "isAnyOf",
          value: [" Referenced Area ", "Future Area"],
        },
      ],
    });
    const view = bootstrapResponseSchema.parse(await createdView.json())
      .views[0];
    if (!view) throw new Error("Referenced Area View was not created");
    expect(view.conditions).toEqual([
      {
        field: "area",
        operator: "isAnyOf",
        value: ["Referenced Area", "Future Area"],
      },
    ]);

    const renamed = await SELF.fetch(
      `http://example.com/api/v1/areas/${area.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed Area", color: "gray" }),
      },
    );
    expect(renamed.status).toBe(200);
    expect(
      bootstrapResponseSchema
        .parse(await renamed.json())
        .views.find((candidate) => candidate.id === view.id),
    ).toEqual(view);

    const renamedTask = await env.DB.prepare(
      "INSERT INTO tasks (id, title, description, work_notes, status, area_id, parent_task_id, start, due, completed_at, created_at, updated_at, version) VALUES (?, ?, '', '', 'OPEN', ?, NULL, NULL, NULL, NULL, ?, ?, 1)",
    )
      .bind(
        "renamed-area-task",
        "Renamed Area task",
        area.id,
        "2026-08-15T00:00:00.000Z",
        "2026-08-15T00:00:00.000Z",
      )
      .run();
    expect(renamedTask.success).toBe(true);
    const renamedResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(`http://example.com/api/v1/views/${view.id}/tasks`)
      ).json(),
    );
    expect(renamedResult.tasks).toEqual([]);
    await env.DB.prepare("DELETE FROM tasks WHERE id = ?")
      .bind("renamed-area-task")
      .run();

    const renamedBack = await SELF.fetch(
      `http://example.com/api/v1/areas/${area.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Referenced Area", color: "gray" }),
      },
    );
    expect(renamedBack.status).toBe(200);

    const trashed = await SELF.fetch(
      `http://example.com/api/v1/areas/${area.id}`,
      { method: "DELETE" },
    );
    expect(trashed.status).toBe(200);
    expect(
      bootstrapResponseSchema.parse(await trashed.json()).views[0],
    ).toEqual(view);
    await env.DB.batch([
      insertTask({
        id: "trashed-area-task",
        title: "Task in trashed Area",
        areaId: area.id,
      }),
    ]);

    const hiddenResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(`http://example.com/api/v1/views/${view.id}/tasks`)
      ).json(),
    );
    expect(hiddenResult.tasks).toEqual([]);

    const restored = await SELF.fetch(
      `http://example.com/api/v1/areas/${area.id}/restore`,
      { method: "POST" },
    );
    expect(restored.status).toBe(200);
    expect(
      bootstrapResponseSchema.parse(await restored.json()).views[0],
    ).toEqual(view);
    const restoredResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(`http://example.com/api/v1/views/${view.id}/tasks`)
      ).json(),
    );
    expect(restoredResult.tasks.map((task) => task.id)).toEqual([
      "trashed-area-task",
    ]);
  });

  it("persists custom sort and columns and applies the saved sort to results", async () => {
    await env.DB.batch([
      insertTask({
        id: "custom-sort-zulu",
        title: "Zulu result",
        updatedAt: "2026-08-15T02:00:00.000Z",
      }),
      insertTask({
        id: "custom-sort-alpha",
        title: "Alpha result",
        updatedAt: "2026-08-15T01:00:00.000Z",
      }),
    ]);

    const created = await createView({
      ...baseView,
      name: "Custom result View",
      sort: [{ field: "title", direction: "asc" }],
      columns: ["title", "description"],
    });

    expect(created.status).toBe(201);
    const snapshot = bootstrapResponseSchema.parse(await created.json());
    const view = snapshot.views[0];
    if (!view) throw new Error("View was not created");
    expect(view).toMatchObject({
      sort: [{ field: "title", direction: "asc" }],
      columns: ["title", "description"],
    });

    const result = await SELF.fetch(
      `http://example.com/api/v1/views/${view.id}/tasks`,
    );
    expect(result.status).toBe(200);
    expect(
      taskSearchResponseSchema
        .parse(await result.json())
        .tasks.map((task) => task.id),
    ).toEqual(["custom-sort-alpha", "custom-sort-zulu"]);
  });

  it("keeps null values last across stable 100-item pages for multi-sort Views", async () => {
    await env.DB.batch(
      Array.from({ length: 100 }, (_, index) => {
        const number = String(index + 1).padStart(3, "0");
        return insertTask({
          id: `multi-sort-${number}`,
          title: `Sorted ${number}`,
          start: "2026-08-15",
          updatedAt: viewResultTimestamp(index + 1),
        });
      }),
    );
    await env.DB.batch([
      insertTask({
        id: "multi-sort-null-zulu",
        title: "Null zulu",
        start: null,
      }),
      insertTask({
        id: "multi-sort-null-alpha",
        title: "Null alpha",
        start: null,
      }),
    ]);

    const created = await createView({
      ...baseView,
      name: "Multi-sort View",
      sort: [
        { field: "start", direction: "asc" },
        { field: "title", direction: "desc" },
      ],
    });
    const view = bootstrapResponseSchema.parse(await created.json()).views[0];
    if (!view) throw new Error("View was not created");

    const firstPage = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(`http://example.com/api/v1/views/${view.id}/tasks`)
      ).json(),
    );
    expect(firstPage.tasks).toHaveLength(100);
    expect(firstPage.nextCursor).toBe("100");
    expect(firstPage.tasks.every((task) => task.start !== null)).toBe(true);
    expect(firstPage.tasks[0]?.title).toBe("Sorted 100");
    expect(firstPage.tasks.at(-1)?.title).toBe("Sorted 001");

    const secondPage = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(
          `http://example.com/api/v1/views/${view.id}/tasks?cursor=${firstPage.nextCursor}`,
        )
      ).json(),
    );
    expect(secondPage.tasks.map((task) => task.title)).toEqual([
      "Null zulu",
      "Null alpha",
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("rejects invalid View sort and column definitions", async () => {
    const duplicateSort = await createView({
      ...baseView,
      name: "Duplicate sort View",
      sort: [
        { field: "title", direction: "asc" },
        { field: "title", direction: "desc" },
      ],
    });
    expect(duplicateSort.status).toBe(400);

    const duplicateColumns = await createView({
      ...baseView,
      name: "Duplicate columns View",
      columns: ["title", "title"],
    });
    expect(duplicateColumns.status).toBe(400);

    const titleNotFirst = await createView({
      ...baseView,
      name: "Title not first View",
      columns: ["updated", "title"],
    });
    expect(titleNotFirst.status).toBe(400);
  });

  it("rejects case-insensitive duplicate names and keeps bootstrap sorted", async () => {
    await createView({ ...baseView, name: "Zulu Tasks" });
    const second = await createView({ ...baseView, name: "alpha Tasks" });
    expect(second.status).toBe(201);

    const duplicate = await createView({
      ...baseView,
      name: "  ZULU TASKS ",
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "VIEW_NAME_CONFLICT" },
    });

    const snapshot = bootstrapResponseSchema.parse(await second.json());
    expect(snapshot.views.map((view) => view.name)).toEqual([
      "alpha Tasks",
      "Zulu Tasks",
    ]);
  });

  it("updates only the matching version and rejects stale definitions", async () => {
    const created = await createView(baseView);
    const createdView = bootstrapResponseSchema.parse(await created.json())
      .views[0];
    if (!createdView) throw new Error("View was not created");

    const updated = await SELF.fetch(
      `http://example.com/api/v1/views/${createdView.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...baseView,
          name: "Completed review",
          version: createdView.version,
        }),
      },
    );
    expect(updated.status).toBe(200);
    const updatedView = bootstrapResponseSchema.parse(await updated.json())
      .views[0];
    expect(updatedView).toMatchObject({
      id: createdView.id,
      name: "Completed review",
      version: 2,
    });

    const stale = await SELF.fetch(
      `http://example.com/api/v1/views/${createdView.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...baseView,
          name: "Stale overwrite",
          version: createdView.version,
        }),
      },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: { code: "VIEW_VERSION_CONFLICT" },
    });

    const latest = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(latest.views[0]).toMatchObject({
      name: "Completed review",
      version: 2,
    });

    const missing = await SELF.fetch(
      "http://example.com/api/v1/views/missing-view",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...baseView,
          name: "Missing View",
          version: 1,
        }),
      },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "VIEW_NOT_FOUND" },
    });
  });

  it("requires an explicit All Tasks definition for the first View slice", async () => {
    const missingSelection = await createView({
      name: "Unselected View",
      allTasks: false,
    });
    expect(missingSelection.status).toBe(400);

    const withConditions = await createView({
      name: "Conditional All Tasks",
      allTasks: true,
      conditions: [{ status: "OPEN" }],
    });
    expect(withConditions.status).toBe(400);
  });

  it("deletes only the selected View and leaves Task data unchanged", async () => {
    const task = await createTask();
    const before = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const created = await createView(baseView);
    const createdView = bootstrapResponseSchema.parse(await created.json())
      .views[0];
    if (!createdView) throw new Error("View was not created");

    const deleted = await SELF.fetch(
      `http://example.com/api/v1/views/${createdView.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    const after = bootstrapResponseSchema.parse(await deleted.json());
    expect(after.views).toEqual([]);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.tasks).toContainEqual(task);

    const missing = await SELF.fetch(
      `http://example.com/api/v1/views/${createdView.id}`,
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "VIEW_NOT_FOUND" },
    });
  });

  it("returns saved All Tasks results with stable pagination and ignores client filters", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => {
      const taskNumber = index + 1;
      return insertTask({
        id: `view-result-${taskNumber}`,
        title: `View result ${taskNumber}`,
        status: taskNumber % 2 === 0 ? "COMPLETED" : "OPEN",
        updatedAt: viewResultTimestamp(taskNumber),
      });
    });
    rows.push(
      insertTask({
        id: "view-result-inbox",
        title: "View result Inbox",
        areaId: 9,
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
      insertTask({
        id: "view-result-trash",
        title: "View result Trash",
        trashedAt: "2026-08-15T02:00:00.000Z",
        updatedAt: "2026-08-15T02:00:00.000Z",
      }),
    );
    await env.DB.batch(rows);

    const created = await createView(baseView);
    const view = bootstrapResponseSchema.parse(await created.json()).views[0];
    if (!view) throw new Error("View was not created");

    const firstPage = await SELF.fetch(
      `http://example.com/api/v1/views/${view.id}/tasks?status=OPEN`,
    );
    expect(firstPage.status).toBe(200);
    const firstResult = taskSearchResponseSchema.parse(await firstPage.json());
    expect(firstResult.tasks).toHaveLength(100);
    expect(firstResult.nextCursor).toBe("100");
    expect(firstResult.tasks[0]).toMatchObject({
      title: "View result 100",
      status: "COMPLETED",
    });
    expect(
      firstResult.tasks.some((task) => task.title === "View result Trash"),
    ).toBe(false);
    expect(firstResult.tasks.some((task) => task.status === "COMPLETED")).toBe(
      true,
    );

    const secondPage = await SELF.fetch(
      `http://example.com/api/v1/views/${view.id}/tasks?cursor=${firstResult.nextCursor}`,
    );
    const secondResult = taskSearchResponseSchema.parse(
      await secondPage.json(),
    );
    expect(secondResult.tasks).toHaveLength(1);
    expect(secondResult.tasks[0]).toMatchObject({
      title: "View result Inbox",
      areaId: 9,
    });
    expect(secondResult.nextCursor).toBeNull();

    const missing = await SELF.fetch(
      "http://example.com/api/v1/views/missing-view/tasks",
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "VIEW_NOT_FOUND" },
    });
  });

  it("persists conditional definitions in order and applies every condition with literal text matching", async () => {
    await seedViewTask({
      id: "conditional-match",
      title: "Alpha 100% _ build",
      description: "Plan the release",
      workNotes: "Ship the release",
      start: "2026-08-10",
      due: null,
      tags: ["alpha", "beta"],
    });
    await seedViewTask({
      id: "conditional-title-only",
      title: "Alpha 100% _ build",
      description: "A different description",
      workNotes: "Ship the release",
      start: "2026-08-10",
      due: null,
      tags: ["alpha", "beta"],
    });
    await seedViewTask({
      id: "conditional-wildcard-only",
      title: "Alpha 1000 X build",
      description: "Plan the release",
      workNotes: "Ship the release",
      start: "2026-08-10",
      due: null,
      tags: ["alpha", "beta"],
    });
    const created = await createView({
      name: "  Conditional planning  ",
      allTasks: false,
      conditions: [
        { field: "title", operator: "contains", value: " Alpha 100% _ " },
        { field: "description", operator: "contains", value: " plan " },
        { field: "workNotes", operator: "contains", value: " RELEASE " },
        {
          field: "start",
          operator: "between",
          value: { from: "2026-08-10", to: "2026-08-10" },
        },
        { field: "due", operator: "isUnset", value: null },
        { field: "status", operator: "is", value: "OPEN" },
        { field: "area", operator: "isAnyOf", value: ["Develop", "Inbox"] },
        {
          field: "tag",
          operator: "containsAll",
          value: ["alpha", "beta"],
        },
      ],
    });

    expect(created.status).toBe(201);
    const snapshot = bootstrapResponseSchema.parse(await created.json());
    const view = snapshot.views[0];
    if (!view) throw new Error("Conditional View was not created");
    expect(view).toMatchObject({
      name: "Conditional planning",
      allTasks: false,
      conditions: [
        { field: "title", operator: "contains", value: "Alpha 100% _" },
        { field: "description", operator: "contains", value: "plan" },
        { field: "workNotes", operator: "contains", value: "RELEASE" },
        {
          field: "start",
          operator: "between",
          value: { from: "2026-08-10", to: "2026-08-10" },
        },
        { field: "due", operator: "isUnset", value: null },
        { field: "status", operator: "is", value: "OPEN" },
        { field: "area", operator: "isAnyOf", value: ["Develop", "Inbox"] },
        {
          field: "tag",
          operator: "containsAll",
          value: ["alpha", "beta"],
        },
      ],
    });

    const result = await SELF.fetch(
      `http://example.com/api/v1/views/${view.id}/tasks`,
    );
    expect(result.status).toBe(200);
    expect(
      taskSearchResponseSchema
        .parse(await result.json())
        .tasks.map((task) => task.id),
    ).toEqual(["conditional-match"]);
  });

  it("matches Area condition names exactly and ORs multiple names", async () => {
    await seedViewTask({
      id: "area-develop-match",
      title: "Develop Area match",
      areaId: workerAreaIds.develop,
    });
    await seedViewTask({
      id: "area-inbox-match",
      title: "Inbox Area match",
      areaId: workerAreaIds.inbox,
    });
    await seedViewTask({
      id: "area-music-no-match",
      title: "Music Area no match",
      areaId: workerAreaIds.music,
    });

    const created = await createView({
      name: "Area name matching",
      allTasks: false,
      conditions: [
        { field: "area", operator: "isAnyOf", value: ["Develop", "Inbox"] },
      ],
    });
    expect(created.status).toBe(201);
    const view = bootstrapResponseSchema.parse(await created.json()).views[0];
    if (!view) throw new Error("Area name View was not created");

    const result = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(`http://example.com/api/v1/views/${view.id}/tasks`)
      ).json(),
    );
    expect(result.tasks.map((task) => task.id)).toEqual([
      "area-develop-match",
      "area-inbox-match",
    ]);

    const caseMismatch = await createView({
      name: "Case-sensitive Area name matching",
      allTasks: false,
      conditions: [{ field: "area", operator: "isAnyOf", value: ["develop"] }],
    });
    expect(caseMismatch.status).toBe(201);
    const mismatchView = bootstrapResponseSchema
      .parse(await caseMismatch.json())
      .views.find(
        (candidate) => candidate.name === "Case-sensitive Area name matching",
      );
    if (!mismatchView) throw new Error("Case-sensitive View was not created");
    const mismatchResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(
          `http://example.com/api/v1/views/${mismatchView.id}/tasks`,
        )
      ).json(),
    );
    expect(mismatchResult.tasks).toEqual([]);
  });

  it("stores Tag names and evaluates Contains all and Contains none", async () => {
    await seedViewTask({
      id: "tag-all-match",
      title: "All Tag match",
      tags: ["alpha", "beta"],
    });
    await seedViewTask({
      id: "tag-partial-match",
      title: "Partial Tag match",
      tags: ["alpha"],
    });
    await seedViewTask({
      id: "tag-without-tags",
      title: "No Tag match",
    });

    const allResponse = await createView({
      ...baseView,
      name: "All Tag names",
      allTasks: false,
      conditions: [
        {
          field: "tag",
          operator: "containsAll",
          value: [" Alpha ", "alpha", "BETA"],
        },
      ],
    });
    expect(allResponse.status).toBe(201);
    const allSnapshot = bootstrapResponseSchema.parse(await allResponse.json());
    const allView = allSnapshot.views.find(
      (view) => view.name === "All Tag names",
    );
    if (!allView) throw new Error("All Tag View was not created");
    expect(allView.conditions).toEqual([
      { field: "tag", operator: "containsAll", value: ["alpha", "beta"] },
    ]);
    const allResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(`http://example.com/api/v1/views/${allView.id}/tasks`)
      ).json(),
    );
    expect(allResult.tasks.map((task) => task.id)).toEqual(["tag-all-match"]);

    const noneResponse = await createView({
      ...baseView,
      name: "No beta or future tags",
      allTasks: false,
      conditions: [
        {
          field: "tag",
          operator: "containsNone",
          value: [" beta ", "future"],
        },
      ],
    });
    expect(noneResponse.status).toBe(201);
    const noneView = bootstrapResponseSchema
      .parse(await noneResponse.json())
      .views.find((view) => view.name === "No beta or future tags");
    if (!noneView) throw new Error("Contains none View was not created");
    const noneResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(`http://example.com/api/v1/views/${noneView.id}/tasks`)
      ).json(),
    );
    expect(noneResult.tasks.map((task) => task.id)).toEqual([
      "tag-partial-match",
      "tag-without-tags",
    ]);

    const futureResponse = await createView({
      ...baseView,
      name: "Future Tag",
      allTasks: false,
      conditions: [
        { field: "tag", operator: "containsAll", value: ["future"] },
      ],
    });
    expect(futureResponse.status).toBe(201);
    const futureView = bootstrapResponseSchema
      .parse(await futureResponse.json())
      .views.find((view) => view.name === "Future Tag");
    if (!futureView) throw new Error("Future Tag View was not created");
    const futureResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(
          `http://example.com/api/v1/views/${futureView.id}/tasks`,
        )
      ).json(),
    );
    expect(futureResult.tasks).toEqual([]);

    const legacyIdResponse = await createView({
      ...baseView,
      name: "Legacy Tag ID",
      allTasks: false,
      conditions: [{ field: "tag", operator: "containsAll", value: [1] }],
    });
    expect(legacyIdResponse.status).toBe(400);

    const [alphaId] = await tagIdsFor(["alpha"]);
    const commaRename = await SELF.fetch(
      `http://example.com/api/v1/tags/${alphaId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "alpha,beta" }),
      },
    );
    expect(commaRename.status).toBe(400);

    const commaCreate = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Comma Tag",
        areaId: 2,
        parentId: null,
        start: null,
        due: null,
        description: "",
        tagIds: [],
        newTagNames: ["alpha,beta"],
      }),
    });
    expect(commaCreate.status).toBe(400);
  });

  it("evaluates every date operator by the Owner calendar day", async () => {
    await seedViewTask({
      id: "date-aug-09",
      title: "August 9",
      start: "2026-08-09T14:59:59.000Z",
    });
    await seedViewTask({
      id: "date-aug-10-timestamp",
      title: "August 10 timestamp",
      start: "2026-08-09T15:00:00.000Z",
    });
    await seedViewTask({
      id: "date-aug-10-date-only",
      title: "August 10 date only",
      start: "2026-08-10",
    });
    await seedViewTask({
      id: "date-aug-11",
      title: "August 11",
      start: "2026-08-10T15:00:00.000Z",
    });
    await seedViewTask({
      id: "date-unset",
      title: "Date unset",
    });
    const cases = [
      ["equals", ["date-aug-10-date-only", "date-aug-10-timestamp"]],
      ["before", ["date-aug-09"]],
      ["after", ["date-aug-11"]],
      [
        "onOrBefore",
        ["date-aug-09", "date-aug-10-date-only", "date-aug-10-timestamp"],
      ],
      [
        "onOrAfter",
        ["date-aug-10-date-only", "date-aug-10-timestamp", "date-aug-11"],
      ],
      ["between", ["date-aug-10-date-only", "date-aug-10-timestamp"]],
      ["isUnset", ["date-unset"]],
    ] as const;

    for (const [operator, expectedIds] of cases) {
      const value =
        operator === "between"
          ? { from: "2026-08-10", to: "2026-08-10" }
          : operator === "isUnset"
            ? null
            : "2026-08-10";
      const response = await createView({
        name: `Start ${operator}`,
        allTasks: false,
        conditions: [{ field: "start", operator, value }],
      });
      expect(response.status).toBe(201);
      const view = bootstrapResponseSchema
        .parse(await response.json())
        .views.find((candidate) => candidate.name === `Start ${operator}`);
      if (!view) throw new Error(`View was not created for ${operator}`);
      const result = taskSearchResponseSchema.parse(
        await (
          await SELF.fetch(`http://example.com/api/v1/views/${view.id}/tasks`)
        ).json(),
      );
      expect(result.tasks.map((task) => task.id)).toEqual(expectedIds);
    }

    const combinedResponse = await createView({
      name: "Combined Start dates",
      allTasks: false,
      conditions: [
        { field: "start", operator: "onOrAfter", value: "2026-08-10" },
        { field: "start", operator: "before", value: "2026-08-12" },
      ],
    });
    expect(combinedResponse.status).toBe(201);
    const combinedView = bootstrapResponseSchema
      .parse(await combinedResponse.json())
      .views.find((candidate) => candidate.name === "Combined Start dates");
    if (!combinedView) throw new Error("Combined date View was not created");
    const combinedResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(
          `http://example.com/api/v1/views/${combinedView.id}/tasks`,
        )
      ).json(),
    );
    expect(combinedResult.tasks.map((task) => task.id)).toEqual([
      "date-aug-10-date-only",
      "date-aug-10-timestamp",
      "date-aug-11",
    ]);
  });

  it("evaluates Due operators and re-evaluates timestamp dates after a timezone change", async () => {
    await seedViewTask({
      id: "due-aug-09",
      title: "Due August 9",
      due: "2026-08-09T14:59:59.000Z",
    });
    await seedViewTask({
      id: "due-aug-10-timestamp",
      title: "Due August 10 timestamp",
      due: "2026-08-09T15:00:00.000Z",
    });
    await seedViewTask({
      id: "due-aug-10-date-only",
      title: "Due August 10 date only",
      due: "2026-08-10",
    });
    await seedViewTask({
      id: "due-aug-11",
      title: "Due August 11",
      due: "2026-08-10T15:00:00.000Z",
    });
    await seedViewTask({
      id: "due-unset",
      title: "Due unset",
    });

    const dueCases = [
      ["equals", ["due-aug-10-date-only", "due-aug-10-timestamp"]],
      ["before", ["due-aug-09"]],
      ["after", ["due-aug-11"]],
      [
        "onOrBefore",
        ["due-aug-09", "due-aug-10-date-only", "due-aug-10-timestamp"],
      ],
      [
        "onOrAfter",
        ["due-aug-10-date-only", "due-aug-10-timestamp", "due-aug-11"],
      ],
      ["between", ["due-aug-10-date-only", "due-aug-10-timestamp"]],
      ["isUnset", ["due-unset"]],
    ] as const;

    for (const [operator, expectedIds] of dueCases) {
      const value =
        operator === "between"
          ? { from: "2026-08-10", to: "2026-08-10" }
          : operator === "isUnset"
            ? null
            : "2026-08-10";
      const response = await createView({
        name: `Due ${operator}`,
        allTasks: false,
        conditions: [{ field: "due", operator, value }],
      });
      expect(response.status).toBe(201);
      const view = bootstrapResponseSchema
        .parse(await response.json())
        .views.find((candidate) => candidate.name === `Due ${operator}`);
      if (!view) throw new Error(`View was not created for Due ${operator}`);
      const result = taskSearchResponseSchema.parse(
        await (
          await SELF.fetch(`http://example.com/api/v1/views/${view.id}/tasks`)
        ).json(),
      );
      expect(result.tasks.map((task) => task.id)).toEqual(expectedIds);
    }

    await seedViewTask({
      id: "due-timezone-boundary",
      title: "Due timezone boundary",
      due: "2026-08-10T06:59:59.000Z",
    });
    const timezoneViewResponse = await createView({
      name: "Due timezone re-evaluation",
      allTasks: false,
      conditions: [{ field: "due", operator: "equals", value: "2026-08-10" }],
    });
    expect(timezoneViewResponse.status).toBe(201);
    const timezoneView = bootstrapResponseSchema
      .parse(await timezoneViewResponse.json())
      .views.find(
        (candidate) => candidate.name === "Due timezone re-evaluation",
      );
    if (!timezoneView) throw new Error("Timezone View was not created");
    const tokyoResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(
          `http://example.com/api/v1/views/${timezoneView.id}/tasks`,
        )
      ).json(),
    );
    expect(tokyoResult.tasks.map((task) => task.id)).toEqual([
      "due-aug-10-date-only",
      "due-aug-10-timestamp",
      "due-timezone-boundary",
    ]);

    await env.DB.prepare("UPDATE owner_settings SET time_zone = ? WHERE id = 1")
      .bind("America/Los_Angeles")
      .run();
    try {
      const pacificResult = taskSearchResponseSchema.parse(
        await (
          await SELF.fetch(
            `http://example.com/api/v1/views/${timezoneView.id}/tasks`,
          )
        ).json(),
      );
      expect(pacificResult.tasks.map((task) => task.id)).toEqual([
        "due-aug-10-date-only",
        "due-aug-11",
      ]);

      const pacificDateViewResponse = await createView({
        name: "Due Pacific August 9",
        allTasks: false,
        conditions: [{ field: "due", operator: "equals", value: "2026-08-09" }],
      });
      expect(pacificDateViewResponse.status).toBe(201);
      const pacificDateView = bootstrapResponseSchema
        .parse(await pacificDateViewResponse.json())
        .views.find((candidate) => candidate.name === "Due Pacific August 9");
      if (!pacificDateView)
        throw new Error("Pacific date View was not created");
      const pacificDateResult = taskSearchResponseSchema.parse(
        await (
          await SELF.fetch(
            `http://example.com/api/v1/views/${pacificDateView.id}/tasks`,
          )
        ).json(),
      );
      expect(pacificDateResult.tasks.map((task) => task.id)).toEqual([
        "due-aug-09",
        "due-aug-10-timestamp",
        "due-timezone-boundary",
      ]);
    } finally {
      await env.DB.prepare(
        "UPDATE owner_settings SET time_zone = ? WHERE id = 1",
      )
        .bind("Asia/Tokyo")
        .run();
    }
  });

  it("rejects incomplete, duplicate, reversed, and unknown View conditions", async () => {
    const empty = await createView({
      name: "Empty conditional View",
      allTasks: false,
      conditions: [],
    });
    expect(empty.status).toBe(400);

    const duplicate = await createView({
      name: "Duplicate conditional View",
      allTasks: false,
      conditions: [
        { field: "title", operator: "contains", value: "one" },
        { field: "title", operator: "contains", value: "two" },
      ],
    });
    expect(duplicate.status).toBe(400);

    const reversed = await createView({
      name: "Reversed conditional View",
      allTasks: false,
      conditions: [
        {
          field: "due",
          operator: "between",
          value: { from: "2026-08-11", to: "2026-08-10" },
        },
      ],
    });
    expect(reversed.status).toBe(400);

    const incompleteSingle = await createView({
      name: "Incomplete single date View",
      allTasks: false,
      conditions: [{ field: "start", operator: "equals", value: "" }],
    });
    expect(incompleteSingle.status).toBe(400);

    const incompleteRange = await createView({
      name: "Incomplete date range View",
      allTasks: false,
      conditions: [
        {
          field: "due",
          operator: "between",
          value: { from: "2026-08-10", to: "" },
        },
      ],
    });
    expect(incompleteRange.status).toBe(400);

    const timestampValue = await createView({
      name: "Timestamp date condition View",
      allTasks: false,
      conditions: [
        {
          field: "start",
          operator: "equals",
          value: "2026-08-10T00:00:00.000Z",
        },
      ],
    });
    expect(timestampValue.status).toBe(400);

    const unregisteredName = await createView({
      name: "Unregistered Area View",
      allTasks: false,
      conditions: [
        { field: "area", operator: "isAnyOf", value: ["Future Area"] },
      ],
    });
    expect(unregisteredName.status).toBe(201);

    const legacyReference = await createView({
      name: "Legacy Area ID View",
      allTasks: false,
      conditions: [{ field: "area", operator: "isAnyOf", value: [9999] }],
    });
    expect(legacyReference.status).toBe(400);
  });
});

async function createView(input: unknown) {
  return SELF.fetch("http://example.com/api/v1/views", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function createTask() {
  const response = await SELF.fetch("http://example.com/api/v1/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Task retained after View deletion",
      areaId: 2,
      parentId: null,
      start: null,
      due: null,
      tagIds: [],
      newTagNames: [],
      description: "",
    }),
  });
  expect(response.status).toBe(201);
  const snapshot = bootstrapResponseSchema.parse(await response.json());
  const task = snapshot.tasks.find(
    (candidate) => candidate.title === "Task retained after View deletion",
  );
  if (!task) throw new Error("Task was not created");
  return task;
}

async function seedViewTask({
  tags = [],
  ...input
}: Parameters<typeof insertTask>[0] & { tags?: string[] }) {
  await env.DB.batch([insertTask(input)]);
  for (const tag of tags) {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").bind(tag),
      env.DB.prepare(
        `INSERT INTO task_tags (task_id, tag_id)
         SELECT ?, id FROM tags WHERE name = ?`,
      ).bind(input.id, tag),
    ]);
  }
}

async function tagIdsFor(names: string[]) {
  const result = await env.DB.prepare(
    `SELECT id, name FROM tags WHERE name IN (${names.map(() => "?").join(", ")})`,
  )
    .bind(...names)
    .all<{ id: number; name: string }>();
  const tags = new Map(result.results.map((tag) => [tag.name, tag.id]));
  return names.map((name) => {
    const id = tags.get(name);
    if (!id) throw new Error(`Tag fixture was not created: ${name}`);
    return id;
  });
}

function insertTask({
  id,
  title,
  description = "",
  workNotes = "",
  areaId = 2,
  status = "OPEN",
  start = null,
  due = null,
  trashedAt = null,
  updatedAt,
}: {
  id: string;
  title: string;
  description?: string;
  workNotes?: string;
  areaId?: number;
  status?: "OPEN" | "COMPLETED";
  start?: string | null;
  due?: string | null;
  trashedAt?: string | null;
  updatedAt?: string;
}) {
  const timestamp = updatedAt ?? "2026-08-15T00:00:00.000Z";
  return env.DB.prepare(
    `INSERT INTO tasks
       (id, title, description, work_notes, status, area_id, parent_task_id,
        start, due, completed_at, trashed_at, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)`,
  ).bind(
    id,
    title,
    description,
    workNotes,
    status,
    areaId,
    start,
    due,
    status === "COMPLETED" ? timestamp : null,
    trashedAt,
    timestamp,
    timestamp,
  );
}

function viewResultTimestamp(taskNumber: number) {
  const totalMinutes = taskNumber;
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `2026-08-15T${hours}:${minutes}:00.000Z`;
}
