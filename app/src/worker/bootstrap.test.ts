import {
  applyD1Migrations,
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapResponseSchema,
  taskSearchResponseSchema,
  titleSearchResponseSchema,
} from "../shared/api-schema";
import worker from "./index";
import { ownerAreaFixtures, workerAreaIds } from "./test/area-fixtures";
import { d1Migrations } from "./test/d1-migrations";

describe("Inbox system migration", () => {
  it("moves legacy Inbox Tasks into the system-managed Area without losing related orders", async () => {
    const inboxMigration = d1Migrations.find(
      (migration) => migration.name === "0009_add_system_managed_inbox.sql",
    );
    if (!inboxMigration) {
      throw new Error("Inbox system migration is not registered");
    }

    await applyD1Migrations(
      env.DB,
      d1Migrations.filter(
        (migration) => migration.name !== inboxMigration.name,
      ),
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tasks (
            id, title, description, work_notes, status, area_id, parent_task_id,
            start, due, completed_at, trashed_at, created_at, updated_at
          ) VALUES (?, ?, '', '', 'OPEN', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      ).bind(
        "legacy-inbox-task",
        "Legacy Inbox Task",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      ),
      env.DB.prepare("INSERT INTO tags (name) VALUES ('legacy')"),
      env.DB.prepare(
        `INSERT INTO task_tags (task_id, tag_id)
           SELECT ?, id FROM tags WHERE name = ?`,
      ).bind("legacy-inbox-task", "legacy"),
      env.DB.prepare(
        "INSERT INTO task_manual_orders (group_key, task_id, position) VALUES ('inbox', ?, 1)",
      ).bind("legacy-inbox-task"),
      env.DB.prepare(
        "INSERT INTO today_task_orders (owner_date, task_id, position) VALUES ('2026-08-01', ?, 1)",
      ).bind("legacy-inbox-task"),
    ]);

    await applyD1Migrations(env.DB, [inboxMigration]);

    const response = await SELF.fetch("http://example.com/api/v1/bootstrap");
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    const inbox = snapshot.areas.find((area) => area.isSystemManaged);

    expect(inbox).toMatchObject({
      name: "Inbox",
      isSystemManaged: true,
      trashedAt: null,
    });
    expect(snapshot.areas.filter((area) => !area.isSystemManaged)).toHaveLength(
      0,
    );
    expect(snapshot.tasks).toContainEqual(
      expect.objectContaining({
        id: "legacy-inbox-task",
        areaId: inbox?.id,
        path: ["Inbox", "Legacy Inbox Task"],
        tags: [
          expect.objectContaining({ id: expect.any(Number), name: "legacy" }),
        ],
      }),
    );
    expect(snapshot.inboxOrder).toEqual(["legacy-inbox-task"]);
    expect(snapshot.todayOrders).toEqual({
      "2026-08-01": ["legacy-inbox-task"],
    });
  });
});

describe("Display language migration", () => {
  it("backfills existing Owner settings with English", async () => {
    const displayLanguageMigration = d1Migrations.find(
      (migration) => migration.name === "0012_add_display_language.sql",
    );
    if (!displayLanguageMigration) {
      throw new Error("Display language migration is not registered");
    }

    await resetDatabaseToFreshMigrations();
    await applyD1Migrations(
      env.DB,
      d1Migrations.filter(
        (migration) => migration.name !== displayLanguageMigration.name,
      ),
    );
    await applyD1Migrations(env.DB, [displayLanguageMigration]);

    const settings = await env.DB.prepare(
      "SELECT display_language FROM owner_settings WHERE id = 1",
    ).first<{ display_language: string }>();
    expect(settings?.display_language).toBe("en");
  });
});

describe("GET /api/v1/bootstrap", () => {
  beforeEach(async () => {
    await resetDatabaseToFreshMigrations();
    await applyD1Migrations(env.DB, d1Migrations);
  });

  it("returns the initial D1 master data snapshot", async () => {
    const response = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());

    expect(snapshot).toMatchObject({
      ownerSettings: {
        displayLanguage: "en",
        timeZone: "Asia/Tokyo",
        weekStartsOn: 0,
        trashRetentionDays: 30,
        version: 1,
      },
      tasks: [],
      areaTaskOrders: {},
      inboxOrder: [],
      todayOrders: {},
    });
    expect(snapshot.areas).toEqual([
      expect.objectContaining({
        name: "Inbox",
        color: "gray",
        position: 0,
        isSystemManaged: true,
        trashedAt: null,
      }),
    ]);
  });

  it("creates an Owner-managed Area and keeps it after bootstrap reload", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Personal", color: "green" }),
    });

    expect(created.status).toBe(201);
    const createdSnapshot = bootstrapResponseSchema.parse(await created.json());
    expect(createdSnapshot.areas).toContainEqual(
      expect.objectContaining({
        name: "Personal",
        color: "green",
        position: 1,
        isSystemManaged: false,
        trashedAt: null,
      }),
    );

    const reloaded = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reloaded.json()).areas).toEqual(
      createdSnapshot.areas,
    );
  });

  it("preserves an existing Owner-managed Area when migrations are reapplied", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Existing", color: "blue" }),
    });
    expect(created.status).toBe(201);
    const before = bootstrapResponseSchema.parse(await created.json());

    await applyD1Migrations(env.DB, d1Migrations);

    const reloaded = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reloaded.json()).areas).toEqual(
      before.areas,
    );
  });
});

describe("Tag identity", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("keeps Tag IDs stable across Task edits, rename, merge, search, and delete", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Stable Tag Task",
        areaId: 1,
        description: "",
        start: null,
        due: null,
        newTagNames: ["Stable"],
      }),
    });
    expect(created.status).toBe(201);
    const createdSnapshot = bootstrapResponseSchema.parse(await created.json());
    const createdTask = createdSnapshot.tasks.find(
      (task) => task.title === "Stable Tag Task",
    );
    const stableTag = createdSnapshot.tags.find((tag) => tag.name === "stable");
    if (!createdTask || !stableTag) {
      throw new Error("Stable Tag fixture was not created");
    }
    expect(createdTask.tags).toEqual([stableTag]);

    const renamed = await SELF.fetch(
      `http://example.com/api/v1/tags/${stableTag.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      },
    );
    expect(renamed.status).toBe(200);
    const renamedSnapshot = bootstrapResponseSchema.parse(await renamed.json());
    const renamedTag = renamedSnapshot.tags.find(
      (tag) => tag.id === stableTag.id,
    );
    expect(renamedTag).toEqual({ id: stableTag.id, name: "renamed" });
    expect(
      renamedSnapshot.tasks.find((task) => task.id === createdTask.id)?.tags,
    ).toEqual([renamedTag]);

    const edited = await SELF.fetch(
      `http://example.com/api/v1/tasks/${createdTask.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: createdTask.title,
          description: createdTask.description,
          workNotes: createdTask.workNotes,
          start: createdTask.start,
          due: createdTask.due,
          tagIds: [stableTag.id],
          newTagNames: [],
          version: createdTask.version,
        }),
      },
    );
    expect(edited.status).toBe(200);
    const editedSnapshot = bootstrapResponseSchema.parse(await edited.json());
    const editedTask = editedSnapshot.tasks.find(
      (task) => task.id === createdTask.id,
    );
    if (!editedTask) throw new Error("Edited Tag Task was not returned");

    const targetCreated = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Target Tag Task",
        areaId: 1,
        description: "",
        start: null,
        due: null,
        newTagNames: ["Target"],
      }),
    });
    const targetSnapshot = bootstrapResponseSchema.parse(
      await targetCreated.json(),
    );
    const targetTag = targetSnapshot.tags.find((tag) => tag.name === "target");
    if (!targetTag) throw new Error("Target Tag fixture was not created");

    const taggedWithBoth = await SELF.fetch(
      `http://example.com/api/v1/tasks/${createdTask.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: editedTask.title,
          description: editedTask.description,
          workNotes: editedTask.workNotes,
          start: editedTask.start,
          due: editedTask.due,
          tagIds: [stableTag.id, targetTag.id],
          newTagNames: [],
          version: editedTask.version,
        }),
      },
    );
    expect(taggedWithBoth.status).toBe(200);

    const merged = await SELF.fetch(
      `http://example.com/api/v1/tags/${stableTag.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "target" }),
      },
    );
    expect(merged.status).toBe(200);
    const mergedSnapshot = bootstrapResponseSchema.parse(await merged.json());
    expect(mergedSnapshot.tags).not.toEqual(
      expect.arrayContaining([{ id: stableTag.id, name: "renamed" }]),
    );
    expect(
      mergedSnapshot.tasks.find((task) => task.id === createdTask.id)?.tags,
    ).toEqual([{ id: targetTag.id, name: "target" }]);
    const mergedReload = await SELF.fetch(
      "http://example.com/api/v1/bootstrap",
    );
    const mergedReloadSnapshot = bootstrapResponseSchema.parse(
      await mergedReload.json(),
    );
    expect(
      mergedReloadSnapshot.tasks.find((task) => task.id === createdTask.id)
        ?.tags,
    ).toEqual([{ id: targetTag.id, name: "target" }]);

    const search = await SELF.fetch(
      "http://example.com/api/v1/tasks/search?q=Stable%20Tag%20Task",
    );
    expect(search.status).toBe(200);
    expect(
      titleSearchResponseSchema
        .parse(await search.json())
        .tasks.map((task) => task.id),
    ).toEqual(expect.arrayContaining([createdTask.id]));

    const deleted = await SELF.fetch(
      `http://example.com/api/v1/tags/${targetTag.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    const deletedSnapshot = bootstrapResponseSchema.parse(await deleted.json());
    expect(deletedSnapshot.tags).not.toEqual(
      expect.arrayContaining([{ id: targetTag.id, name: "target" }]),
    );
    expect(
      deletedSnapshot.tasks.find((task) => task.id === createdTask.id)?.tags,
    ).toEqual([]);
    const reloaded = await SELF.fetch("http://example.com/api/v1/bootstrap");
    const reloadedSnapshot = bootstrapResponseSchema.parse(
      await reloaded.json(),
    );
    expect(reloadedSnapshot.tags).not.toEqual(
      expect.arrayContaining([{ id: targetTag.id, name: "target" }]),
    );
    expect(
      reloadedSnapshot.tasks.find((task) => task.id === createdTask.id)?.tags,
    ).toEqual([]);
  });
});

describe("PUT /api/v1/owner-settings", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("persists the display language with the other Owner settings", async () => {
    const initial = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    ).ownerSettings;

    const updated = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayLanguage: "ja",
          timeZone: initial.timeZone,
          weekStartsOn: initial.weekStartsOn,
          trashRetentionDays: initial.trashRetentionDays,
          version: initial.version,
        }),
      },
    );

    expect(updated.status).toBe(200);
    expect(
      bootstrapResponseSchema.parse(await updated.json()).ownerSettings,
    ).toMatchObject({ displayLanguage: "ja", version: 2 });

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.ownerSettings.displayLanguage).toBe("ja");

    const unsupported = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayLanguage: "fr",
          timeZone: reload.ownerSettings.timeZone,
          weekStartsOn: reload.ownerSettings.weekStartsOn,
          trashRetentionDays: reload.ownerSettings.trashRetentionDays,
          version: reload.ownerSettings.version,
        }),
      },
    );
    expect(unsupported.status).toBe(400);
  });

  it("persists a positive Trash retention period and rejects invalid or stale updates", async () => {
    const initial = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    ).ownerSettings;

    const updated = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayLanguage: initial.displayLanguage,
          timeZone: initial.timeZone,
          weekStartsOn: initial.weekStartsOn,
          trashRetentionDays: 14,
          version: initial.version,
        }),
      },
    );

    expect(updated.status).toBe(200);
    expect(
      bootstrapResponseSchema.parse(await updated.json()).ownerSettings,
    ).toEqual({
      timeZone: "Asia/Tokyo",
      displayLanguage: initial.displayLanguage,
      weekStartsOn: 0,
      trashRetentionDays: 14,
      version: 2,
    });

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.ownerSettings.trashRetentionDays).toBe(14);

    const invalid = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayLanguage: "en",
          timeZone: "Asia/Tokyo",
          weekStartsOn: 0,
          trashRetentionDays: 0,
          version: 2,
        }),
      },
    );
    expect(invalid.status).toBe(400);

    const nonInteger = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayLanguage: "en",
          timeZone: "Asia/Tokyo",
          weekStartsOn: 0,
          trashRetentionDays: 1.5,
          version: 2,
        }),
      },
    );
    expect(nonInteger.status).toBe(400);

    const stale = await SELF.fetch("http://example.com/api/v1/owner-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayLanguage: "en",
        timeZone: "UTC",
        weekStartsOn: 1,
        trashRetentionDays: 7,
        version: initial.version,
      }),
    });
    expect(stale.status).toBe(409);
  });

  it("keeps existing Trash records until scheduled cleanup", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Trash retention boundary",
        areaId: null,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });
    const task = bootstrapResponseSchema.parse(await created.json()).tasks[0];
    if (!task?.version) throw new Error("Task was not created");

    const trashed = await SELF.fetch(
      `http://example.com/api/v1/tasks/${task.id}/trash`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: task.version }),
      },
    );
    expect(trashed.status).toBe(200);

    const settings = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    ).ownerSettings;
    const updated = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayLanguage: settings.displayLanguage,
          timeZone: settings.timeZone,
          weekStartsOn: settings.weekStartsOn,
          trashRetentionDays: 1,
          version: settings.version,
        }),
      },
    );
    const snapshot = bootstrapResponseSchema.parse(await updated.json());

    expect(snapshot.tasks).toContainEqual(
      expect.objectContaining({ id: task.id, trashedAt: expect.any(String) }),
    );
  });
});

