import * as Dialog from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Task } from "../../domain/task";
import * as api from "../api-client";
import { useAppSettings } from "../settings-store";
import { EditTaskDialog } from "./edit-task-dialog";
import { TaskPath, taskPathParts } from "./task-status-control";

type SearchResultState =
  | { status: "idle"; tasks: Task[] }
  | { status: "loading"; tasks: Task[] }
  | { status: "ready"; tasks: Task[] }
  | { status: "error"; tasks: Task[] };

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [resultState, setResultState] = useState<SearchResultState>({
    status: "idle",
    tasks: [],
  });
  const [retryVersion, setRetryVersion] = useState(0);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const requestVersion = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim();
  const { t } = useTranslation();
  const { areas } = useAppSettings();

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryVersion intentionally repeats the same Search request.
  useEffect(() => {
    const currentRequest = ++requestVersion.current;
    if (!open || !normalizedQuery) {
      setResultState({ status: "idle", tasks: [] });
      return;
    }

    setResultState((current) => ({
      status: "loading",
      tasks: current.tasks,
    }));
    void api.searchTasks(normalizedQuery).then(
      (response) => {
        if (requestVersion.current !== currentRequest) return;
        setResultState({ status: "ready", tasks: response.tasks });
      },
      () => {
        if (requestVersion.current !== currentRequest) return;
        setResultState((current) => ({
          status: "error",
          tasks: current.tasks,
        }));
      },
    );

    return () => {
      requestVersion.current += 1;
    };
  }, [normalizedQuery, open, retryVersion]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      requestVersion.current += 1;
      setQuery("");
      setResultState({ status: "idle", tasks: [] });
    }
    onOpenChange(nextOpen);
  }

  function selectTask(task: Task) {
    setEditTask(task);
    changeOpen(false);
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={changeOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
          <Dialog.Content
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
            className="fixed left-1/2 top-[8vh] z-[80] flex max-h-[84vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-bold text-slate-950">
                  {t("search.dialog.title")}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-slate-500">
                  {t("search.dialog.description")}
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label={t("search.action.close")}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={17} aria-hidden="true" />
              </Dialog.Close>
            </div>

            <div className="border-b border-slate-100 p-4 sm:px-5">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-slate-400 focus-within:bg-white">
                <Search size={17} className="shrink-0 text-slate-400" />
                <span className="sr-only">{t("search.field.label")}</span>
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                  placeholder={t("search.field.placeholder")}
                  className="min-w-0 flex-1 appearance-none bg-transparent text-base outline-none placeholder:text-slate-400 min-[560px]:text-sm"
                />
              </label>
            </div>

            <div className="min-h-24 overflow-y-auto p-2 sm:p-3">
              {resultState.status === "idle" ? (
                <p className="px-3 py-5 text-center text-sm text-slate-500">
                  {t("search.state.idle")}
                </p>
              ) : null}
              {resultState.status === "loading" ? (
                <p
                  className="px-3 py-5 text-center text-sm text-slate-500"
                  role="status"
                >
                  {t("search.state.loading")}
                </p>
              ) : null}
              {resultState.status === "error" ? (
                <div
                  className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-700"
                  role="alert"
                >
                  <span>{t("search.state.error")}</span>
                  <button
                    type="button"
                    onClick={() => setRetryVersion((version) => version + 1)}
                    className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-2 font-medium text-rose-800 hover:bg-rose-100"
                  >
                    {t("search.action.retry")}
                  </button>
                </div>
              ) : null}
              {resultState.status === "ready" &&
              resultState.tasks.length === 0 ? (
                <p className="px-3 py-5 text-center text-sm text-slate-500">
                  {t("search.state.empty")}
                </p>
              ) : null}
              {resultState.tasks.length > 0 ? (
                <p
                  aria-live="polite"
                  className="px-3 pb-2 text-xs font-medium text-slate-400"
                >
                  {t(
                    `search.resultCount.${resultState.tasks.length === 1 ? "one" : "other"}`,
                    { count: resultState.tasks.length },
                  )}
                </p>
              ) : null}
              {resultState.tasks.length > 0 ? (
                <ol aria-label={t("search.resultsLabel")} className="space-y-1">
                  {resultState.tasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        aria-label={task.title}
                        onClick={() => selectTask(task)}
                        className="flex min-h-11 w-full min-w-0 flex-col items-start justify-center rounded-xl px-3 py-2 text-left hover:bg-slate-100"
                      >
                        <span
                          className={
                            task.status === "COMPLETED"
                              ? "max-w-full truncate text-sm font-semibold text-slate-400 line-through"
                              : "max-w-full truncate text-sm font-semibold text-slate-950"
                          }
                        >
                          {task.title}
                        </span>
                        <span
                          data-slot="search-result-path"
                          className="mt-0.5 max-w-full truncate text-xs text-slate-500"
                        >
                          <TaskPath
                            parts={taskPathParts(task, areas)}
                            separator=" / "
                          />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {editTask ? (
        <EditTaskDialog
          task={editTask}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditTask(null);
          }}
        />
      ) : null}
    </>
  );
}
