import {
  type DragTarget,
  dragAndDropFeature,
  hotkeysCoreFeature,
  type ItemInstance,
  propMemoizationFeature,
  syncDataLoaderFeature,
  type TreeConfig,
  type TreeInstance,
  type Updater,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Layers3 } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { Task } from "../../domain/task";
import type {
  MoveTaskRequest,
  TaskMovePosition,
} from "../../shared/api-schema";
import { orderTasksByIds, useTaskStore } from "../task-store";
import {
  previewTaskMove,
  type TaskMovePreview,
  type TaskTreeMoveContext,
} from "../task-tree-move";
import { TaskTreeRow } from "./task-row";
import {
  readTaskTreeCollapseState,
  writeTaskTreeCollapseState,
} from "./task-tree-collapse-state";

const ROOT_ITEM_ID = "__task-tree-root__";
const DRAG_FOCUS_RING_SUPPRESSED_ATTRIBUTE = "data-drag-focus-ring-suppressed";
const HEADLESS_TREE_FEATURES = [
  syncDataLoaderFeature,
  hotkeysCoreFeature,
  dragAndDropFeature,
  propMemoizationFeature,
];

type TreeNode = {
  task: Task | null;
  childrenIds: string[];
};

type TaskTreeModel = {
  nodes: Map<string, TreeNode>;
  visibleRootIds: string[];
  visibleSiblingIdsByGroup: Map<string, string[]>;
  visibleOrderSiblingIdsByGroup: Map<string, string[]>;
  allSiblingIdsByGroup: Map<string, string[]>;
  storageGroupKeyByTaskId: Map<string, string>;
  expandableTaskIds: string[];
  initialExpandedItems: string[];
};

type HeadlessTaskTreeProps = {
  rootGroupKey: string;
  tasks: Task[];
  allTasks: Task[];
  rootOrder?: string[];
  siblingOrders: Record<string, string[]>;
  onMoveTask: (input: MoveTaskRequest) => void;
  treeLabel?: string;
  emptyState?: ReactNode;
  showContainerBorder?: boolean;
  showPath?: boolean;
};

type ActiveMovePreview = TaskMovePreview & {
  target: DragTarget<TreeNode>;
  targetItem: ItemInstance<TreeNode>;
};

function getMoveIndicatorStyle(
  tree: TreeInstance<TreeNode>,
  activePreview: ActiveMovePreview | null,
): CSSProperties {
  if (!activePreview?.valid || activePreview.position === "as-last-child") {
    return { display: "none" };
  }
  const treeElement = tree.getElement();
  const targetElement = activePreview.targetItem.getElement();
  if (!treeElement || !targetElement) return { display: "none" };

  const treeRect = treeElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const top =
    activePreview.position === "before" ? targetRect.top : targetRect.bottom;

  return {
    position: "absolute",
    top: `${top - treeRect.top - 1}px`,
    left: "8px",
    width: `${Math.max(0, treeRect.width - 16)}px`,
    pointerEvents: "none",
  };
}