describe("POST /api/v1/tasks", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("creates an Area root Task with normalized Tags in the returned snapshot", async () => {
    const response = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Worker API を実装する",
        areaId: 2,
        description: "Hono と D1 を接続する",
        start: "2026-07-28",
        due: "2026-07-30T09:00:00.000Z",
        newTagNames: [" API ", "Cloudflare", "api"],
      }),
    });

    expect(response.status).toBe(201);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        title: "Worker API を実装する",
        path: ["Develop", "Worker API を実装する"],
        areaId: 2,
        description: "Hono と D1 を接続する",
        workNotes: "",
        start: "2026-07-28",
        due: "2026-07-30T09:00:00.000Z",
        tags: [
          { id: expect.any(Number), name: "api" },
          { id: expect.any(Number), name: "cloudflare" },
        ],
      }),
    ]);

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    const reloadedSnapshot = bootstrapResponseSchema.parse(await reload.json());
    expect(reloadedSnapshot.tasks).toEqual(snapshot.tasks);
  });

  it("creates an Inbox root Task and includes it in Today after reload", async () => {
    const initial = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const inbox = initial.areas.find((area) => area.isSystemManaged);
    if (!inbox) throw new Error("System-managed Inbox Area was not found");

    const response = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Inbox root Task",
        areaId: inbox.id,
        description: "分類前のTask",
        start: todayIn("Asia/Tokyo"),
        due: null,
        newTagNames: ["inbox"],
      }),
    });

    expect(response.status).toBe(201);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    const task = snapshot.tasks.find(
      (candidate) => candidate.title === "Inbox root Task",
    );
    if (!task) throw new Error("Inbox root Task was not created");
    expect(task).toMatchObject({
      areaId: inbox.id,
      path: ["Inbox", "Inbox root Task"],
      tags: [{ id: expect.any(Number), name: "inbox" }],
    });
    expect(snapshot.todayOrders[todayIn("Asia/Tokyo")] ?? []).not.toContain(
      task.id,
    );

    const todayOrder = await SELF.fetch(
      "http://example.com/api/v1/today/order",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [task.id] }),
      },
    );
    expect(todayOrder.status).toBe(200);
    const todayOrderedSnapshot = bootstrapResponseSchema.parse(
      await todayOrder.json(),
    );
    expect(todayOrderedSnapshot.todayOrders[todayIn("Asia/Tokyo")]).toEqual([
      task.id,
    ]);

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.tasks).toContainEqual(
      expect.objectContaining({
        id: task.id,
        areaId: inbox.id,
        path: ["Inbox", "Inbox root Task"],
      }),
    );
  });

  it("creates Inbox Subtasks and persists root and sibling Manual Order after reload", async () => {
    const initial = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const inbox = initial.areas.find((area) => area.isSystemManaged);
    if (!inbox) throw new Error("System-managed Inbox Area was not found");

    const parent = await createTask({ title: "Inbox parent", areaId: null });
    const siblingRoot = await createTask({
      title: "Inbox sibling root",
      areaId: null,
    });
    const firstSubtask = await createTask({
      title: "Inbox first Subtask",
      areaId: inbox.id,
      parentId: parent.id,
    });
    const secondSubtask = await createTask({
      title: "Inbox second Subtask",
      areaId: inbox.id,
      parentId: parent.id,
    });

    const rootOrder = await moveTaskRequest({
      taskId: siblingRoot.id,
      taskVersion: siblingRoot.version,
      targetTaskId: parent.id,
      targetTaskVersion: parent.version,
      position: "before",
    });
    expect(rootOrder.status).toBe(200);

    const siblingOrder = await moveTaskRequest({
      taskId: secondSubtask.id,
      taskVersion: secondSubtask.version,
      targetTaskId: firstSubtask.id,
      targetTaskVersion: firstSubtask.version,
      position: "before",
    });
    expect(siblingOrder.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await siblingOrder.json());

    expect(snapshot.inboxOrder).toEqual([siblingRoot.id, parent.id]);
    expect(snapshot.areaTaskOrders[`parent:${parent.id}`]).toEqual([
      secondSubtask.id,
      firstSubtask.id,
    ]);
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstSubtask.id,
          areaId: inbox.id,
          parentId: parent.id,
          path: ["Inbox", "Inbox parent", "Inbox first Subtask"],
        }),
        expect.objectContaining({
          id: secondSubtask.id,
          areaId: inbox.id,
          parentId: parent.id,
          path: ["Inbox", "Inbox parent", "Inbox second Subtask"],
        }),
      ]),
    );

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.inboxOrder).toEqual(snapshot.inboxOrder);
    expect(reload.areaTaskOrders).toEqual(snapshot.areaTaskOrders);
    expect(reload.tasks).toEqual(snapshot.tasks);
  });

  it("applies Completed and Recurring parent constraints inside Inbox", async () => {
    const completedParent = await createTask({
      title: "Completed Inbox parent",
      areaId: null,
    });
    const completed = await updateTaskStatus(
      completedParent.id,
      "COMPLETED",
      completedParent.version,
    );
    expect(completed.status).toBe(200);

    const completedSubtask = await SELF.fetch(
      "http://example.com/api/v1/tasks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Invalid Completed Inbox Subtask",
          areaId: completedParent.areaId,
          parentId: completedParent.id,
          description: "",
          start: null,
          due: null,
          tags: [],
        }),
      },
    );
    expect(completedSubtask.status).toBe(422);
    expect(await completedSubtask.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Completed Task cannot have a new Open Subtask.",
      },
    });

    const recurring = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Recurring Inbox parent",
        areaId: completedParent.areaId,
        description: "",
        start: "2026-08-01",
        due: "2026-08-01",
        tags: [],
        recurrenceRule: "day",
      }),
    });
    expect(recurring.status).toBe(201);
    const recurringSnapshot = bootstrapResponseSchema.parse(
      await recurring.json(),
    );
    const recurringParent = recurringSnapshot.tasks.find(
      (task) => task.title === "Recurring Inbox parent",
    );
    if (!recurringParent)
      throw new Error("Recurring Inbox parent was not created");

    const recurringSubtask = await SELF.fetch(
      "http://example.com/api/v1/tasks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Invalid Recurring Inbox Subtask",
          areaId: completedParent.areaId,
          parentId: recurringParent.id,
          description: "",
          start: null,
          due: null,
          tags: [],
        }),
      },
    );
    expect(recurringSubtask.status).toBe(422);
    expect(await recurringSubtask.json()).toEqual({
      error: {
        code: "RECURRENCE_RULE_INVALID",
        message: "A Recurring Task cannot have Subtasks.",
      },
    });

    const levelOne = await createTask({
      title: "Inbox Level 1",
      areaId: null,
    });
    let levelParent = levelOne;
    for (const level of [2, 3, 4, 5]) {
      levelParent = await createTask({
        title: `Inbox Level ${level}`,
        areaId: levelParent.areaId,
        parentId: levelParent.id,
      });
    }
    const levelSix = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Invalid Inbox Level 6",
        areaId: levelParent.areaId,
        parentId: levelParent.id,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });
    expect(levelSix.status).toBe(422);
    expect(await levelSix.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Task cannot have more than five levels.",
      },
    });

    const cycleParent = await createTask({
      title: "Inbox cycle parent",
      areaId: null,
    });
    const cycleSubtask = await createTask({
      title: "Inbox cycle Subtask",
      areaId: cycleParent.areaId,
      parentId: cycleParent.id,
    });
    await env.DB.prepare("UPDATE tasks SET parent_task_id = ? WHERE id = ?")
      .bind(cycleSubtask.id, cycleParent.id)
      .run();

    const cyclic = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Invalid Inbox cycle Subtask",
        areaId: cycleParent.areaId,
        parentId: cycleParent.id,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });
    expect(cyclic.status).toBe(422);
    expect(await cyclic.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "Task tree contains a cycle.",
      },
    });
  });

  it("rejects an invalid Area without changing the Task snapshot", async () => {
    const before = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const response = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Invalid Area Task",
        areaId: 99999,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "AREA_NOT_FOUND", message: "Area was not found" },
    });
    const after = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(after.tasks).toEqual(before.tasks);
  });

  it("rejects a Due value before Start at the API boundary", async () => {
    const response = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "日付の検証",
        areaId: null,
        description: "",
        start: "2026-08-02",
        due: "2026-08-01",
        tags: [],
      }),
    });

    expect(response.status).toBe(400);
  });

  it("creates a normalized Recurring Task and rejects invalid recurrence timing", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Weekly review",
        areaId: 2,
        description: "",
        start: "2026-07-29",
        due: "2026-07-29",
        tags: [],
        recurrenceRule: "wed,mon",
      }),
    });
    expect(created.status).toBe(201);
    const recurringSnapshot = bootstrapResponseSchema.parse(
      await created.json(),
    );
    const recurringTask = recurringSnapshot.tasks.find(
      (task) => task.title === "Weekly review",
    );
    if (!recurringTask?.version)
      throw new Error("Recurring Task was not created");
    expect(recurringTask).toMatchObject({ recurrenceRule: "mon, wed" });

    const completed = await updateTaskStatus(
      recurringTask.id,
      "COMPLETED",
      recurringTask.version,
    );
    expect(completed.status).toBe(200);
    const completedSnapshot = bootstrapResponseSchema.parse(
      await completed.json(),
    );
    expect(completedSnapshot.tasks).toContainEqual(
      expect.objectContaining({
        status: "OPEN",
        recurrenceRule: "mon, wed",
        workNotes: "",
      }),
    );

    const invalid = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Invalid recurring",
        areaId: 2,
        description: "",
        start: "2026-07-29T09:00:00.000Z",
        due: null,
        tags: [],
        recurrenceRule: "wed",
      }),
    });
    expect(invalid.status).toBe(422);
  });

  it("generates the occurrence after a future Start when completed early", async () => {
    const today = todayIn("Asia/Tokyo");
    const futureStart = addDaysToDate(today, 1);
    const expectedNextStart = addDaysToDate(futureStart, 1);
    const created = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Future daily review",
        areaId: 2,
        description: "",
        start: futureStart,
        due: futureStart,
        tags: [],
        recurrenceRule: "day",
      }),
    });
    expect(created.status).toBe(201);
    const createdSnapshot = bootstrapResponseSchema.parse(await created.json());
    const original = createdSnapshot.tasks.find(
      (task) => task.title === "Future daily review",
    );
    if (!original?.version) throw new Error("Recurring Task was not created");

    const completed = await updateTaskStatus(
      original.id,
      "COMPLETED",
      original.version,
    );
    expect(completed.status).toBe(200);
    const completedSnapshot = bootstrapResponseSchema.parse(
      await completed.json(),
    );
    const next = completedSnapshot.tasks.find(
      (task) => task.id !== original.id,
    );

    expect(next).toMatchObject({
      title: "Future daily review",
      status: "OPEN",
      start: expectedNextStart,
      due: expectedNextStart,
      recurrenceRule: "day",
    });
  });

  it("creates a Subtask in the selected Area and rejects a Level 6 Task", async () => {
    const root = await createTask({ title: "Level 1", areaId: 2 });
    let parent = root;

    for (const level of [2, 3, 4, 5]) {
      parent = await createTask({
        title: `Level ${level}`,
        areaId: 2,
        parentId: parent.id,
      });
    }

    const rejected = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Level 6",
        areaId: 2,
        parentId: parent.id,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });

    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Task cannot have more than five levels.",
      },
    });
  });

  it("rejects a parent from another Area", async () => {
    const parent = await createTask({ title: "Develop parent", areaId: 2 });

    const rejected = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Music child",
        areaId: 3,
        parentId: parent.id,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });

    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Subtask must use the same Area as its parent.",
      },
    });
  });

  it("rejects a new Subtask below a cyclic parent chain", async () => {
    const parent = await createTask({ title: "Parent", areaId: 2 });
    const child = await createTask({
      title: "Child",
      areaId: 2,
      parentId: parent.id,
    });
    await env.DB.prepare("UPDATE tasks SET parent_task_id = ? WHERE id = ?")
      .bind(child.id, parent.id)
      .run();

    const rejected = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Cannot add below cycle",
        areaId: 2,
        parentId: parent.id,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });

    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "Task tree contains a cycle.",
      },
    });
  });
});

