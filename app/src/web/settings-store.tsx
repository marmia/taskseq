import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import { z } from "zod";
import type { Area, Tag } from "../domain/task";
import {
  type BootstrapResponse,
  type DisplayLanguage,
  ownerTimeZoneOptions,
  ownerTimeZoneSchema,
  type View,
  type ViewCreateRequest,
  type ViewUpdateRequest,
} from "../shared/api-schema";
import * as api from "./api-client";
import { useBootstrap } from "./bootstrap-state";
import {
  OwnerSettingsConflictError,
  OwnerSettingsConflictReloadError,
} from "./settings-mutation-errors";

export const weekDayOptions = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export const weekStartsOnSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export type WeekStartsOn = z.infer<typeof weekStartsOnSchema>;

export { ownerTimeZoneOptions, ownerTimeZoneSchema };

export function activeAreasInPositionOrder(areas: Area[]) {
  return areas
    .filter((area) => !area.trashedAt && !area.isSystemManaged)
    .sort((left, right) => left.position - right.position);
}

export function systemManagedInbox(areas: Area[]) {
  return areas.find((area) => area.isSystemManaged && !area.trashedAt);
}

type AppSettings = {
  areas: Area[];
  tags: Tag[];
  views: View[];
  displayLanguage: DisplayLanguage;
  setAreas: Dispatch<SetStateAction<Area[]>>;
  weekStartsOn: WeekStartsOn;
  setWeekStartsOn: (day: WeekStartsOn) => void;
  ownerTimeZone: string;
  setOwnerTimeZone: (timeZone: string) => void;
  trashRetentionDays: number;
  ownerSettingsVersion: number;
  createArea: (input: {
    name: string;
    color: Area["color"];
  }) => Promise<BootstrapResponse>;
  updateArea: (
    id: number,
    input: { name: string; color: Area["color"] },
  ) => Promise<BootstrapResponse>;
  reorderAreas: (ids: number[]) => Promise<BootstrapResponse>;
  trashArea: (id: number) => Promise<BootstrapResponse>;
  restoreArea: (id: number) => Promise<BootstrapResponse>;
  updateOwnerSettings: (input: {
    displayLanguage: DisplayLanguage;
    timeZone: string;
    weekStartsOn: WeekStartsOn;
    trashRetentionDays: number;
    version: number;
  }) => Promise<BootstrapResponse>;
  renameTag: (id: number, nextName: string) => Promise<BootstrapResponse>;
  deleteTag: (id: number) => Promise<BootstrapResponse>;
  createView: (input: ViewCreateRequest) => Promise<BootstrapResponse>;
  updateView: (
    id: string,
    input: ViewUpdateRequest,
  ) => Promise<BootstrapResponse>;
  deleteView: (id: string) => Promise<BootstrapResponse>;
};

type ApplySnapshotOptions = {
  reloadOnConflict?: boolean;
};

type ViewUpdateQueueResult = {
  snapshot: BootstrapResponse;
  error?: unknown;
};

const AppSettingsContext = createContext<AppSettings | null>(null);