export function HeadlessTaskTree({
  rootGroupKey,
  tasks,
  allTasks,
  rootOrder,
  siblingOrders,
  onMoveTask,
  treeLabel,
  emptyState,
  showContainerBorder = true,
  showPath = true,
}: HeadlessTaskTreeProps) {
  const { completeTask, reopenTask } = useTaskStore();
  const { t } = useTranslation();
  const resolvedTreeLabel = treeLabel ?? t("taskReview.tree.defaultLabel");
  const collapseStorageRef = useRef<Storage | null>(null);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => {
    const stored = readTaskTreeCollapseState(rootGroupKey);
    collapseStorageRef.current = stored.storage;
    return stored.collapsedTaskIds;
  });
  const collapsedTaskIdsRef = useRef(collapsedTaskIds);
  const treeRef = useRef<TreeInstance<TreeNode> | null>(null);
  const replaceCollapsedTaskIds = useCallback(
    (nextCollapsedTaskIds: Set<string>) => {
      const previousCollapsedTaskIds = collapsedTaskIdsRef.current;
      if (sameIdSet(previousCollapsedTaskIds, nextCollapsedTaskIds)) return;

      collapsedTaskIdsRef.current = nextCollapsedTaskIds;
      setCollapsedTaskIds(nextCollapsedTaskIds);
      const storage = collapseStorageRef.current;
      if (
        storage &&
        !writeTaskTreeCollapseState(storage, rootGroupKey, nextCollapsedTaskIds)
      ) {
        collapseStorageRef.current = null;
      }
    },
    [rootGroupKey],
  );
  const model = useMemo(
    () =>
      buildTaskTreeModel({
        rootGroupKey,
        tasks,
        allTasks,
        rootOrder,
        siblingOrders,
        collapsedTaskIds,
      }),
    [allTasks, collapsedTaskIds, rootGroupKey, rootOrder, siblingOrders, tasks],
  );
  const nodesRef = useRef(model.nodes);
  const previousNodesRef = useRef(model.nodes);
  const [treeElement, setTreeElement] = useState<HTMLDivElement | null>(null);
  const [, forceTreeRender] = useState(0);
  const touchHandlesRef = useRef<WeakSet<HTMLElement>>(new WeakSet());
  const nativeDragItemRef = useRef<ItemInstance<TreeNode> | null>(null);
  const suppressDragFocusRingRef = useRef<ItemInstance<TreeNode> | null>(null);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeMovePreviewRef = useRef<ActiveMovePreview | null>(null);
  const [activeMovePreview, setActiveMovePreviewState] =
    useState<ActiveMovePreview | null>(null);
  const moveContext = useMemo<TaskTreeMoveContext>(
    () => ({
      rootGroupKey,
      tasks,
      allTasks,
      rootOrder,
      siblingOrders,
    }),
    [allTasks, rootGroupKey, rootOrder, siblingOrders, tasks],
  );

  const dataLoader = useMemo(
    () => ({
      getItem: (itemId: string) => {
        const node = nodesRef.current.get(itemId);
        if (!node) throw new Error(`Task tree item was not found: ${itemId}`);
        return node;
      },
      getChildren: (itemId: string) =>
        nodesRef.current.get(itemId)?.childrenIds ?? [],
    }),
    [],
  );
  const getItemName = useCallback(
    (item: ItemInstance<TreeNode>) =>
      item.getItemData().task?.title ?? resolvedTreeLabel,
    [resolvedTreeLabel],
  );
  const isItemFolder = useCallback(
    (item: ItemInstance<TreeNode>) => item.getItemData().childrenIds.length > 0,
    [],
  );
  const onPrimaryAction = useCallback((item: ItemInstance<TreeNode>) => {
    editButtonRefs.current.get(item.getId())?.click();
  }, []);
  const setExpandedItems = useCallback(
    (updater: Updater<string[]>) => {
      const tree = treeRef.current;
      const currentExpandedItems = tree?.getState().expandedItems ?? [];
      const nextExpandedItems =
        typeof updater === "function" ? updater(currentExpandedItems) : updater;
      const nextExpandedItemsSet = new Set(nextExpandedItems);
      const nextCollapsedTaskIds = new Set(collapsedTaskIdsRef.current);
      for (const taskId of model.expandableTaskIds) {
        if (nextExpandedItemsSet.has(taskId)) {
          nextCollapsedTaskIds.delete(taskId);
        } else {
          nextCollapsedTaskIds.add(taskId);
        }
      }
      replaceCollapsedTaskIds(nextCollapsedTaskIds);
      if (tree) setTreeExpandedItems(tree, nextExpandedItems);
    },
    [model.expandableTaskIds, replaceCollapsedTaskIds],
  );
  const expandTask = useCallback(
    (taskId: string) => {
      const nextCollapsedTaskIds = new Set(collapsedTaskIdsRef.current);
      nextCollapsedTaskIds.delete(taskId);
      replaceCollapsedTaskIds(nextCollapsedTaskIds);

      const tree = treeRef.current;
      if (!tree) return;
      const item = tree.getItemInstance(taskId);
      if (!item.isExpanded()) item.expand();
    },
    [replaceCollapsedTaskIds],
  );
  const setActiveMovePreview = useCallback(
    (
      preview: ActiveMovePreview | null,
      draggedItems?: ItemInstance<TreeNode>[],
    ) => {
      activeMovePreviewRef.current = preview;
      setActiveMovePreviewState(preview);
      const tree = treeRef.current;
      if (!tree) return;
      if (!preview) {
        // A native dragleave only clears the destination; keep draggedItems
        // alive until the browser sends dragend or a drop is committed.
        tree.applySubStateUpdate("dnd", (state) =>
          state
            ? {
                ...state,
                dragTarget: undefined,
                draggingOverItem: undefined,
              }
            : state,
        );
        return;
      }
      tree.applySubStateUpdate("dnd", {
        draggedItems: draggedItems ?? tree.getState().dnd?.draggedItems,
        dragTarget: preview.valid ? preview.target : undefined,
        draggingOverItem: preview.valid ? preview.targetItem : undefined,
      });
    },
    [],
  );
  const createMovePreview = useCallback(
    (
      sourceItem: ItemInstance<TreeNode>,
      targetItem: ItemInstance<TreeNode>,
      position: TaskMovePosition,
    ): ActiveMovePreview => {
      const preview = previewTaskMove(
        moveContext,
        sourceItem.getId(),
        targetItem.getId(),
        position,
      );
      return {
        ...preview,
        target: createHeadlessDragTarget(
          treeRef.current as TreeInstance<TreeNode>,
          targetItem,
          position,
        ),
        targetItem,
      };
    },
    [moveContext],
  );
  const getPointerMovePreview = useCallback(
    (
      targetItem: ItemInstance<TreeNode>,
      clientY: number,
    ): ActiveMovePreview | null => {
      const tree = treeRef.current;
      const sourceItem = tree?.getState().dnd?.draggedItems?.[0];
      if (!tree || !sourceItem) return null;
      const element = targetItem.getElement();
      const rect = element?.getBoundingClientRect();
      const top = rect?.top ?? 0;
      const height = rect?.height || 60;
      const offset = (clientY ?? 0) - top;
      const position: TaskMovePosition =
        offset < height / 3
          ? "before"
          : offset > (height * 2) / 3
            ? "after"
            : "as-last-child";
      return createMovePreview(sourceItem, targetItem, position);
    },
    [createMovePreview],
  );
  const commitMove = useCallback(
    (sourceItem: ItemInstance<TreeNode>, preview: ActiveMovePreview) => {
      if (!preview.valid || !preview.input) return;
      if (nativeDragItemRef.current === sourceItem) {
        suppressDragFocusRingRef.current = sourceItem;
        sourceItem
          .getElement()
          ?.setAttribute(DRAG_FOCUS_RING_SUPPRESSED_ATTRIBUTE, "true");
      }
      onMoveTask(preview.input);
      if (preview.position === "as-last-child") {
        expandTask(preview.targetTaskId);
      }
      setActiveMovePreview(null);
      treeRef.current?.applySubStateUpdate("dnd", null);
      sourceItem.setFocused();
      treeRef.current?.updateDomFocus();
    },
    [expandTask, onMoveTask, setActiveMovePreview],
  );
  const onDrop = useCallback(
    (items: ItemInstance<TreeNode>[]) => {
      const sourceItem = getSingleItem(items);
      const preview = activeMovePreviewRef.current;
      if (!sourceItem || !preview) return;
      commitMove(sourceItem, preview);
    },
    [commitMove],
  );
  const treeConfig: TreeConfig<TreeNode> = {
    rootItemId: ROOT_ITEM_ID,
    dataLoader,
    features: HEADLESS_TREE_FEATURES,
    initialState: {
      expandedItems: model.initialExpandedItems,
    },
    setExpandedItems,
    getItemName,
    isItemFolder,
    onPrimaryAction,
    canReorder: true,
    openOnDropDelay: 0,
    indent: 16,
    canDrag: (items) =>
      items.length === 1 &&
      items.every((item) => item.getId() !== ROOT_ITEM_ID),
    canDrop: () => Boolean(activeMovePreviewRef.current?.valid),
    onDrop,
    seperateDragHandle: true,
    hotkeys: {
      customPrimaryAction: {
        hotkey: "Enter",
        preventDefault: true,
        isEnabled: (tree) =>
          tree.getFocusedItem().getElement() === document.activeElement,
        handler: (_, tree) => tree.getFocusedItem().primaryAction(),
      },
    },
  };
  const tree = useTree(treeConfig);
  treeRef.current = tree;

  useEffect(() => {
    const previousNodes = previousNodesRef.current;
    nodesRef.current = model.nodes;
    const currentExpandedItems = tree.getState().expandedItems ?? [];
    const validExpandedItems = currentExpandedItems.filter(
      (itemId) => model.nodes.get(itemId)?.childrenIds.length,
    );
    const newlyVisibleFolders = model.initialExpandedItems.filter(
      (itemId) => (previousNodes.get(itemId)?.childrenIds.length ?? 0) === 0,
    );
    const nextExpandedItems = [
      ...new Set([...validExpandedItems, ...newlyVisibleFolders]),
    ];
    if (!sameIds(currentExpandedItems, nextExpandedItems)) {
      tree.getConfig().setExpandedItems?.(nextExpandedItems);
    }
    previousNodesRef.current = model.nodes;
    tree.rebuildTree();
    forceTreeRender((revision) => revision + 1);
  }, [model, tree]);

  useEffect(() => {
    const validTaskIds = new Set(allTasks.map((task) => task.id));
    const validCollapsedTaskIds = new Set(
      [...collapsedTaskIdsRef.current].filter((taskId) =>
        validTaskIds.has(taskId),
      ),
    );
    replaceCollapsedTaskIds(validCollapsedTaskIds);
  }, [allTasks, replaceCollapsedTaskIds]);

  useEffect(() => {
    if (!treeElement) return;
    let active = true;
    const getTouchHandles = () =>
      tree
        .getItems()
        .map((item) =>
          item
            .getElement()
            ?.querySelector<HTMLElement>("button[draggable='true']"),
        )
        .filter((handle): handle is HTMLElement => Boolean(handle));
    void import("@dragdroptouch/drag-drop-touch")
      .then(({ enableDragDropTouch }) => {
        if (!active || model.nodes.size === 0) return;
        for (const handle of getTouchHandles()) {
          if (touchHandlesRef.current.has(handle)) continue;
          enableDragDropTouch(handle, treeElement, { forceListen: true });
          touchHandlesRef.current.add(handle);
        }
      })
      .catch(() => {
        // The desktop HTML5 drag-and-drop path remains available if the bridge
        // cannot load in a particular browser environment.
      });
    return () => {
      active = false;
      for (const handle of getTouchHandles()) {
        handle.dispatchEvent(
          new Event("touchcancel", { bubbles: true, cancelable: false }),
        );
      }
    };
  }, [model, tree, treeElement]);

  const containerProps = tree.getContainerProps(resolvedTreeLabel);
  const containerRef = containerProps.ref as
    | ((element: HTMLElement | null) => void)
    | undefined;
  const setContainerRef = useCallback(
    (element: HTMLDivElement | null) => {
      containerRef?.(element);
      setTreeElement(element);
    },
    [containerRef],
  );

  const renderTreeItem = (item: ItemInstance<TreeNode>) => {
    const itemProps = item.getProps();
    const node = item.getItemData();
    if (!node.task) return null;
    const task = node.task;
    const editButtonRef = (element: HTMLButtonElement | null) => {
      if (element) {
        editButtonRefs.current.set(task.id, element);
      } else {
        editButtonRefs.current.delete(task.id);
      }
    };
    const interactiveSelector =
      "button, a, input, select, textarea, [role='button'], [role='menuitem']";
    const dragHandleProps = item.getDragHandleProps() as Record<
      string,
      unknown
    > & {
      onDragEnd?: (event: ReactDragEvent<HTMLButtonElement>) => void;
      onDragStart?: (event: ReactDragEvent<HTMLButtonElement>) => void;
    };
    const dragHandlePropsWithFocusCleanup = {
      ...dragHandleProps,
      onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => {
        dragHandleProps.onDragStart?.(event);
        if (!event.defaultPrevented) {
          nativeDragItemRef.current = item;
        }
      },
      onDragEnd: (event: ReactDragEvent<HTMLButtonElement>) => {
        dragHandleProps.onDragEnd?.(event);
        if (nativeDragItemRef.current === item) {
          nativeDragItemRef.current = null;
        }
        setActiveMovePreview(null);
        treeRef.current?.applySubStateUpdate("dnd", null);
      },
    };
    const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
      const sourceItem = tree.getState().dnd?.draggedItems?.[0];
      if (!sourceItem) return;
      event.preventDefault();
      event.stopPropagation();
      const preview = getPointerMovePreview(item, event.clientY);
      if (preview) setActiveMovePreview(preview);
    };
    const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (tree.getState().dnd?.draggedItems?.length) {
        setActiveMovePreview(null);
      }
    };
    const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
      const sourceItem = tree.getState().dnd?.draggedItems?.[0];
      if (!sourceItem) return;
      event.preventDefault();
      event.stopPropagation();
      const preview =
        getPointerMovePreview(item, event.clientY) ??
        activeMovePreviewRef.current;
      if (!preview?.valid) {
        setActiveMovePreview(null);
        return;
      }
      commitMove(sourceItem, preview);
    };
    const isAsLastChildTarget =
      activeMovePreview?.valid &&
      activeMovePreview.position === "as-last-child" &&
      activeMovePreview.targetTaskId === task.id;

    return (
      <div
        key={item.getId()}
        {...itemProps}
        role="treeitem"
        tabIndex={item.isFocused() ? 0 : -1}
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => {
          if (
            event.target instanceof Element &&
            event.target.closest(interactiveSelector)
          ) {
            return;
          }
          item.setFocused();
        }}
        onFocus={(event) => {
          item.setFocused();
          if (suppressDragFocusRingRef.current !== item) return;
          suppressDragFocusRingRef.current = null;
          event.currentTarget.setAttribute(
            DRAG_FOCUS_RING_SUPPRESSED_ATTRIBUTE,
            "true",
          );
        }}
        onBlur={(event) => {
          event.currentTarget.removeAttribute(
            DRAG_FOCUS_RING_SUPPRESSED_ATTRIBUTE,
          );
        }}
        onKeyDown={(event) => {
          const isTreeItemKeyEvent = event.target === event.currentTarget;
          if (isTreeItemKeyEvent) {
            suppressDragFocusRingRef.current = null;
            event.currentTarget.removeAttribute(
              DRAG_FOCUS_RING_SUPPRESSED_ATTRIBUTE,
            );
          }
        }}
        onDragEnter={(event) => {
          if (tree.getState().dnd?.draggedItems?.length) event.preventDefault();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-slot="task-tree-item"
        data-drop-position={isAsLastChildTarget ? "as-last-child" : undefined}
        className={`relative ${isAsLastChildTarget ? "bg-sky-50 outline outline-2 outline-sky-400 outline-offset-[-2px]" : ""}`}
      >
        <TaskTreeRow
          task={task}
          depth={item.getItemMeta().level}
          folder={item.isFolder()}
          expanded={item.isExpanded()}
          onToggle={() => {
            item.setFocused();
            if (item.isExpanded()) {
              item.collapse();
            } else {
              item.expand();
            }
          }}
          onComplete={completeTask}
          onReopen={reopenTask}
          onSubtaskCreated={() => expandTask(task.id)}
          editButtonRef={editButtonRef}
          showPath={showPath}
          dragHandleProps={{
            ...dragHandlePropsWithFocusCleanup,
            tabIndex: -1,
          }}
        />
      </div>
    );
  };

  if (model.visibleRootIds.length === 0) {
    return (
      emptyState ?? (
        <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-slate-300 bg-white/50 p-8 text-center">
          <div>
            <Layers3 className="mx-auto text-slate-300" size={30} />
            <h2 className="mt-4 text-base font-bold">
              {t("taskReview.tree.emptyTitle")}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
              {t("taskReview.tree.emptyDescription")}
            </p>
          </div>
        </div>
      )
    );
  }

  return (
    <div
      {...containerProps}
      ref={setContainerRef}
      className={`relative overflow-visible rounded-2xl bg-white ${
        showContainerBorder ? "border border-slate-200" : ""
      }`}
    >
      <div
        aria-hidden="true"
        data-slot="task-tree-drop-indicator"
        className="pointer-events-none absolute z-20 h-0.5 rounded-full bg-sky-500 shadow-sm"
        style={getMoveIndicatorStyle(tree, activeMovePreview)}
      />
      {tree.getItems().map(renderTreeItem)}
    </div>
  );
}