describe("PUT /api/v1/tasks/:id", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("edits a Task and persists its latest normalized snapshot", async () => {
    await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "最初のTitle",
        areaId: null,
        description: "初期Description",
        start: null,
        due: null,
        newTagNames: ["draft"],
      }),
    });
    const beforeEdit = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const task = beforeEdit.tasks[0];

    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${task.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "編集後のTitle",
          description: "更新したDescription",
          workNotes: "- 実装を確認した",
          start: "2026-08-01",
          due: "2026-08-02",
          newTagNames: [" Draft ", "review", "REVIEW"],
          version: task.version,
        }),
      },
    );

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: task.id,
        title: "編集後のTitle",
        path: ["Inbox", "編集後のTitle"],
        description: "更新したDescription",
        workNotes: "- 実装を確認した",
        start: "2026-08-01",
        due: "2026-08-02",
        tags: [
          { id: expect.any(Number), name: "draft" },
          { id: expect.any(Number), name: "review" },
        ],
        version: 2,
      }),
    ]);

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reload.json())).toEqual(
      snapshot,
    );
  });

  it("rejects an edit made with an outdated Task version", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "競合確認",
        areaId: null,
        description: "",
        start: null,
        due: null,
        tags: [],
      }),
    });
    const task = bootstrapResponseSchema.parse(await created.json()).tasks[0];
    if (!task.version) throw new Error("Created Task has no version");

    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${task.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "古い編集",
          description: "",
          workNotes: "",
          start: null,
          due: null,
          tags: [],
          version: task.version + 1,
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "TASK_VERSION_CONFLICT",
        message: "Task version does not match",
      },
    });
  });

  it("updates descendant paths when a parent Task is renamed", async () => {
    const parent = await createTask({ title: "Before rename", areaId: 2 });
    const child = await createTask({
      title: "Child",
      areaId: 2,
      parentId: parent.id,
    });

    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${parent.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "After rename",
          description: "",
          workNotes: "",
          start: null,
          due: null,
          tags: [],
          version: parent.version,
        }),
      },
    );

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.tasks.find((task) => task.id === child.id)?.path).toEqual([
      "Develop",
      "After rename",
      "Child",
    ]);
  });

  it("moves an Area root Task subtree to an active Area and keeps its orders usable", async () => {
    const root = await createTask({ title: "Move root", areaId: 2 });
    const child = await createTask({
      title: "Move child",
      areaId: 2,
      parentId: root.id,
    });
    const leaf = await createTask({
      title: "Move leaf",
      areaId: 2,
      parentId: child.id,
      start: todayIn("Asia/Tokyo"),
    });
    const destinationRoot = await createTask({
      title: "Destination root",
      areaId: 3,
    });

    await env.DB.prepare(
      "INSERT INTO task_manual_orders (group_key, task_id, position) VALUES (?, ?, 0)",
    )
      .bind("area:3", destinationRoot.id)
      .run();
    const todayOrder = await SELF.fetch(
      "http://example.com/api/v1/today/order",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [leaf.id] }),
      },
    );
    expect(todayOrder.status).toBe(200);

    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${root.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: root.title,
          description: root.description,
          workNotes: root.workNotes,
          start: root.start,
          due: root.due,
          tags: root.tags,
          version: root.version,
          areaId: 3,
        }),
      },
    );

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: root.id,
          areaId: 3,
          path: ["Music", "Move root"],
          version: 2,
        }),
        expect.objectContaining({
          id: child.id,
          areaId: 3,
          parentId: root.id,
          path: ["Music", "Move root", "Move child"],
          version: 2,
        }),
        expect.objectContaining({
          id: leaf.id,
          areaId: 3,
          parentId: child.id,
          path: ["Music", "Move root", "Move child", "Move leaf"],
          version: 2,
        }),
      ]),
    );
    expect(snapshot.areaTaskOrders).toEqual({
      "area:3": [destinationRoot.id, root.id],
    });
    expect(snapshot.todayOrders[todayIn("Asia/Tokyo")]).toEqual([leaf.id]);

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reload.json())).toEqual(
      snapshot,
    );

    const reorderedDestination = await moveTaskRequest({
      taskId: root.id,
      taskVersion:
        snapshot.tasks.find((task) => task.id === root.id)?.version ?? 0,
      targetTaskId: destinationRoot.id,
      targetTaskVersion: destinationRoot.version,
      position: "after",
    });
    expect(reorderedDestination.status).toBe(200);
    const reorderedToday = await SELF.fetch(
      "http://example.com/api/v1/today/order",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [leaf.id] }),
      },
    );
    expect(reorderedToday.status).toBe(200);
  });

  it("turns a directly moved Subtask into a destination Area root and cascades its descendants", async () => {
    const parent = await createTask({ title: "Source parent", areaId: 2 });
    const moved = await createTask({
      title: "Moved Subtask",
      areaId: 2,
      parentId: parent.id,
    });
    const descendant = await createTask({
      title: "Moved descendant",
      areaId: 2,
      parentId: moved.id,
    });
    const sibling = await createTask({
      title: "Source sibling",
      areaId: 2,
      parentId: parent.id,
    });
    const ordered = await moveTaskRequest({
      taskId: sibling.id,
      taskVersion: sibling.version,
      targetTaskId: moved.id,
      targetTaskVersion: moved.version,
      position: "after",
    });
    expect(ordered.status).toBe(200);

    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${moved.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: moved.title,
          description: moved.description,
          workNotes: moved.workNotes,
          start: moved.start,
          due: moved.due,
          tags: moved.tags,
          version: moved.version,
          areaId: 3,
        }),
      },
    );

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: parent.id,
          areaId: 2,
          version: 1,
        }),
        expect.objectContaining({
          id: moved.id,
          areaId: 3,
          path: ["Music", "Moved Subtask"],
          version: 2,
        }),
        expect.objectContaining({
          id: descendant.id,
          areaId: 3,
          parentId: moved.id,
          path: ["Music", "Moved Subtask", "Moved descendant"],
          version: 2,
        }),
        expect.objectContaining({
          id: sibling.id,
          areaId: 2,
          parentId: parent.id,
          version: 1,
        }),
      ]),
    );
    expect(
      snapshot.tasks.find((task) => task.id === moved.id),
    ).not.toHaveProperty("parentId");
    expect(snapshot.areaTaskOrders).toEqual({
      "area:3": [moved.id],
      [`parent:${parent.id}`]: [sibling.id],
    });
  });

  it("moves a subtree to the selected destination Task Path", async () => {
    const sourceParent = await createTask({
      title: "Source parent",
      areaId: 2,
    });
    const moved = await createTask({
      title: "Moved Task",
      areaId: 2,
      parentId: sourceParent.id,
    });
    const descendant = await createTask({
      title: "Moved descendant",
      areaId: 2,
      parentId: moved.id,
    });
    const destinationParent = await createTask({
      title: "Destination parent",
      areaId: 3,
    });

    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${moved.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: moved.title,
          description: moved.description,
          workNotes: moved.workNotes,
          start: moved.start,
          due: moved.due,
          tags: moved.tags,
          version: moved.version,
          areaId: 3,
          parentId: destinationParent.id,
        }),
      },
    );

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceParent.id,
          areaId: 2,
          version: 1,
        }),
        expect.objectContaining({
          id: moved.id,
          areaId: 3,
          parentId: destinationParent.id,
          path: ["Music", "Destination parent", "Moved Task"],
          version: 2,
        }),
        expect.objectContaining({
          id: descendant.id,
          areaId: 3,
          parentId: moved.id,
          path: [
            "Music",
            "Destination parent",
            "Moved Task",
            "Moved descendant",
          ],
          version: 2,
        }),
      ]),
    );
    expect(snapshot.areaTaskOrders).toEqual({
      [`parent:${destinationParent.id}`]: [moved.id],
    });

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reload.json())).toEqual(
      snapshot,
    );
  });

  it("moves a subtree between Inbox and an Area while appending destination orders", async () => {
    const todayStart = todayIn("Asia/Tokyo");
    const inboxRoot = await createTask({
      title: "Inbox move root",
      areaId: null,
    });
    const inboxSubtask = await createTask({
      title: "Inbox move Subtask",
      areaId: inboxRoot.areaId,
      parentId: inboxRoot.id,
      start: todayStart,
    });
    const inboxParent = await createTask({
      title: "Inbox destination parent",
      areaId: null,
    });
    const areaRoot = await createTask({
      title: "Area destination root",
      areaId: 2,
    });
    const todayTask = await createTask({
      title: "Independent Today Task",
      areaId: 3,
      start: todayStart,
    });

    const initialInboxOrder = await moveTaskRequest({
      taskId: inboxParent.id,
      taskVersion: inboxParent.version,
      targetTaskId: inboxRoot.id,
      targetTaskVersion: inboxRoot.version,
      position: "before",
    });
    expect(initialInboxOrder.status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO task_manual_orders (group_key, task_id, position) VALUES (?, ?, 0)",
    )
      .bind("area:2", areaRoot.id)
      .run();
    const initialTodayOrder = await SELF.fetch(
      "http://example.com/api/v1/today/order",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [todayTask.id, inboxSubtask.id] }),
      },
    );
    expect(initialTodayOrder.status).toBe(200);

    let currentRoot = inboxRoot;

    const toArea = await SELF.fetch(
      `http://example.com/api/v1/tasks/${inboxRoot.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(taskUpdatePayload(inboxRoot, 2)),
      },
    );
    expect(toArea.status).toBe(200);
    const areaSnapshot = bootstrapResponseSchema.parse(await toArea.json());
    currentRoot = areaSnapshot.tasks.find(
      (task) => task.id === inboxRoot.id,
    ) as typeof inboxRoot;
    expect(areaSnapshot.areaTaskOrders).toEqual({
      "area:2": [areaRoot.id, inboxRoot.id],
    });
    expect(areaSnapshot.inboxOrder).toEqual([inboxParent.id]);
    expect(areaSnapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: inboxRoot.id,
          areaId: 2,
          path: ["Develop", "Inbox move root"],
        }),
        expect.objectContaining({
          id: inboxSubtask.id,
          areaId: 2,
          parentId: inboxRoot.id,
          path: ["Develop", "Inbox move root", "Inbox move Subtask"],
        }),
      ]),
    );
    expect(areaSnapshot.todayOrders[todayStart]).toEqual([
      todayTask.id,
      inboxSubtask.id,
    ]);

    const toInboxRoot = await SELF.fetch(
      `http://example.com/api/v1/tasks/${inboxRoot.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(taskUpdatePayload(currentRoot, inboxRoot.areaId)),
      },
    );
    expect(toInboxRoot.status).toBe(200);
    const inboxRootSnapshot = bootstrapResponseSchema.parse(
      await toInboxRoot.json(),
    );
    currentRoot = inboxRootSnapshot.tasks.find(
      (task) => task.id === inboxRoot.id,
    ) as typeof inboxRoot;
    expect(inboxRootSnapshot.inboxOrder).toEqual([
      inboxParent.id,
      inboxRoot.id,
    ]);
    expect(inboxRootSnapshot.areaTaskOrders).toEqual({
      "area:2": [areaRoot.id],
    });
    expect(inboxRootSnapshot.todayOrders[todayStart]).toEqual([
      todayTask.id,
      inboxSubtask.id,
    ]);

    const toInboxParent = await SELF.fetch(
      `http://example.com/api/v1/tasks/${inboxRoot.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          taskUpdatePayload(currentRoot, inboxRoot.areaId, inboxParent.id),
        ),
      },
    );
    expect(toInboxParent.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await toInboxParent.json());
    expect(snapshot.inboxOrder).toEqual([inboxParent.id]);
    expect(snapshot.areaTaskOrders).toEqual({
      "area:2": [areaRoot.id],
      [`parent:${inboxParent.id}`]: [inboxRoot.id],
    });
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: inboxRoot.id,
          areaId: inboxRoot.areaId,
          parentId: inboxParent.id,
          path: ["Inbox", "Inbox destination parent", "Inbox move root"],
        }),
        expect.objectContaining({
          id: inboxSubtask.id,
          areaId: inboxRoot.areaId,
          parentId: inboxRoot.id,
          path: [
            "Inbox",
            "Inbox destination parent",
            "Inbox move root",
            "Inbox move Subtask",
          ],
        }),
      ]),
    );
    expect(snapshot.todayOrders[todayStart]).toEqual([
      todayTask.id,
      inboxSubtask.id,
    ]);
    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload).toEqual(snapshot);
  });

  it("rejects Inbox subtree moves with stale and invalid destination rules", async () => {
    const source = await createTask({
      title: "Inbox move validation root",
      areaId: null,
    });
    const sourceSubtask = await createTask({
      title: "Inbox move validation Subtask",
      areaId: source.areaId,
      parentId: source.id,
    });
    const stale = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          taskUpdatePayload(source, 2, undefined, source.version + 1),
        ),
      },
    );
    expect(stale.status).toBe(409);

    const cyclic = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          taskUpdatePayload(source, source.areaId, sourceSubtask.id),
        ),
      },
    );
    expect(cyclic.status).toBe(422);
    expect(await cyclic.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Task cannot be moved below itself or one of its Subtasks.",
      },
    });

    const completedParent = await createTask({
      title: "Completed Area destination",
      areaId: 2,
    });
    expect(
      (
        await updateTaskStatus(
          completedParent.id,
          "COMPLETED",
          completedParent.version,
        )
      ).status,
    ).toBe(200);
    const completedMove = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(taskUpdatePayload(source, 2, completedParent.id)),
      },
    );
    expect(completedMove.status).toBe(422);
    expect(await completedMove.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Completed Task cannot have a new Open Subtask.",
      },
    });

    const recurringResponse = await SELF.fetch(
      "http://example.com/api/v1/tasks",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Recurring Area destination",
          areaId: 2,
          description: "",
          start: "2026-08-01",
          due: "2026-08-01",
          tags: [],
          recurrenceRule: "day",
        }),
      },
    );
    expect(recurringResponse.status).toBe(201);
    const recurringParent = bootstrapResponseSchema
      .parse(await recurringResponse.json())
      .tasks.find((task) => task.title === "Recurring Area destination");
    if (!recurringParent?.version)
      throw new Error("Recurring destination was not created");
    const recurringMove = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(taskUpdatePayload(source, 2, recurringParent.id)),
      },
    );
    expect(recurringMove.status).toBe(422);
    expect(await recurringMove.json()).toEqual({
      error: {
        code: "RECURRENCE_RULE_INVALID",
        message: "A Recurring Task cannot have Subtasks.",
      },
    });

    const levelOne = await createTask({ title: "Move level 1", areaId: 3 });
    const levelTwo = await createTask({
      title: "Move level 2",
      areaId: 3,
      parentId: levelOne.id,
    });
    const levelThree = await createTask({
      title: "Move level 3",
      areaId: 3,
      parentId: levelTwo.id,
    });
    const levelFour = await createTask({
      title: "Move level 4",
      areaId: 3,
      parentId: levelThree.id,
    });
    const tooDeep = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(taskUpdatePayload(source, 3, levelFour.id)),
      },
    );
    expect(tooDeep.status).toBe(422);
    expect(await tooDeep.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Task cannot have more than five levels.",
      },
    });

    const trashedArea = await SELF.fetch("http://example.com/api/v1/areas/1", {
      method: "DELETE",
    });
    expect(trashedArea.status).toBe(200);
    const trashedMove = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(taskUpdatePayload(source, 1)),
      },
    );
    expect(trashedMove.status).toBe(404);
    expect(await trashedMove.json()).toEqual({
      error: { code: "TASK_NOT_FOUND", message: "Area was not found" },
    });

    const snapshot = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: source.id,
          areaId: source.areaId,
          version: 1,
        }),
        expect.objectContaining({
          id: sourceSubtask.id,
          areaId: source.areaId,
          parentId: source.id,
          version: 1,
        }),
      ]),
    );
  });

  it("changes Task Path within an Area and rejects a move beyond Level 5", async () => {
    const source = await createTask({ title: "Source", areaId: 2 });
    const sourceChild = await createTask({
      title: "Source child",
      areaId: 2,
      parentId: source.id,
    });
    const sameAreaParent = await createTask({
      title: "Same Area parent",
      areaId: 2,
    });
    const sourceOrder = await moveTaskRequest({
      taskId: sameAreaParent.id,
      taskVersion: sameAreaParent.version,
      targetTaskId: source.id,
      targetTaskVersion: source.version,
      position: "after",
    });
    expect(sourceOrder.status).toBe(200);
    const sameAreaReparent = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: source.title,
          description: source.description,
          workNotes: source.workNotes,
          start: source.start,
          due: source.due,
          tags: source.tags,
          version: source.version,
          parentId: sameAreaParent.id,
        }),
      },
    );
    expect(sameAreaReparent.status).toBe(200);
    const sameAreaSnapshot = bootstrapResponseSchema.parse(
      await sameAreaReparent.json(),
    );
    const movedSource = sameAreaSnapshot.tasks.find(
      (task) => task.id === source.id,
    );
    if (!movedSource?.version) throw new Error("Moved source has no version");
    expect(sameAreaSnapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: source.id,
          areaId: 2,
          parentId: sameAreaParent.id,
          path: ["Develop", "Same Area parent", "Source"],
          version: 2,
        }),
        expect.objectContaining({
          id: sourceChild.id,
          areaId: 2,
          parentId: source.id,
          path: ["Develop", "Same Area parent", "Source", "Source child"],
          version: 1,
        }),
      ]),
    );
    expect(sameAreaSnapshot.areaTaskOrders).toEqual({
      "area:2": [sameAreaParent.id],
      [`parent:${sameAreaParent.id}`]: [source.id],
    });

    const levelOne = await createTask({ title: "Level 1", areaId: 3 });
    const levelTwo = await createTask({
      title: "Level 2",
      areaId: 3,
      parentId: levelOne.id,
    });
    const levelThree = await createTask({
      title: "Level 3",
      areaId: 3,
      parentId: levelTwo.id,
    });
    const levelFour = await createTask({
      title: "Level 4",
      areaId: 3,
      parentId: levelThree.id,
    });
    const tooDeep = await SELF.fetch(
      `http://example.com/api/v1/tasks/${source.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: movedSource.title,
          description: movedSource.description,
          workNotes: movedSource.workNotes,
          start: movedSource.start,
          due: movedSource.due,
          tags: movedSource.tags,
          version: movedSource.version,
          areaId: 3,
          parentId: levelFour.id,
        }),
      },
    );
    expect(tooDeep.status).toBe(422);
    expect(await tooDeep.json()).toEqual({
      error: {
        code: "TASK_TREE_INVALID",
        message: "A Task cannot have more than five levels.",
      },
    });
    const snapshot = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(snapshot.tasks).toContainEqual(
      expect.objectContaining({
        id: sourceChild.id,
        areaId: 2,
        parentId: source.id,
        path: ["Develop", "Same Area parent", "Source", "Source child"],
      }),
    );
  });

  it("moves a Subtask to the Area root within the same Area", async () => {
    const parent = await createTask({ title: "Parent", areaId: 2 });
    const subtask = await createTask({
      title: "Subtask",
      areaId: 2,
      parentId: parent.id,
    });

    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${subtask.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: subtask.title,
          description: subtask.description,
          workNotes: subtask.workNotes,
          start: subtask.start,
          due: subtask.due,
          tags: subtask.tags,
          version: subtask.version,
          parentId: null,
        }),
      },
    );

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: subtask.id,
          areaId: 2,
          path: ["Develop", "Subtask"],
          version: 2,
        }),
      ]),
    );
    expect(
      snapshot.tasks.find((task) => task.id === subtask.id),
    ).not.toHaveProperty("parentId");
    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reload.json())).toEqual(
      snapshot,
    );
  });

  it("rejects Area moves with a stale Task version or a trashed destination", async () => {
    const root = await createTask({ title: "Protected root", areaId: 2 });
    const child = await createTask({
      title: "Protected child",
      areaId: 2,
      parentId: root.id,
    });
    const payload = {
      title: root.title,
      description: root.description,
      workNotes: root.workNotes,
      start: root.start,
      due: root.due,
      tags: root.tags,
      areaId: 3,
    };

    const stale = await SELF.fetch(
      `http://example.com/api/v1/tasks/${root.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, version: root.version + 1 }),
      },
    );
    expect(stale.status).toBe(409);

    const trashedArea = await SELF.fetch("http://example.com/api/v1/areas/3", {
      method: "DELETE",
    });
    expect(trashedArea.status).toBe(200);
    const rejected = await SELF.fetch(
      `http://example.com/api/v1/tasks/${root.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, version: root.version }),
      },
    );
    expect(rejected.status).toBe(404);
    expect(await rejected.json()).toEqual({
      error: { code: "TASK_NOT_FOUND", message: "Area was not found" },
    });

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root.id, areaId: 2, version: 1 }),
        expect.objectContaining({
          id: child.id,
          areaId: 2,
          parentId: root.id,
          version: 1,
        }),
      ]),
    );
  });
});

