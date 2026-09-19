import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { titleSearchResponseSchema } from "../shared/api-schema";
import { d1Migrations } from "./test/d1-migrations";

describe("GET /api/v1/tasks/search", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, d1Migrations);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM task_tags"),
      env.DB.prepare("DELETE FROM tags"),
      env.DB.prepare("DELETE FROM tasks"),
    ]);
  });

  it("matches only Title case-insensitively and excludes Trash", async () => {
    await seedTask({ id: "title-match", title: "Needle in the Title" });
    await seedTask({
      id: "description-only",
      title: "Description Task",
      description: "needle in the description",
    });
    await seedTask({
      id: "work-notes-only",
      title: "Work Notes Task",
      workNotes: "needle in the work notes",
    });
    await seedTask({
      id: "trashed-title-match",
      title: "Needle in Trash",
      trashedAt: "2026-08-05T00:00:00.000Z",
    });

    const response = await search("  nEeDlE  ");

    expect(response.tasks.map((task) => task.id)).toEqual(["title-match"]);
  });

  it("treats backslash, percent, and underscore as literal Title text", async () => {
    await seedTask({
      id: "literal-backslash",
      title: String.raw`Path \ Draft`,
    });
    await seedTask({ id: "literal-percent", title: "100% ready" });
    await seedTask({ id: "wildcard-percent", title: "1000 ready" });
    await seedTask({ id: "literal-underscore", title: "task_name ready" });
    await seedTask({ id: "wildcard-underscore", title: "taskXname ready" });

    expect((await search("\\")).tasks.map((task) => task.id)).toEqual([
      "literal-backslash",
    ]);
    expect((await search("100%")).tasks.map((task) => task.id)).toEqual([
      "literal-percent",
    ]);
    expect((await search("task_name")).tasks.map((task) => task.id)).toEqual([
      "literal-underscore",
    ]);
  });

  it("returns at most 100 Tasks in Updated-descending order without pagination", async () => {
    for (let index = 0; index < 101; index += 1) {
      await seedTask({
        id: `result-${String(index).padStart(3, "0")}`,
        title: `matching Task ${index}`,
        updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
      });
    }

    const rawResponse = await SELF.fetch(
      "http://example.com/api/v1/tasks/search?q=matching",
    );
    expect(rawResponse.status).toBe(200);
    const rawBody = await rawResponse.json();
    const response = titleSearchResponseSchema.parse(rawBody);

    expect(response.tasks).toHaveLength(100);
    expect(response.tasks[0]?.id).toBe("result-100");
    expect(response.tasks.at(-1)?.id).toBe("result-001");
    expect(rawBody).not.toHaveProperty("nextCursor");
  });

  it("rejects empty or legacy detailed Search queries", async () => {
    expect(
      (await SELF.fetch("http://example.com/api/v1/tasks/search")).status,
    ).toBe(400);
    expect(
      (
        await SELF.fetch(
          "http://example.com/api/v1/tasks/search?q=%20%20&status=OPEN",
        )
      ).status,
    ).toBe(400);
  });
});

async function search(query: string) {
  const response = await SELF.fetch(
    `http://example.com/api/v1/tasks/search?q=${encodeURIComponent(query)}`,
  );
  expect(response.status).toBe(200);
  return titleSearchResponseSchema.parse(await response.json());
}

async function seedTask({
  id,
  title,
  description = "",
  workNotes = "",
  status = "OPEN",
  trashedAt = null,
  updatedAt = "2026-08-05T00:00:00.000Z",
}: {
  id: string;
  title: string;
  description?: string;
  workNotes?: string;
  status?: "OPEN" | "COMPLETED";
  trashedAt?: string | null;
  updatedAt?: string;
}) {
  await env.DB.prepare(
    `INSERT INTO tasks (
       id, title, description, work_notes, status, area_id, parent_task_id,
       start, due, completed_at, updated_at, trashed_at, trash_operation_id,
       recurrence_rule, version, created_at
     ) VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, 1, ?)`,
  )
    .bind(
      id,
      title,
      description,
      workNotes,
      status,
      updatedAt,
      trashedAt,
      updatedAt,
    )
    .run();
}