function buildTaskTreeModel({
  rootGroupKey,
  tasks,
  allTasks,
  rootOrder,
  siblingOrders,
  collapsedTaskIds,
}: {
  rootGroupKey: string;
  tasks: Task[];
  allTasks: Task[];
  rootOrder?: string[];
  siblingOrders: Record<string, string[]>;
  collapsedTaskIds: Set<string>;
}): TaskTreeModel {
  const visibleIds = new Set(tasks.map((task) => task.id));
  const allIds = new Set(allTasks.map((task) => task.id));
  const visibleSiblingIdsByGroup = groupTaskIds(
    tasks,
    visibleIds,
    rootGroupKey,
    rootOrder,
    siblingOrders,
  );
  const visibleOrderSiblingIdsByGroup = groupTaskIds(
    tasks,
    allIds,
    rootGroupKey,
    rootOrder,
    siblingOrders,
  );
  const allSiblingIdsByGroup = groupTaskIds(
    allTasks,
    allIds,
    rootGroupKey,
    rootOrder,
    siblingOrders,
  );
  const storageGroupKeyByTaskId = new Map(
    allTasks.map((task) => [task.id, getGroupKey(task, allIds, rootGroupKey)]),
  );
  const nodes = new Map<string, TreeNode>([
    [
      ROOT_ITEM_ID,
      {
        task: null,
        childrenIds: visibleSiblingIdsByGroup.get(rootGroupKey) ?? [],
      },
    ],
  ]);
  for (const task of tasks) {
    nodes.set(task.id, {
      task,
      childrenIds: visibleSiblingIdsByGroup.get(`parent:${task.id}`) ?? [],
    });
  }

  const expandableTaskIds = [...visibleSiblingIdsByGroup.keys()]
    .filter((groupKey) => groupKey.startsWith("parent:"))
    .map((groupKey) => groupKey.slice("parent:".length));

  return {
    nodes,
    visibleRootIds: visibleSiblingIdsByGroup.get(rootGroupKey) ?? [],
    visibleSiblingIdsByGroup,
    visibleOrderSiblingIdsByGroup,
    allSiblingIdsByGroup,
    storageGroupKeyByTaskId,
    expandableTaskIds,
    initialExpandedItems: expandableTaskIds.filter(
      (taskId) => !collapsedTaskIds.has(taskId),
    ),
  };
}