describe("PUT /api/v1/tasks/move", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("moves a Task before, after, and as the last child while preserving the subtree", async () => {
    const first = await createTask({ title: "Move first", areaId: 2 });
    const second = await createTask({ title: "Move second", areaId: 2 });
    const third = await createTask({ title: "Move third", areaId: 2 });
    const parent = await createTask({ title: "Move destination", areaId: 2 });
    const child = await createTask({
      title: "Existing child",
      areaId: 2,
      parentId: parent.id,
    });
    const descendant = await createTask({
      title: "Preserved descendant",
      areaId: 2,
      parentId: first.id,
    });

    const afterSecond = await moveTaskRequest({
      taskId: first.id,
      taskVersion: first.version,
      targetTaskId: second.id,
      targetTaskVersion: second.version,
      position: "after",
    });
    expect(afterSecond.status).toBe(200);
    let snapshot = bootstrapResponseSchema.parse(await afterSecond.json());
    expect(snapshot.areaTaskOrders["area:2"]).toEqual([
      second.id,
      first.id,
      third.id,
      parent.id,
    ]);
    expect(snapshot.tasks).toContainEqual(
      expect.objectContaining({ id: first.id, version: first.version }),
    );

    const beforeSecond = await moveTaskRequest({
      taskId: third.id,
      taskVersion: third.version,
      targetTaskId: second.id,
      targetTaskVersion: second.version,
      position: "before",
    });
    expect(beforeSecond.status).toBe(200);
    snapshot = bootstrapResponseSchema.parse(await beforeSecond.json());
    expect(snapshot.areaTaskOrders["area:2"]).toEqual([
      third.id,
      second.id,
      first.id,
      parent.id,
    ]);

    const asLastChild = await moveTaskRequest({
      taskId: second.id,
      taskVersion: second.version,
      targetTaskId: parent.id,
      targetTaskVersion: parent.version,
      position: "as-last-child",
      anchorTaskId: child.id,
      anchorTaskVersion: child.version,
      anchorPosition: "after",
    });
    expect(asLastChild.status).toBe(200);
    snapshot = bootstrapResponseSchema.parse(await asLastChild.json());
    expect(snapshot.areaTaskOrders["area:2"]).toEqual([
      third.id,
      first.id,
      parent.id,
    ]);
    expect(snapshot.areaTaskOrders[`parent:${parent.id}`]).toEqual([
      child.id,
      second.id,
    ]);
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: second.id,
          parentId: parent.id,
          version: second.version + 1,
          path: ["Develop", "Move destination", "Move second"],
        }),
        expect.objectContaining({
          id: descendant.id,
          parentId: first.id,
          path: ["Develop", "Move first", "Preserved descendant"],
          version: descendant.version,
        }),
      ]),
    );
  });

  it("places a moved root before a hidden Completed child", async () => {
    const parent = await createTask({
      title: "Completed child parent",
      areaId: 2,
    });
    const completedChild = await createTask({
      title: "Hidden completed child",
      areaId: 2,
      parentId: parent.id,
    });
    const completed = await updateTaskStatus(
      completedChild.id,
      "COMPLETED",
      completedChild.version,
    );
    expect(completed.status).toBe(200);
    const source = await createTask({
      title: "Moved before completed",
      areaId: 2,
    });

    const response = await moveTaskRequest({
      taskId: source.id,
      taskVersion: source.version,
      targetTaskId: parent.id,
      targetTaskVersion: parent.version,
      position: "as-last-child",
      anchorTaskId: completedChild.id,
      anchorTaskVersion: completedChild.version + 1,
      anchorPosition: "before",
    });

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.areaTaskOrders[`parent:${parent.id}`]).toEqual([
      source.id,
      completedChild.id,
    ]);
  });

  it("rejects stale, cross-Area, Completed-parent, and cyclic moves without mutation", async () => {
    const source = await createTask({
      title: "Invalid move source",
      areaId: 2,
    });
    const target = await createTask({
      title: "Invalid move target",
      areaId: 2,
    });
    const before = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );

    const stale = await moveTaskRequest({
      taskId: source.id,
      taskVersion: source.version + 1,
      targetTaskId: target.id,
      targetTaskVersion: target.version,
      position: "after",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: {
        code: "TASK_VERSION_CONFLICT",
        message: "Task version does not match",
      },
    });

    const otherArea = await createTask({
      title: "Other Area target",
      areaId: 3,
    });
    const crossArea = await moveTaskRequest({
      taskId: source.id,
      taskVersion: source.version,
      targetTaskId: otherArea.id,
      targetTaskVersion: otherArea.version,
      position: "before",
    });
    expect(crossArea.status).toBe(422);
    expect(await crossArea.json()).toEqual({
      error: {
        code: "TASK_MOVE_INVALID",
        message: "A Task subtree must stay within the same Area.",
      },
    });

    const completedParent = await createTask({
      title: "Completed move parent",
      areaId: 2,
    });
    const completedParentResponse = await updateTaskStatus(
      completedParent.id,
      "COMPLETED",
      completedParent.version,
    );
    const completedParentSnapshot = bootstrapResponseSchema.parse(
      await completedParentResponse.json(),
    );
    const completedParentTask = taskFromSnapshot(
      completedParentSnapshot,
      completedParent.id,
    );
    const completedParentMove = await moveTaskRequest({
      taskId: source.id,
      taskVersion: source.version,
      targetTaskId: completedParent.id,
      targetTaskVersion: completedParentTask.version,
      position: "as-last-child",
    });
    expect(completedParentMove.status).toBe(422);
    expect(await completedParentMove.json()).toEqual({
      error: {
        code: "TASK_MOVE_INVALID",
        message: "A Completed Task cannot have a new Open Subtask.",
      },
    });

    const child = await createTask({
      title: "Cyclic move child",
      areaId: 2,
      parentId: source.id,
    });
    const cyclic = await moveTaskRequest({
      taskId: source.id,
      taskVersion: source.version,
      targetTaskId: child.id,
      targetTaskVersion: child.version,
      position: "as-last-child",
    });
    expect(cyclic.status).toBe(422);
    expect(await cyclic.json()).toEqual({
      error: {
        code: "TASK_MOVE_INVALID",
        message: "A Task cannot be moved below itself or one of its Subtasks.",
      },
    });

    const after = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(after.areaTaskOrders).toEqual(before.areaTaskOrders);
    expect(after.tasks.find((task) => task.id === source.id)).toEqual(
      before.tasks.find((task) => task.id === source.id),
    );
    expect(after.tasks.find((task) => task.id === target.id)).toEqual(
      before.tasks.find((task) => task.id === target.id),
    );
  });
});

