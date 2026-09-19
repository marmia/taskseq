import type { PropsWithChildren } from "react";
import type { ActionFunctionArgs } from "react-router";
import type { BootstrapResponse } from "../../shared/api-schema";
import { BootstrapProvider } from "../bootstrap-state";
import {
  createTestAreas,
  initialTags,
  initialTasks,
  testAreaIds,
} from "../mock-data";
import { AppSettingsProvider as ProductionAppSettingsProvider } from "../settings-store";

export const testSnapshot: BootstrapResponse = {
  areas: createTestAreas(),
  ownerSettings: {
    displayLanguage: "en",
    timeZone: "Asia/Tokyo",
    weekStartsOn: 1 as const,
    trashRetentionDays: 30,
    version: 1,
  },
  tags: [...initialTags, { id: initialTags.length + 1, name: "unused" }],
  tasks: initialTasks,
  areaTaskOrders: {},
  inboxOrder: [],
  todayOrders: {},
  views: [],
};

export { testAreaIds };

export function AppSettingsProvider({
  children,
  initialSnapshot = testSnapshot,
}: PropsWithChildren<{ initialSnapshot?: BootstrapResponse }>) {
  return (
    <BootstrapProvider initialSnapshot={initialSnapshot}>
      <ProductionAppSettingsProvider>{children}</ProductionAppSettingsProvider>
    </BootstrapProvider>
  );
}

export async function taskMutationTestAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const payload = JSON.parse(String(formData.get("payload")));
  const payloadTags = tagsFromPayload(payload);
  const snapshotTags = [...testSnapshot.tags, ...payloadTags].filter(
    (tag, index, all) =>
      all.findIndex((candidate) => candidate.id === tag.id) === index,
  );
  if (formData.get("operation") === "create") {
    const areaName =
      testSnapshot.areas.find((area) => area.id === payload.areaId)?.name ??
      "Inbox";
    const parent = testSnapshot.tasks.find(
      (task) => task.id === payload.parentId,
    );
    return {
      snapshot: {
        ...testSnapshot,
        tags: snapshotTags,
        tasks: [
          ...testSnapshot.tasks,
          {
            id: "created-task",
            title: payload.title,
            path: parent
              ? [...parent.path, payload.title]
              : [areaName, payload.title],
            areaId: payload.areaId,
            ...(parent ? { parentId: parent.id } : {}),
            status: "OPEN" as const,
            start: payload.start,
            due: payload.due,
            completedAt: null,
            updatedAt: "2026-08-05T00:00:00.000Z",
            tags: payloadTags,
            description: payload.description,
            workNotes: "",
            version: 1,
          },
        ],
      },
    };
  }

  const previous = testSnapshot.tasks.find((task) => task.id === payload.id);
  const destinationAreaId =
    typeof payload.areaId === "number" ? payload.areaId : previous?.areaId;
  const areaChanged =
    destinationAreaId !== undefined && previous?.areaId !== destinationAreaId;
  const taskPathChanged =
    payload.parentId !== undefined && payload.parentId !== previous?.parentId;
  const locationChanged = areaChanged || taskPathChanged;
  const destinationAreaName =
    testSnapshot.areas.find((area) => area.id === destinationAreaId)?.name ??
    "Inbox";
  const destinationParent =
    locationChanged && typeof payload.parentId === "string"
      ? testSnapshot.tasks.find((task) => task.id === payload.parentId)
      : undefined;
  const destinationPath = destinationParent
    ? [...destinationParent.path, payload.title]
    : [destinationAreaName, payload.title];
  const renamedPathIndex = previous ? previous.path.length - 1 : -1;
  const previousPathLength = previous?.path.length ?? 1;
  const descendantIds = new Set([payload.id]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const task of testSnapshot.tasks) {
      if (
        task.parentId &&
        descendantIds.has(task.parentId) &&
        !descendantIds.has(task.id)
      ) {
        descendantIds.add(task.id);
        foundDescendant = true;
      }
    }
  }

  return {
    snapshot: {
      ...testSnapshot,
      tags: snapshotTags,
      tasks: testSnapshot.tasks.map((task) => {
        if (task.id === payload.id) {
          if (locationChanged) {
            const {
              areaId: _areaId,
              parentId: _payloadParentId,
              id: _id,
              tagIds: _tagIds,
              newTagNames: _newTagNames,
              ...updates
            } = payload;
            const { parentId: _taskParentId, ...taskWithoutParent } = task;
            return {
              ...taskWithoutParent,
              ...updates,
              tags: payloadTags,
              areaId: destinationAreaId,
              ...(destinationParent ? { parentId: destinationParent.id } : {}),
              path: destinationPath,
              version: (task.version ?? 0) + 1,
            };
          }
          const {
            id: _id,
            tagIds: _tagIds,
            newTagNames: _newTagNames,
            ...updates
          } = payload;
          return {
            ...task,
            ...updates,
            tags: payloadTags,
            path: [...task.path.slice(0, -1), payload.title],
            version: (task.version ?? 0) + 1,
          };
        }
        if (!descendantIds.has(task.id)) return task;
        if (locationChanged) {
          return {
            ...task,
            ...(areaChanged ? { areaId: destinationAreaId } : {}),
            path: [...destinationPath, ...task.path.slice(previousPathLength)],
            ...(areaChanged ? { version: (task.version ?? 0) + 1 } : {}),
          };
        }
        return {
          ...task,
          path: task.path.map((segment, index) =>
            index === renamedPathIndex ? payload.title : segment,
          ),
        };
      }),
    },
  };
}

function tagsFromPayload(payload: {
  tagIds?: number[];
  newTagNames?: string[];
}) {
  return [
    ...testSnapshot.tags.filter((tag) => payload.tagIds?.includes(tag.id)),
    ...(payload.newTagNames ?? []).map((name, index) => ({
      id: testSnapshot.tags.length + index + 1,
      name,
    })),
  ];
}