export function AppSettingsProvider({ children }: PropsWithChildren) {
  const { snapshot, replaceSnapshot, isInitialSnapshot } = useBootstrap();
  const viewUpdateQueues = useRef(
    new Map<string, Promise<ViewUpdateQueueResult>>(),
  );
  const applySnapshot = useCallback(
    (
      optimisticSnapshot: typeof snapshot,
      request: () => Promise<typeof snapshot>,
      options?: ApplySnapshotOptions,
    ) => {
      replaceSnapshot(optimisticSnapshot);
      if (isInitialSnapshot) return Promise.resolve(optimisticSnapshot);
      return request()
        .then((serverSnapshot) => {
          replaceSnapshot(serverSnapshot);
          return serverSnapshot;
        })
        .catch(async (error: unknown) => {
          if (
            options?.reloadOnConflict &&
            error instanceof api.ApiRequestError &&
            error.status === 409
          ) {
            const latestSnapshot = await api.loadBootstrap().catch(() => {
              replaceSnapshot(snapshot);
              throw new OwnerSettingsConflictReloadError();
            });
            replaceSnapshot(latestSnapshot);
            throw new OwnerSettingsConflictError(
              error,
              latestSnapshot.ownerSettings.displayLanguage,
            );
          } else {
            replaceSnapshot(snapshot);
          }
          throw error;
        });
    },
    [isInitialSnapshot, replaceSnapshot, snapshot],
  );
  const applyMutationSnapshot = useCallback(
    (
      nextSnapshot: typeof snapshot,
      request: () => Promise<typeof snapshot>,
    ) => {
      if (isInitialSnapshot) {
        replaceSnapshot(nextSnapshot);
        return Promise.resolve(nextSnapshot);
      }
      return request().then((serverSnapshot) => {
        replaceSnapshot(serverSnapshot);
        return serverSnapshot;
      });
    },
    [isInitialSnapshot, replaceSnapshot],
  );
  const updateSnapshotAreas: Dispatch<SetStateAction<Area[]>> = useCallback(
    (next) =>
      replaceSnapshot({
        ...snapshot,
        areas: typeof next === "function" ? next(snapshot.areas) : next,
      }),
    [replaceSnapshot, snapshot],
  );
  const updateView = useCallback(
    (id: string, input: ViewUpdateRequest) => {
      const previous =
        viewUpdateQueues.current.get(id) ?? Promise.resolve({ snapshot });
      const optimisticSnapshot = {
        ...snapshot,
        views: snapshot.views.map((view) =>
          view.id === id
            ? {
                ...view,
                ...input,
                version: view.version + 1,
                updatedAt: new Date().toISOString(),
              }
            : view,
        ),
      };
      replaceSnapshot(optimisticSnapshot);

      const operation = previous.then(async ({ snapshot: baseSnapshot }) => {
        const baseView = baseSnapshot.views.find((view) => view.id === id);
        const requestInput = {
          ...input,
          version: baseView?.version ?? input.version,
        };
        const nextSnapshot = {
          ...baseSnapshot,
          views: baseSnapshot.views.map((view) =>
            view.id === id
              ? {
                  ...view,
                  ...requestInput,
                  version: requestInput.version + 1,
                  updatedAt: new Date().toISOString(),
                }
              : view,
          ),
        };
        replaceSnapshot(nextSnapshot);
        if (isInitialSnapshot) return { snapshot: nextSnapshot };

        try {
          const serverSnapshot = await api.updateView(id, requestInput);
          replaceSnapshot(serverSnapshot);
          return { snapshot: serverSnapshot };
        } catch (error: unknown) {
          if (error instanceof api.ApiRequestError && error.status === 409) {
            try {
              const latestSnapshot = await api.loadBootstrap();
              replaceSnapshot(latestSnapshot);
              return { snapshot: latestSnapshot, error };
            } catch {
              replaceSnapshot(baseSnapshot);
              return {
                snapshot: baseSnapshot,
                error: new Error("View conflict reload failed"),
              };
            }
          }
          replaceSnapshot(baseSnapshot);
          return { snapshot: baseSnapshot, error };
        }
      });
      const trackedOperation = operation.finally(() => {
        if (viewUpdateQueues.current.get(id) === trackedOperation) {
          viewUpdateQueues.current.delete(id);
        }
      });
      viewUpdateQueues.current.set(id, trackedOperation);
      return operation.then(({ snapshot: resultSnapshot, error }) => {
        if (error !== undefined) throw error;
        return resultSnapshot;
      });
    },
    [isInitialSnapshot, replaceSnapshot, snapshot],
  );
  const value = useMemo(
    () => ({
      areas: snapshot.areas,
      tags: snapshot.tags,
      views: snapshot.views,
      displayLanguage: snapshot.ownerSettings.displayLanguage,
      setAreas: updateSnapshotAreas,
      weekStartsOn: snapshot.ownerSettings.weekStartsOn as WeekStartsOn,
      setWeekStartsOn: (weekStartsOn: WeekStartsOn) =>
        replaceSnapshot({
          ...snapshot,
          ownerSettings: { ...snapshot.ownerSettings, weekStartsOn },
        }),
      ownerTimeZone: snapshot.ownerSettings.timeZone,
      setOwnerTimeZone: (timeZone: string) =>
        replaceSnapshot({
          ...snapshot,
          ownerSettings: { ...snapshot.ownerSettings, timeZone },
        }),
      trashRetentionDays: snapshot.ownerSettings.trashRetentionDays,
      ownerSettingsVersion: snapshot.ownerSettings.version,
      createArea: (input: { name: string; color: Area["color"] }) =>
        applyMutationSnapshot(
          {
            ...snapshot,
            areas: [
              ...snapshot.areas,
              {
                id: Math.max(0, ...snapshot.areas.map((area) => area.id)) + 1,
                name: input.name,
                color: input.color,
                position:
                  Math.max(
                    0,
                    ...activeAreasInPositionOrder(snapshot.areas).map(
                      (area) => area.position,
                    ),
                  ) + 1,
                isSystemManaged: false,
              },
            ],
          },
          () => api.createArea(input),
        ),
      updateArea: (id: number, input: { name: string; color: Area["color"] }) =>
        applyMutationSnapshot(
          {
            ...snapshot,
            areas: snapshot.areas.map((area) =>
              area.id === id ? { ...area, ...input } : area,
            ),
          },
          () => api.updateArea(id, input),
        ),
      reorderAreas: (ids: number[]) =>
        applySnapshot(
          {
            ...snapshot,
            areas: snapshot.areas.map((area) => {
              const index = ids.indexOf(area.id);
              if (index < 0) return area;
              const position = [...snapshot.areas]
                .filter(
                  (candidate) =>
                    !candidate.trashedAt && !candidate.isSystemManaged,
                )
                .sort((left, right) => left.position - right.position)[
                index
              ]?.position;
              return position === undefined ? area : { ...area, position };
            }),
          },
          () => api.reorderAreas({ ids }),
        ),
      trashArea: (id: number) =>
        applySnapshot(
          {
            ...snapshot,
            areas: snapshot.areas.map((area) =>
              area.id === id
                ? { ...area, trashedAt: new Date().toISOString() }
                : area,
            ),
          },
          () => api.trashArea(id),
        ),
      restoreArea: (id: number) =>
        applySnapshot(
          {
            ...snapshot,
            areas: snapshot.areas.map((area) =>
              area.id === id ? { ...area, trashedAt: null } : area,
            ),
          },
          () => api.restoreArea(id),
        ),
      updateOwnerSettings: (input: {
        displayLanguage: DisplayLanguage;
        timeZone: string;
        weekStartsOn: WeekStartsOn;
        trashRetentionDays: number;
        version: number;
      }) =>
        applySnapshot(
          { ...snapshot, ownerSettings: input },
          () => api.updateOwnerSettings(input),
          { reloadOnConflict: true },
        ),
      renameTag: (id: number, nextName: string) => {
        const normalizedName = nextName.trim().toLowerCase();
        const previous = snapshot.tags.find((tag) => tag.id === id);
        if (!previous || !normalizedName || previous.name === normalizedName) {
          return Promise.resolve(snapshot);
        }
        const target = snapshot.tags.find(
          (tag) => tag.id !== id && tag.name === normalizedName,
        );
        const replacement = target ?? { id, name: normalizedName };
        const deduplicate = (tags: Tag[]) =>
          tags
            .map((tag) => (tag.id === id ? replacement : tag))
            .filter(
              (tag, index, all) =>
                all.findIndex((candidate) => candidate.id === tag.id) === index,
            );

        return applyMutationSnapshot(
          {
            ...snapshot,
            tags: deduplicate(snapshot.tags),
            tasks: snapshot.tasks.map((task) => ({
              ...task,
              tags: deduplicate(task.tags),
            })),
          },
          () => api.renameTag(id, { name: normalizedName }),
        );
      },
      deleteTag: (id: number) =>
        applySnapshot(
          {
            ...snapshot,
            tags: snapshot.tags.filter((tag) => tag.id !== id),
            tasks: snapshot.tasks.map((task) => ({
              ...task,
              tags: task.tags.filter((tag) => tag.id !== id),
            })),
          },
          () => api.deleteTag(id),
        ),
      createView: (input: ViewCreateRequest) =>
        applySnapshot(
          {
            ...snapshot,
            views: [
              ...snapshot.views,
              {
                id: crypto.randomUUID(),
                ...input,
                version: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          },
          () => api.createView(input),
        ),
      updateView,
      deleteView: (id: string) =>
        applySnapshot(
          {
            ...snapshot,
            views: snapshot.views.filter((view) => view.id !== id),
          },
          () => api.deleteView(id),
        ),
    }),
    [
      snapshot,
      applySnapshot,
      applyMutationSnapshot,
      replaceSnapshot,
      updateSnapshotAreas,
      updateView,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const settings = useContext(AppSettingsContext);
  if (!settings) {
    throw new Error("useAppSettings must be used inside AppSettingsProvider");
  }
  return settings;
}