describe("PUT /api/v1/today/order", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("persists Today and Task tree order without changing a Task parent or Area", async () => {
    const todayStart = todayIn("Asia/Tokyo");
    const todayFirst = await createTask({
      title: "Today first",
      areaId: 2,
      start: todayStart,
    });
    const todaySecond = await createTask({
      title: "Today second",
      areaId: 2,
      start: todayStart,
    });
    const inboxFirst = await createTask({ title: "Inbox first", areaId: null });
    const inboxSecond = await createTask({
      title: "Inbox second",
      areaId: null,
    });
    const areaFirst = await createTask({ title: "Area first", areaId: 3 });
    const areaSecond = await createTask({ title: "Area second", areaId: 3 });
    const siblingFirst = await createTask({
      title: "Sibling first",
      areaId: 3,
      parentId: areaFirst.id,
    });
    const siblingSecond = await createTask({
      title: "Sibling second",
      areaId: 3,
      parentId: areaFirst.id,
    });

    const todayOrder = await SELF.fetch(
      "http://example.com/api/v1/today/order",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [todaySecond.id, todayFirst.id] }),
      },
    );
    expect(todayOrder.status).toBe(200);

    const inboxOrder = await moveTaskRequest({
      taskId: inboxSecond.id,
      taskVersion: inboxSecond.version,
      targetTaskId: inboxFirst.id,
      targetTaskVersion: inboxFirst.version,
      position: "before",
    });
    expect(inboxOrder.status).toBe(200);

    const areaOrder = await moveTaskRequest({
      taskId: areaSecond.id,
      taskVersion: areaSecond.version,
      targetTaskId: areaFirst.id,
      targetTaskVersion: areaFirst.version,
      position: "before",
    });
    expect(areaOrder.status).toBe(200);

    const siblingOrder = await moveTaskRequest({
      taskId: siblingSecond.id,
      taskVersion: siblingSecond.version,
      targetTaskId: siblingFirst.id,
      targetTaskVersion: siblingFirst.version,
      position: "before",
    });
    expect(siblingOrder.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await siblingOrder.json());

    expect(snapshot.todayOrders[todayStart]).toEqual([
      todaySecond.id,
      todayFirst.id,
    ]);
    expect(snapshot.inboxOrder).toEqual([inboxSecond.id, inboxFirst.id]);
    expect(snapshot.areaTaskOrders).toMatchObject({
      "area:3": [areaSecond.id, areaFirst.id],
      [`parent:${areaFirst.id}`]: [siblingSecond.id, siblingFirst.id],
    });
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: siblingFirst.id,
          parentId: areaFirst.id,
          areaId: 3,
        }),
        expect.objectContaining({
          id: inboxFirst.id,
          areaId: expect.any(Number),
        }),
      ]),
    );

    const newlyEligible = await createTask({
      title: "Newly eligible",
      areaId: 2,
      start: todayStart,
    });
    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.todayOrders[todayStart]).toEqual([
      todaySecond.id,
      todayFirst.id,
    ]);
    expect(reload.todayOrders[todayStart]).not.toContain(newlyEligible.id);
    expect(reload.inboxOrder).toEqual(snapshot.inboxOrder);
    expect(reload.areaTaskOrders).toEqual(snapshot.areaTaskOrders);
  });

  it("accepts parent and Subtask entries in Today Order and persists them after reload", async () => {
    const todayStart = todayIn("Asia/Tokyo");
    const parent = await createTask({
      title: "Scheduled parent",
      areaId: 2,
      start: todayStart,
    });
    const child = await createTask({
      title: "Scheduled child",
      areaId: 2,
      parentId: parent.id,
      start: todayStart,
    });
    const future = await createTask({
      title: "Future task",
      areaId: 2,
      start: "2099-01-01",
    });
    const unscheduled = await createTask({
      title: "Unscheduled task",
      areaId: 2,
    });
    const dueOnly = await createTask({
      title: "Due only task",
      areaId: 2,
      due: todayStart,
    });
    const inboxDueOnly = await createTask({
      title: "Inbox due only task",
      areaId: null,
      due: todayStart,
    });
    const completed = await createTask({
      title: "Completed task",
      areaId: 2,
      start: todayStart,
    });
    const completedResponse = await updateTaskStatus(
      completed.id,
      "COMPLETED",
      completed.version,
    );
    expect(completedResponse.status).toBe(200);

    const ordered = await SELF.fetch("http://example.com/api/v1/today/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: [inboxDueOnly.id, dueOnly.id, child.id, parent.id],
      }),
    });

    expect(ordered.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await ordered.json());
    expect(snapshot.todayOrders[todayStart]).toEqual([
      inboxDueOnly.id,
      dueOnly.id,
      child.id,
      parent.id,
    ]);
    expect(snapshot.todayOrders[todayStart]).not.toEqual(
      expect.arrayContaining([future.id, unscheduled.id, completed.id]),
    );

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.todayOrders[todayStart]).toEqual([
      inboxDueOnly.id,
      dueOnly.id,
      child.id,
      parent.id,
    ]);
  });

  it("rejects an incomplete Today Order without changing the saved order", async () => {
    const todayStart = todayIn("Asia/Tokyo");
    const first = await createTask({
      title: "Saved first",
      areaId: 2,
      start: todayStart,
    });
    const dueOnly = await createTask({
      title: "Saved Due only",
      areaId: null,
      due: todayStart,
    });
    const future = await createTask({
      title: "Future invalid",
      areaId: 2,
      start: "2099-01-01",
    });
    const unscheduled = await createTask({
      title: "Unscheduled invalid",
      areaId: 2,
    });
    const completed = await createTask({
      title: "Completed invalid",
      areaId: 2,
      start: todayStart,
    });
    const completedResponse = await updateTaskStatus(
      completed.id,
      "COMPLETED",
      completed.version,
    );
    expect(completedResponse.status).toBe(200);
    const trashed = await createTask({
      title: "Trashed invalid",
      areaId: 2,
      start: todayStart,
    });
    const trashedResponse = await trashTask(trashed.id, trashed.version);
    expect(trashedResponse.status).toBe(200);

    const saved = await SELF.fetch("http://example.com/api/v1/today/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [dueOnly.id, first.id] }),
    });
    expect(saved.status).toBe(200);

    const invalidRequests = [
      { name: "missing", ids: [first.id] },
      { name: "extra", ids: [dueOnly.id, first.id, "unknown-task"] },
      { name: "duplicate", ids: [dueOnly.id, first.id, first.id] },
      { name: "future", ids: [dueOnly.id, first.id, future.id] },
      { name: "Completed", ids: [dueOnly.id, first.id, completed.id] },
      { name: "Trash", ids: [dueOnly.id, first.id, trashed.id] },
      { name: "unscheduled", ids: [dueOnly.id, first.id, unscheduled.id] },
    ];
    for (const invalidRequest of invalidRequests) {
      const rejected = await SELF.fetch(
        "http://example.com/api/v1/today/order",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: invalidRequest.ids }),
        },
      );
      expect(rejected.status, invalidRequest.name).toBe(422);
    }

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reload.todayOrders[todayStart]).toEqual([dueOnly.id, first.id]);
  });

  it("clears a reopened Task from Today Order so it returns at the end of the Open section", async () => {
    const todayStart = todayIn("Asia/Tokyo");
    const first = await createTask({
      title: "Today first",
      areaId: 2,
      start: todayStart,
    });
    const second = await createTask({
      title: "Today second",
      areaId: 2,
      start: todayStart,
    });
    const ordered = await SELF.fetch("http://example.com/api/v1/today/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [second.id, first.id] }),
    });
    const orderedSnapshot = bootstrapResponseSchema.parse(await ordered.json());
    const secondVersion = orderedSnapshot.tasks.find(
      (task) => task.id === second.id,
    )?.version;
    if (!secondVersion) throw new Error("Today Task version was not found");

    const completed = await updateTaskStatus(
      second.id,
      "COMPLETED",
      secondVersion,
    );
    const completedSnapshot = bootstrapResponseSchema.parse(
      await completed.json(),
    );
    const completedVersion = completedSnapshot.tasks.find(
      (task) => task.id === second.id,
    )?.version;
    if (!completedVersion)
      throw new Error("Completed Task version was not found");

    const reopened = await updateTaskStatus(
      second.id,
      "OPEN",
      completedVersion,
    );
    expect(reopened.status).toBe(200);
    expect(
      bootstrapResponseSchema.parse(await reopened.json()).todayOrders[
        todayStart
      ],
    ).toEqual([first.id]);
  });
});