function groupTaskIds(
  tasks: Task[],
  visibleIds: Set<string>,
  rootGroupKey: string,
  rootOrder: string[] | undefined,
  siblingOrders: Record<string, string[]>,
) {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const groupKey = getGroupKey(task, visibleIds, rootGroupKey);
    const group = groups.get(groupKey) ?? [];
    group.push(task);
    groups.set(groupKey, group);
  }

  return new Map(
    [...groups.entries()].map(([groupKey, groupTasks]) => {
      const savedOrder =
        groupKey === rootGroupKey ? rootOrder : siblingOrders[groupKey];
      return [
        groupKey,
        orderTasksByIds(groupTasks, savedOrder).map((task) => task.id),
      ];
    }),
  );
}

function getGroupKey(task: Task, parentIds: Set<string>, rootGroupKey: string) {
  return task.parentId && parentIds.has(task.parentId)
    ? `parent:${task.parentId}`
    : rootGroupKey;
}

function createHeadlessDragTarget(
  tree: TreeInstance<TreeNode>,
  targetItem: ItemInstance<TreeNode>,
  position: TaskMovePosition,
): DragTarget<TreeNode> {
  if (position === "as-last-child") return { item: targetItem };

  const parent = targetItem.getParent() ?? tree.getRootItem();
  const targetIndex = Math.max(
    0,
    parent
      .getChildren()
      .findIndex((child) => child.getId() === targetItem.getId()),
  );
  const childIndex = targetIndex + (position === "after" ? 1 : 0);
  const draggedIds = new Set(
    tree.getState().dnd?.draggedItems?.map((item) => item.getId()) ?? [],
  );
  const numberOfDraggedItemsBeforeTarget = parent
    .getChildren()
    .slice(0, childIndex)
    .filter((child) => draggedIds.has(child.getId())).length;

  return {
    item: parent,
    childIndex,
    insertionIndex: childIndex - numberOfDraggedItemsBeforeTarget,
    dragLineIndex:
      targetItem.getItemMeta().index + (position === "after" ? 1 : 0),
    dragLineLevel: targetItem.getItemMeta().level,
  };
}

function getSingleItem<T>(items: ItemInstance<T>[]) {
  return items.length === 1 ? items[0] : null;
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function sameIdSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function setTreeExpandedItems(
  tree: TreeInstance<TreeNode>,
  expandedItems: string[],
) {
  tree.setConfig((previousConfig) => ({
    ...previousConfig,
    state: {
      ...previousConfig.state,
      expandedItems,
    },
  }));
}