describe("PATCH /api/v1/tasks/:id/status", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
  });

  it("removes the generated next occurrence when a Recurring Task is reopened", async () => {
    const start = todayIn("Asia/Tokyo");
    const created = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Daily review",
        areaId: 2,
        description: "",
        start,
        due: start,
        newTagNames: ["routine"],
        recurrenceRule: "day",
      }),
    });
    expect(created.status).toBe(201);
    const createdSnapshot = bootstrapResponseSchema.parse(await created.json());
    const original = createdSnapshot.tasks.find(
      (task) => task.title === "Daily review",
    );
    if (!original?.version) throw new Error("Recurring Task was not created");

    const completed = await updateTaskStatus(
      original.id,
      "COMPLETED",
      original.version,
    );
    expect(completed.status).toBe(200);
    const completedSnapshot = bootstrapResponseSchema.parse(
      await completed.json(),
    );
    const completedOriginal = taskFromSnapshot(completedSnapshot, original.id);
    expect(
      completedSnapshot.tasks.filter(
        (task) => task.id !== original.id && task.title === "Daily review",
      ),
    ).toHaveLength(1);

    const reopened = await updateTaskStatus(
      original.id,
      "OPEN",
      completedOriginal.version,
    );
    expect(reopened.status).toBe(200);
    const reopenedSnapshot = bootstrapResponseSchema.parse(
      await reopened.json(),
    );
    expect(reopenedSnapshot.tasks).toEqual([
      expect.objectContaining({
        id: original.id,
        status: "OPEN",
        recurrenceRule: "day",
        tags: [{ id: expect.any(Number), name: "routine" }],
      }),
    ]);

    const reopenedOriginal = taskFromSnapshot(reopenedSnapshot, original.id);
    const recompleted = await updateTaskStatus(
      original.id,
      "COMPLETED",
      reopenedOriginal.version,
    );
    expect(recompleted.status).toBe(200);
    const recompletedSnapshot = bootstrapResponseSchema.parse(
      await recompleted.json(),
    );
    expect(
      recompletedSnapshot.tasks.filter(
        (task) => task.id !== original.id && task.title === "Daily review",
      ),
    ).toHaveLength(1);
  });

  it("rejects reopening a Recurring Task when its next occurrence was edited", async () => {
    const start = todayIn("Asia/Tokyo");
    const created = await SELF.fetch("http://example.com/api/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Daily review",
        areaId: 2,
        description: "",
        start,
        due: start,
        tags: [],
        recurrenceRule: "day",
      }),
    });
    const original = bootstrapResponseSchema
      .parse(await created.json())
      .tasks.find((task) => task.title === "Daily review");
    if (!original?.version) throw new Error("Recurring Task was not created");

    const completed = await updateTaskStatus(
      original.id,
      "COMPLETED",
      original.version,
    );
    const completedSnapshot = bootstrapResponseSchema.parse(
      await completed.json(),
    );
    const completedOriginal = taskFromSnapshot(completedSnapshot, original.id);
    const next = completedSnapshot.tasks.find(
      (task) => task.id !== original.id,
    );
    if (!next?.version) throw new Error("Next occurrence was not created");

    const edited = await SELF.fetch(
      `http://example.com/api/v1/tasks/${next.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Edited daily review",
          description: next.description,
          workNotes: next.workNotes,
          start: next.start,
          due: next.due,
          tags: next.tags,
          recurrenceRule: next.recurrenceRule,
          version: next.version,
        }),
      },
    );
    expect(edited.status).toBe(200);

    const reopened = await updateTaskStatus(
      original.id,
      "OPEN",
      completedOriginal.version,
    );
    expect(reopened.status).toBe(409);
    expect(await reopened.json()).toEqual({
      error: {
        code: "RECURRING_TASK_REOPEN_CONFLICT",
        message: "The next occurrence has changed and cannot be removed.",
      },
    });
  });

  it("rejects reopening a Recurring Task when its next occurrence was completed", async () => {
    const { original, completedOriginal, next } =
      await createCompletedDailyRecurringTask();
    const completedNext = await updateTaskStatus(
      next.id,
      "COMPLETED",
      next.version,
    );
    expect(completedNext.status).toBe(200);

    const reopened = await updateTaskStatus(
      original.id,
      "OPEN",
      completedOriginal.version,
    );
    expect(reopened.status).toBe(409);
    expect(await reopened.json()).toEqual({
      error: {
        code: "RECURRING_TASK_REOPEN_CONFLICT",
        message: "The next occurrence has changed and cannot be removed.",
      },
    });
  });

  it("rejects reopening a Recurring Task when its next occurrence was trashed", async () => {
    const { original, completedOriginal, next } =
      await createCompletedDailyRecurringTask();
    const trashed = await trashTask(next.id, next.version);
    expect(trashed.status).toBe(200);

    const reopened = await updateTaskStatus(
      original.id,
      "OPEN",
      completedOriginal.version,
    );
    expect(reopened.status).toBe(409);
    expect(await reopened.json()).toEqual({
      error: {
        code: "RECURRING_TASK_REOPEN_CONFLICT",
        message: "The next occurrence has changed and cannot be removed.",
      },
    });
  });

  it("rejects completing a parent with an Open descendant", async () => {
    const parent = await createTask({ title: "Parent", areaId: 2 });
    await createTask({ title: "Open child", areaId: 2, parentId: parent.id });

    const response = await updateTaskStatus(
      parent.id,
      "COMPLETED",
      parent.version,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "TASK_HAS_OPEN_DESCENDANTS",
        message: "A Task with Open descendants cannot be completed.",
      },
    });
  });

  it("atomically completes a parent and every Open descendant with explicit versions", async () => {
    const parent = await createTask({ title: "Cascade parent", areaId: 2 });
    const child = await createTask({
      title: "Cascade child",
      areaId: 2,
      parentId: parent.id,
    });
    const grandchild = await createTask({
      title: "Cascade grandchild",
      areaId: 2,
      parentId: child.id,
    });
    const completedDescendant = await createTask({
      title: "Already completed descendant",
      areaId: 2,
      parentId: parent.id,
    });
    const trashedDescendant = await createTask({
      title: "Already trashed descendant",
      areaId: 2,
      parentId: parent.id,
    });
    const completedResponse = await updateTaskStatus(
      completedDescendant.id,
      "COMPLETED",
      completedDescendant.version,
    );
    expect(completedResponse.status).toBe(200);
    const trashedResponse = await trashTask(
      trashedDescendant.id,
      trashedDescendant.version,
    );
    expect(trashedResponse.status).toBe(200);

    const before = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const beforeTasks = [parent.id, child.id, grandchild.id].map((id) =>
      taskFromSnapshot(before, id),
    );
    const completedBefore = taskFromSnapshot(before, completedDescendant.id);
    const trashedBefore = taskFromSnapshot(before, trashedDescendant.id);
    const response = await SELF.fetch(
      `http://example.com/api/v1/tasks/${parent.id}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "COMPLETED",
          version: parent.version,
          cascadeDescendants: true,
          descendantVersions: {
            [child.id]: child.version,
            [grandchild.id]: grandchild.version,
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    const completedTasks = [parent.id, child.id, grandchild.id].map((id) =>
      taskFromSnapshot(snapshot, id),
    );
    expect(completedTasks.map((task) => task.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);
    expect(new Set(completedTasks.map((task) => task.completedAt)).size).toBe(
      1,
    );
    expect(completedTasks.map((task) => task.updatedAt)).toEqual(
      completedTasks.map((task) => task.completedAt),
    );
    expect(completedTasks.map((task) => task.version)).toEqual(
      beforeTasks.map((task) => (task.version ?? 0) + 1),
    );
    expect(taskFromSnapshot(snapshot, completedDescendant.id)).toEqual(
      completedBefore,
    );
    expect(taskFromSnapshot(snapshot, trashedDescendant.id)).toEqual(
      trashedBefore,
    );

    const reload = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(
      [parent.id, child.id, grandchild.id].map((id) =>
        taskFromSnapshot(reload, id),
      ),
    ).toEqual(completedTasks);
  });

  it("rejects an incomplete, extra, or stale cascade version set without changing tasks", async () => {
    const parent = await createTask({ title: "Version parent", areaId: 2 });
    const child = await createTask({
      title: "Version child",
      areaId: 2,
      parentId: parent.id,
    });
    const grandchild = await createTask({
      title: "Version grandchild",
      areaId: 2,
      parentId: child.id,
    });
    const before = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const requests = [
      { [child.id]: child.version },
      {
        [child.id]: child.version,
        [grandchild.id]: grandchild.version,
        "unexpected-task": 1,
      },
      { [child.id]: child.version + 1, [grandchild.id]: grandchild.version },
    ];

    for (const descendantVersions of requests) {
      const response = await SELF.fetch(
        `http://example.com/api/v1/tasks/${parent.id}/status`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "COMPLETED",
            version: parent.version,
            cascadeDescendants: true,
            descendantVersions,
          }),
        },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "TASK_VERSION_CONFLICT",
          message: "Cascade descendant versions do not match.",
        },
      });
    }

    const after = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(after.tasks).toEqual(before.tasks);
  });

  it("rejects direct and deep Open Recurring descendants without creating occurrences", async () => {
    const directParent = await createTask({
      title: "Direct recurring parent",
      areaId: 2,
    });
    const directRecurring = await createTask({
      title: "Direct recurring child",
      areaId: 2,
      parentId: directParent.id,
      start: todayIn("Asia/Tokyo"),
      due: todayIn("Asia/Tokyo"),
      recurrenceRule: "day",
    });
    const deepParent = await createTask({
      title: "Deep recurring parent",
      areaId: 2,
    });
    const deepChild = await createTask({
      title: "Deep recurring child",
      areaId: 2,
      parentId: deepParent.id,
    });
    const deepRecurring = await createTask({
      title: "Deep recurring grandchild",
      areaId: 2,
      parentId: deepChild.id,
      start: todayIn("Asia/Tokyo"),
      due: todayIn("Asia/Tokyo"),
      recurrenceRule: "day",
    });

    for (const [parent, recurring] of [
      [directParent, directRecurring],
      [deepParent, deepRecurring],
    ] as const) {
      const response = await SELF.fetch(
        `http://example.com/api/v1/tasks/${parent.id}/status`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "COMPLETED",
            version: parent.version,
            cascadeDescendants: true,
            descendantVersions: {
              [recurring.id]: recurring.version,
              ...(parent.id === deepParent.id
                ? { [deepChild.id]: deepChild.version }
                : {}),
            },
          }),
        },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "TASK_HAS_OPEN_RECURRING_DESCENDANTS",
          message:
            "A Task with an Open Recurring descendant cannot be completed.",
          taskIds: [recurring.id],
        },
      });
    }

    const after = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(
      after.tasks.filter((task) =>
        [
          directParent.id,
          deepParent.id,
          directRecurring.id,
          deepRecurring.id,
        ].includes(task.id),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: directParent.id, status: "OPEN" }),
        expect.objectContaining({ id: deepParent.id, status: "OPEN" }),
        expect.objectContaining({ id: directRecurring.id, status: "OPEN" }),
        expect.objectContaining({ id: deepRecurring.id, status: "OPEN" }),
      ]),
    );
    expect(
      after.tasks.filter((task) =>
        [
          directParent.id,
          deepParent.id,
          directRecurring.id,
          deepRecurring.id,
        ].includes(task.id),
      ),
    ).toHaveLength(4);
    expect(
      after.tasks.filter((task) => task.title === "Direct recurring child"),
    ).toHaveLength(1);
    expect(
      after.tasks.filter((task) => task.title === "Deep recurring grandchild"),
    ).toHaveLength(1);
  });

  it("allows cascade completion when recurring descendants are completed or trashed", async () => {
    const parent = await createTask({
      title: "Finished recurring parent",
      areaId: 2,
    });
    const recurring = await createTask({
      title: "Finished recurring child",
      areaId: 2,
      parentId: parent.id,
      start: todayIn("Asia/Tokyo"),
      due: todayIn("Asia/Tokyo"),
      recurrenceRule: "day",
    });

    const completedRecurringResponse = await updateTaskStatus(
      recurring.id,
      "COMPLETED",
      recurring.version,
    );
    expect(completedRecurringResponse.status).toBe(200);
    const completedRecurringSnapshot = bootstrapResponseSchema.parse(
      await completedRecurringResponse.json(),
    );
    const nextOccurrence = completedRecurringSnapshot.tasks.find(
      (task) =>
        task.parentId === parent.id &&
        task.id !== recurring.id &&
        task.recurrenceRule,
    );
    if (!nextOccurrence?.version) {
      throw new Error("Next recurring occurrence was not created");
    }

    const trashedOccurrenceResponse = await trashTask(
      nextOccurrence.id,
      nextOccurrence.version,
    );
    expect(trashedOccurrenceResponse.status).toBe(200);
    const beforeCascade = bootstrapResponseSchema.parse(
      await trashedOccurrenceResponse.json(),
    );
    const parentBeforeCascade = taskFromSnapshot(beforeCascade, parent.id);
    const recurringBeforeCascade = taskFromSnapshot(
      beforeCascade,
      recurring.id,
    );
    const trashedOccurrenceBeforeCascade = taskFromSnapshot(
      beforeCascade,
      nextOccurrence.id,
    );

    const completedParentResponse = await SELF.fetch(
      `http://example.com/api/v1/tasks/${parent.id}/status`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "COMPLETED",
          version: parentBeforeCascade.version,
          cascadeDescendants: true,
          descendantVersions: {},
        }),
      },
    );
    expect(completedParentResponse.status).toBe(200);
    const afterCascade = bootstrapResponseSchema.parse(
      await completedParentResponse.json(),
    );

    expect(afterCascade.tasks).toHaveLength(beforeCascade.tasks.length);
    expect(taskFromSnapshot(afterCascade, parent.id).status).toBe("COMPLETED");
    expect(taskFromSnapshot(afterCascade, recurring.id)).toEqual(
      recurringBeforeCascade,
    );
    expect(taskFromSnapshot(afterCascade, nextOccurrence.id)).toEqual(
      trashedOccurrenceBeforeCascade,
    );
  });

  it("keeps parent and child status changes independent after a cascade", async () => {
    const parent = await createTask({ title: "Independent parent", areaId: 2 });
    const child = await createTask({
      title: "Independent child",
      areaId: 2,
      parentId: parent.id,
    });

    const completedChild = await updateTaskStatus(
      child.id,
      "COMPLETED",
      child.version,
    );
    expect(completedChild.status).toBe(200);
    const childSnapshot = bootstrapResponseSchema.parse(
      await completedChild.json(),
    );
    expect(taskFromSnapshot(childSnapshot, parent.id).status).toBe("OPEN");

    const completedParent = await updateTaskStatus(
      parent.id,
      "COMPLETED",
      taskFromSnapshot(childSnapshot, parent.id).version,
    );
    expect(completedParent.status).toBe(200);
    const completedSnapshot = bootstrapResponseSchema.parse(
      await completedParent.json(),
    );
    const completedParentTask = taskFromSnapshot(completedSnapshot, parent.id);
    const reopenedParent = await updateTaskStatus(
      parent.id,
      "OPEN",
      completedParentTask.version,
    );
    expect(reopenedParent.status).toBe(200);
    const reopenedSnapshot = bootstrapResponseSchema.parse(
      await reopenedParent.json(),
    );
    expect(taskFromSnapshot(reopenedSnapshot, parent.id)).toMatchObject({
      status: "OPEN",
      completedAt: null,
    });
    expect(taskFromSnapshot(reopenedSnapshot, child.id)).toMatchObject({
      status: "COMPLETED",
      completedAt: expect.any(String),
    });
  });

  it("reopens completed ancestors with a child and persists the snapshot", async () => {
    const parent = await createTask({ title: "Parent", areaId: 2 });
    const child = await createTask({
      title: "Child",
      areaId: 2,
      parentId: parent.id,
    });
    const completedChild = await updateTaskStatus(
      child.id,
      "COMPLETED",
      child.version,
    );
    const childSnapshot = bootstrapResponseSchema.parse(
      await completedChild.json(),
    );
    const completedParent = await updateTaskStatus(
      parent.id,
      "COMPLETED",
      childSnapshot.tasks.find((task) => task.id === parent.id)?.version ?? 0,
    );
    const parentSnapshot = bootstrapResponseSchema.parse(
      await completedParent.json(),
    );
    const completedChildVersion =
      parentSnapshot.tasks.find((task) => task.id === child.id)?.version ?? 0;

    const reopened = await updateTaskStatus(
      child.id,
      "OPEN",
      completedChildVersion,
      {
        [parent.id]:
          parentSnapshot.tasks.find((task) => task.id === parent.id)?.version ??
          0,
      },
    );

    expect(reopened.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await reopened.json());
    expect(snapshot.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: parent.id,
          status: "OPEN",
          completedAt: null,
        }),
        expect.objectContaining({
          id: child.id,
          status: "OPEN",
          completedAt: null,
        }),
      ]),
    );
  });

  it("rejects reopening a child without the Completed ancestor version", async () => {
    const parent = await createTask({ title: "Parent", areaId: 2 });
    const child = await createTask({
      title: "Child",
      areaId: 2,
      parentId: parent.id,
    });
    const completedChild = await updateTaskStatus(
      child.id,
      "COMPLETED",
      child.version,
    );
    const childSnapshot = bootstrapResponseSchema.parse(
      await completedChild.json(),
    );
    const completedParent = await updateTaskStatus(
      parent.id,
      "COMPLETED",
      childSnapshot.tasks.find((task) => task.id === parent.id)?.version ?? 0,
    );
    const parentSnapshot = bootstrapResponseSchema.parse(
      await completedParent.json(),
    );
    const completedChildVersion =
      parentSnapshot.tasks.find((task) => task.id === child.id)?.version ?? 0;

    const response = await updateTaskStatus(
      child.id,
      "OPEN",
      completedChildVersion,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "TASK_VERSION_CONFLICT",
        message: "Task version does not match",
      },
    });
  });

  it("rejects a status change made with an outdated Task version", async () => {
    const task = await createTask({ title: "Versioned", areaId: null });

    const response = await updateTaskStatus(
      task.id,
      "COMPLETED",
      task.version + 1,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "TASK_VERSION_CONFLICT",
        message: "Task version does not match",
      },
    });
  });
});

describe("Trash API", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("persists a Task cascade and restores only records from the same Trash operation", async () => {
    const parent = await createTask({ title: "Parent", areaId: 2 });
    const cascadedChild = await createTask({
      title: "Cascaded child",
      areaId: 2,
      parentId: parent.id,
    });
    const separatelyTrashedChild = await createTask({
      title: "Separately trashed child",
      areaId: 2,
      parentId: parent.id,
    });

    const separatelyTrashed = await trashTask(
      separatelyTrashedChild.id,
      separatelyTrashedChild.version,
    );
    const separatelyTrashedSnapshot = bootstrapResponseSchema.parse(
      await separatelyTrashed.json(),
    );
    const currentParent = taskFromSnapshot(
      separatelyTrashedSnapshot,
      parent.id,
    );

    const trashed = await trashTask(parent.id, currentParent.version);
    expect(trashed.status).toBe(200);
    const trashedSnapshot = bootstrapResponseSchema.parse(await trashed.json());
    const trashedParent = taskFromSnapshot(trashedSnapshot, parent.id);
    const trashedCascadeChild = taskFromSnapshot(
      trashedSnapshot,
      cascadedChild.id,
    );
    const separatelyTrashedTask = taskFromSnapshot(
      trashedSnapshot,
      separatelyTrashedChild.id,
    );
    expect(trashedParent.trashOperationId).toEqual(expect.any(String));
    expect(trashedCascadeChild.trashOperationId).toBe(
      trashedParent.trashOperationId,
    );
    expect(separatelyTrashedTask.trashOperationId).not.toBe(
      trashedParent.trashOperationId,
    );

    const restored = await restoreTask(parent.id, trashedParent.version);
    expect(restored.status).toBe(200);
    const restoredSnapshot = bootstrapResponseSchema.parse(
      await restored.json(),
    );
    expect(taskFromSnapshot(restoredSnapshot, parent.id)).toMatchObject({
      trashedAt: null,
      trashOperationId: null,
    });
    expect(taskFromSnapshot(restoredSnapshot, cascadedChild.id)).toMatchObject({
      trashedAt: null,
      trashOperationId: null,
    });
    expect(
      taskFromSnapshot(restoredSnapshot, separatelyTrashedChild.id),
    ).toMatchObject({
      trashedAt: expect.any(String),
      trashOperationId: expect.any(String),
    });

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reload.json())).toEqual(
      restoredSnapshot,
    );
  });

  it("persists Trash and restoration of an empty Area", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Empty Area", color: "gray" }),
    });
    expect(created.status).toBe(201);
    const areaId = bootstrapResponseSchema
      .parse(await created.json())
      .areas.find((area) => area.name === "Empty Area")?.id;
    if (areaId === undefined) throw new Error("Empty Area was not created");

    const trashed = await SELF.fetch(
      `http://example.com/api/v1/areas/${areaId}`,
      { method: "DELETE" },
    );
    expect(trashed.status).toBe(200);

    const restored = await SELF.fetch(
      `http://example.com/api/v1/areas/${areaId}/restore`,
      { method: "POST" },
    );
    expect(restored.status).toBe(200);
    const snapshot = bootstrapResponseSchema.parse(await restored.json());
    expect(snapshot.areas).toContainEqual(
      expect.objectContaining({ id: areaId, trashedAt: null }),
    );

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reload.json())).toEqual(
      snapshot,
    );
  });

  it("rejects a stale Task Trash request without changing the snapshot", async () => {
    const task = await createTask({ title: "Stale Trash", areaId: 2 });

    const rejected = await trashTask(task.id, task.version + 1);
    expect(rejected.status).toBe(409);

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(
      taskFromSnapshot(
        bootstrapResponseSchema.parse(await reload.json()),
        task.id,
      ),
    ).toMatchObject({
      trashedAt: null,
      trashOperationId: null,
    });
  });
});

describe("scheduled Trash cleanup", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("permanently deletes Task and Area records older than the configured retention period", async () => {
    const expiredTask = await createTask({
      title: "Expired Trash Task",
      areaId: null,
    });
    const retainedTask = await createTask({
      title: "Retained Trash Task",
      areaId: null,
    });
    expect((await trashTask(expiredTask.id, expiredTask.version)).status).toBe(
      200,
    );
    expect(
      (await trashTask(retainedTask.id, retainedTask.version)).status,
    ).toBe(200);
    const createdArea = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Expired Trash Area", color: "gray" }),
    });
    const area = bootstrapResponseSchema
      .parse(await createdArea.json())
      .areas.find((candidate) => candidate.name === "Expired Trash Area");
    if (!area) throw new Error("Trash fixture Area was not created");
    const createdRetainedArea = await SELF.fetch(
      "http://example.com/api/v1/areas",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Retained Trash Area", color: "gray" }),
      },
    );
    const retainedArea = bootstrapResponseSchema
      .parse(await createdRetainedArea.json())
      .areas.find((candidate) => candidate.name === "Retained Trash Area");
    if (!retainedArea) {
      throw new Error("Retained Trash fixture Area was not created");
    }
    const remainingAreaViewResponse = await SELF.fetch(
      "http://example.com/api/v1/views",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Remaining Area View",
          allTasks: false,
          conditions: [
            {
              field: "area",
              operator: "isAnyOf",
              value: [area.name, retainedArea.name],
            },
          ],
        }),
      },
    );
    expect(remainingAreaViewResponse.status).toBe(201);
    const allTasksViewResponse = await SELF.fetch(
      "http://example.com/api/v1/views",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Expired Area View",
          allTasks: false,
          conditions: [
            {
              field: "area",
              operator: "isAnyOf",
              value: [area.name],
            },
          ],
        }),
      },
    );
    expect(allTasksViewResponse.status).toBe(201);
    expect(
      (
        await SELF.fetch(`http://example.com/api/v1/areas/${area.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await SELF.fetch(`http://example.com/api/v1/areas/${retainedArea.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE owner_settings SET trash_retention_days = 7 WHERE id = 1",
      ),
      env.DB.prepare("UPDATE tasks SET trashed_at = ? WHERE id = ?").bind(
        "2026-07-22T00:00:00.000Z",
        expiredTask.id,
      ),
      env.DB.prepare("UPDATE tasks SET trashed_at = ? WHERE id = ?").bind(
        "2026-07-24T00:00:00.000Z",
        retainedTask.id,
      ),
      env.DB.prepare("UPDATE areas SET trashed_at = ? WHERE id = ?").bind(
        "2026-07-22T00:00:00.000Z",
        area.id,
      ),
      env.DB.prepare("UPDATE areas SET trashed_at = ? WHERE id = ?").bind(
        "2026-07-23T00:00:00.000Z",
        retainedArea.id,
      ),
    ]);

    const context = createExecutionContext();
    await worker.scheduled(
      createScheduledController({
        cron: "0 0 * * *",
        scheduledTime: new Date("2026-07-30T00:00:00.000Z"),
      }),
      env,
      context,
    );
    await waitOnExecutionContext(context);

    const snapshot = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(snapshot.tasks).not.toContainEqual(
      expect.objectContaining({ id: expiredTask.id }),
    );
    expect(snapshot.tasks).toContainEqual(
      expect.objectContaining({
        id: retainedTask.id,
        trashedAt: expect.any(String),
      }),
    );
    expect(snapshot.areas).not.toContainEqual(
      expect.objectContaining({ id: area.id }),
    );
    expect(snapshot.areas).toContainEqual(
      expect.objectContaining({
        id: retainedArea.id,
        trashedAt: "2026-07-23T00:00:00.000Z",
      }),
    );
    expect(
      snapshot.views.find((view) => view.name === "Remaining Area View"),
    ).toMatchObject({
      allTasks: false,
      conditions: [
        {
          field: "area",
          operator: "isAnyOf",
          value: [area.name, retainedArea.name],
        },
      ],
      version: 1,
    });
    expect(
      snapshot.views.find((view) => view.name === "Expired Area View"),
    ).toMatchObject({
      allTasks: false,
      conditions: [
        {
          field: "area",
          operator: "isAnyOf",
          value: [area.name],
        },
      ],
      version: 1,
    });
    const reloaded = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    expect(reloaded.views).toEqual(snapshot.views);

    const recreatedAreaResponse = await SELF.fetch(
      "http://example.com/api/v1/areas",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: area.name, color: "gray" }),
      },
    );
    const recreatedArea = bootstrapResponseSchema
      .parse(await recreatedAreaResponse.json())
      .areas.find((candidate) => candidate.name === area.name);
    if (!recreatedArea) throw new Error("Area was not recreated");
    await createTask({
      title: "Recreated Area result",
      areaId: recreatedArea.id,
    });
    const expiredView = reloaded.views.find(
      (view) => view.name === "Expired Area View",
    );
    if (!expiredView) throw new Error("Expired Area View was not reloaded");

    const recreatedResult = taskSearchResponseSchema.parse(
      await (
        await SELF.fetch(
          `http://example.com/api/v1/views/${expiredView.id}/tasks`,
        )
      ).json(),
    );
    expect(recreatedResult.tasks.map((task) => task.title)).toEqual([
      "Recreated Area result",
    ]);
  });
});

describe("Settings API", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await clearTaskFixtures();
    await resetSettingsFixtures();
  });

  it("creates an Area and persists it in the bootstrap snapshot", async () => {
    const response = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Finance", color: "green" }),
    });

    expect(response.status).toBe(201);
    const snapshot = bootstrapResponseSchema.parse(await response.json());
    expect(snapshot.areas).toContainEqual({
      id: expect.any(Number),
      name: "Finance",
      color: "green",
      position: expect.any(Number),
      isSystemManaged: false,
      trashedAt: null,
    });

    const reload = await SELF.fetch("http://example.com/api/v1/bootstrap");
    expect(bootstrapResponseSchema.parse(await reload.json()).areas).toEqual(
      snapshot.areas,
    );
  });

  it("rejects commas in Area names for create and rename", async () => {
    const invalidCreate = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Work, Personal", color: "green" }),
    });
    expect(invalidCreate.status).toBe(400);

    const invalidRename = await SELF.fetch(
      "http://example.com/api/v1/areas/2",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Work, Personal", color: "purple" }),
      },
    );
    expect(invalidRename.status).toBe(400);
  });

  it("rejects Owner Area management operations for the system-managed Inbox", async () => {
    const snapshot = bootstrapResponseSchema.parse(
      await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
    );
    const inbox = snapshot.areas.find((area) => area.isSystemManaged);
    if (!inbox) throw new Error("System-managed Inbox was not initialized");

    const [update, reorder, trash, restore] = await Promise.all([
      SELF.fetch(`http://example.com/api/v1/areas/${inbox.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed Inbox", color: "blue" }),
      }),
      SELF.fetch("http://example.com/api/v1/areas/order", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: [inbox.id, ...ownerAreaFixtures.map((area) => area.id)],
        }),
      }),
      SELF.fetch(`http://example.com/api/v1/areas/${inbox.id}`, {
        method: "DELETE",
      }),
      SELF.fetch(`http://example.com/api/v1/areas/${inbox.id}/restore`, {
        method: "POST",
      }),
    ]);

    expect(update.status).toBe(404);
    expect(reorder.status).toBe(422);
    expect(trash.status).toBe(404);
    expect(restore.status).toBe(404);
    expect(
      bootstrapResponseSchema.parse(
        await (await SELF.fetch("http://example.com/api/v1/bootstrap")).json(),
      ).areas,
    ).toContainEqual(inbox);
  });

  it("persists Area, Owner settings, and Tag management while rejecting Area Trash with Tasks", async () => {
    const created = await SELF.fetch("http://example.com/api/v1/areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Finance", color: "green" }),
    });
    const areaId = bootstrapResponseSchema
      .parse(await created.json())
      .areas.find((area) => area.name === "Finance")?.id;
    if (!areaId) throw new Error("Finance Area was not created");

    const updatedArea = await SELF.fetch(
      `http://example.com/api/v1/areas/${areaId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Budget", color: "orange" }),
      },
    );
    expect(updatedArea.status).toBe(200);

    const reordered = await SELF.fetch(
      "http://example.com/api/v1/areas/order",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: [areaId, ...ownerAreaFixtures.map((area) => area.id)],
        }),
      },
    );
    const reorderedSnapshot = bootstrapResponseSchema.parse(
      await reordered.json(),
    );
    expect(reorderedSnapshot.areas.slice(0, 2)).toEqual([
      expect.objectContaining({ id: areaId, position: 1 }),
      expect.objectContaining({ id: ownerAreaFixtures[0].id, position: 2 }),
    ]);

    const ownerSettings = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayLanguage: "en",
          timeZone: "UTC",
          weekStartsOn: 1,
          trashRetentionDays: 30,
          version: 1,
        }),
      },
    );
    expect(
      bootstrapResponseSchema.parse(await ownerSettings.json()).ownerSettings,
    ).toEqual({
      displayLanguage: "en",
      timeZone: "UTC",
      weekStartsOn: 1,
      trashRetentionDays: 30,
      version: 2,
    });

    const invalidTimeZone = await SELF.fetch(
      "http://example.com/api/v1/owner-settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZone: "Not/A_Timezone", weekStartsOn: 1 }),
      },
    );
    expect(invalidTimeZone.status).toBe(400);

    const taggedTask = await createTask({
      title: "Tagged",
      areaId: workerAreaIds.aiIt,
    });
    await env.DB.prepare("INSERT INTO tags (name) VALUES ('finance')").run();
    await env.DB.prepare("INSERT INTO tags (name) VALUES ('unused')").run();
    await env.DB.prepare(
      "INSERT INTO task_tags (task_id, tag_id) SELECT ?, id FROM tags WHERE name = 'finance'",
    )
      .bind(taggedTask.id)
      .run();
    const financeTag = await env.DB.prepare(
      "SELECT id FROM tags WHERE name = 'finance'",
    ).first<{ id: number }>();
    const unusedTag = await env.DB.prepare(
      "SELECT id FROM tags WHERE name = 'unused'",
    ).first<{ id: number }>();
    if (!financeTag || !unusedTag)
      throw new Error("Tag fixtures were not created");

    const renamedTag = await SELF.fetch(
      `http://example.com/api/v1/tags/${financeTag.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Budget" }),
      },
    );
    const renamedTagSnapshot = bootstrapResponseSchema.parse(
      await renamedTag.json(),
    );
    expect(renamedTagSnapshot.tasks).toContainEqual(
      expect.objectContaining({
        id: taggedTask.id,
        tags: [{ id: financeTag.id, name: "budget" }],
      }),
    );
    expect(renamedTagSnapshot.tags).toEqual([
      { id: financeTag.id, name: "budget" },
      { id: unusedTag.id, name: "unused" },
    ]);

    const deletedTag = await SELF.fetch(
      `http://example.com/api/v1/tags/${financeTag.id}`,
      {
        method: "DELETE",
      },
    );
    expect(
      bootstrapResponseSchema.parse(await deletedTag.json()).tasks,
    ).toContainEqual(expect.objectContaining({ id: taggedTask.id, tags: [] }));

    const rejectedTrash = await SELF.fetch(
      "http://example.com/api/v1/areas/1",
      {
        method: "DELETE",
      },
    );
    expect(rejectedTrash.status).toBe(409);
    expect(await rejectedTrash.json()).toEqual({
      error: {
        code: "AREA_HAS_TASKS",
        message: "An Area with Tasks cannot be moved to Trash.",
      },
    });

    const invalidArea = await SELF.fetch(
      "http://example.com/api/v1/areas/nope",
      { method: "DELETE" },
    );
    expect(invalidArea.status).toBe(400);

    const trashed = await SELF.fetch(
      `http://example.com/api/v1/areas/${areaId}`,
      { method: "DELETE" },
    );
    expect(
      bootstrapResponseSchema.parse(await trashed.json()).areas,
    ).toContainEqual(
      expect.objectContaining({ id: areaId, trashedAt: expect.any(String) }),
    );

    const reorderedAfterTrash = await SELF.fetch(
      "http://example.com/api/v1/areas/order",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: ownerAreaFixtures.map((area) => area.id),
        }),
      },
    );
    expect(reorderedAfterTrash.status).toBe(200);
    expect(
      bootstrapResponseSchema.parse(await reorderedAfterTrash.json()).areas,
    ).toContainEqual(
      expect.objectContaining({
        id: ownerAreaFixtures[0].id,
        position: 2,
      }),
    );
  });
});

async function createTask({
  title,
  areaId,
  parentId,
  start = null,
  due = null,
  recurrenceRule = null,
}: {
  title: string;
  areaId: number | null;
  parentId?: string;
  start?: string | null;
  due?: string | null;
  recurrenceRule?: string | null;
}) {
  const response = await SELF.fetch("http://example.com/api/v1/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      areaId,
      ...(parentId ? { parentId } : {}),
      description: "",
      start,
      due,
      tagIds: [],
      newTagNames: [],
      ...(recurrenceRule ? { recurrenceRule } : {}),
    }),
  });
  expect(response.status).toBe(201);
  const snapshot = bootstrapResponseSchema.parse(await response.json());
  const task = snapshot.tasks.find((candidate) => candidate.title === title);
  if (!task?.version) throw new Error("Created Task has no version");
  return { ...task, version: task.version };
}

function moveTaskRequest(input: {
  taskId: string;
  taskVersion: number;
  targetTaskId: string;
  targetTaskVersion: number;
  position: "before" | "after" | "as-last-child";
  anchorTaskId?: string;
  anchorTaskVersion?: number;
  anchorPosition?: "before" | "after" | "append";
}) {
  return SELF.fetch("http://example.com/api/v1/tasks/move", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

function taskUpdatePayload(
  task: {
    title: string;
    description: string;
    workNotes: string;
    start: string | null;
    due: string | null;
    tags: { id: number; name: string }[];
    version?: number;
  },
  areaId: number,
  parentId?: string,
  version = task.version ?? 1,
) {
  return {
    title: task.title,
    description: task.description,
    workNotes: task.workNotes,
    start: task.start,
    due: task.due,
    tagIds: task.tags.map((tag) => tag.id),
    newTagNames: [],
    version,
    areaId,
    ...(parentId ? { parentId } : {}),
  };
}

function updateTaskStatus(
  id: string,
  status: "OPEN" | "COMPLETED",
  version: number,
  ancestorVersions: Record<string, number> = {},
) {
  return SELF.fetch(`http://example.com/api/v1/tasks/${id}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, version, ancestorVersions }),
  });
}

async function createCompletedDailyRecurringTask() {
  const start = todayIn("Asia/Tokyo");
  const created = await SELF.fetch("http://example.com/api/v1/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Daily review",
      areaId: 2,
      description: "",
      start,
      due: start,
      tags: [],
      recurrenceRule: "day",
    }),
  });
  expect(created.status).toBe(201);
  const original = bootstrapResponseSchema
    .parse(await created.json())
    .tasks.find((task) => task.title === "Daily review");
  if (!original?.version) throw new Error("Recurring Task was not created");

  const completed = await updateTaskStatus(
    original.id,
    "COMPLETED",
    original.version,
  );
  expect(completed.status).toBe(200);
  const snapshot = bootstrapResponseSchema.parse(await completed.json());
  const completedOriginal = taskFromSnapshot(snapshot, original.id);
  const next = snapshot.tasks.find((task) => task.id !== original.id);
  if (!next?.version) throw new Error("Next occurrence was not created");
  return {
    original,
    completedOriginal,
    next: { ...next, version: next.version },
  };
}

function trashTask(id: string, version: number) {
  return SELF.fetch(`http://example.com/api/v1/tasks/${id}/trash`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version }),
  });
}

function restoreTask(id: string, version: number) {
  return SELF.fetch(`http://example.com/api/v1/tasks/${id}/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version }),
  });
}

function taskFromSnapshot(
  snapshot: ReturnType<typeof bootstrapResponseSchema.parse>,
  id: string,
) {
  const task = snapshot.tasks.find((candidate) => candidate.id === id);
  if (!task?.version) throw new Error(`Task ${id} was not found`);
  return { ...task, version: task.version };
}

function todayIn(timeZone: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== "literal") parts[part.type] = part.value;
      return parts;
    }, {});
  return `${date.year}-${date.month}-${date.day}`;
}

function addDaysToDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function clearTaskFixtures() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM task_tags"),
    env.DB.prepare("DELETE FROM tags"),
    env.DB.prepare("DELETE FROM tasks"),
  ]);
}

async function resetDatabaseToFreshMigrations() {
  await env.DB.exec(`
    DROP TABLE IF EXISTS task_tags;
    DROP TABLE IF EXISTS task_manual_orders;
    DROP TABLE IF EXISTS today_task_orders;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS views;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS areas;
    DROP TABLE IF EXISTS owner_settings;
    DROP TABLE IF EXISTS d1_migrations;
  `);
}

async function resetSettingsFixtures() {
  await env.DB.batch([
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
    env.DB.prepare(
      `UPDATE owner_settings
       SET display_language = 'en', time_zone = 'Asia/Tokyo', week_starts_on = 0,
           trash_retention_days = 30, version = 1
      WHERE id = 1`,
    ),
  ]);
}
