import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Area, Task } from "../../domain/task";
import type { TaskResultColumn } from "../../shared/api-schema";
import { taskResultValue } from "../task-result-values";

export function TaskResultCell({
  column,
  task,
  areas,
  ownerTimeZone,
  onEdit,
}: {
  column: TaskResultColumn;
  task: Task;
  areas: Area[];
  ownerTimeZone: string;
  onEdit: () => void;
}) {
  const { t } = useTranslation();

  switch (column) {
    case "title":
      return (
        <button
          type="button"
          aria-label={t("viewResults.action.editTask", { title: task.title })}
          onClick={onEdit}
          className={[
            "text-left font-semibold hover:underline",
            task.status === "COMPLETED"
              ? "text-slate-400 line-through"
              : "text-slate-950",
          ].join(" ")}
        >
          {task.title}
        </button>
      );
    case "description":
    case "workNotes": {
      const label = t(`viewResults.table.column.${column}`);
      const content =
        column === "description" ? task.description : task.workNotes;
      return (
        <ContentPreview
          label={label}
          taskTitle={task.title}
          content={content}
        />
      );
    }
    default:
      return (
        <span
          lang={
            column === "area" &&
            areas.find((area) => area.id === task.areaId)?.isSystemManaged
              ? "en"
              : undefined
          }
        >
          {taskResultValue(column, task, areas, ownerTimeZone)}
        </span>
      );
  }
}

function ContentPreview({
  label,
  taskTitle,
  content,
}: {
  label: string;
  taskTitle: string;
  content: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!content) return <span className="text-slate-400">—</span>;
  const preview = truncateDisplayWidth(markdownToPlainText(content), 30);
  return (
    <span className="relative block min-w-36">
      <button
        type="button"
        ref={triggerRef}
        aria-label={t("viewResults.content.open", {
          label,
          title: taskTitle,
        })}
        className="max-w-full truncate text-left text-slate-700 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-700"
        onClick={() => setOpen(true)}
      >
        {preview}
      </button>
      <ContentViewer
        label={label}
        content={content}
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
      />
    </span>
  );
}

function ContentViewer({
  label,
  content,
  open,
  onOpenChange,
  triggerRef,
}: {
  label: string;
  content: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && !isMobile) dialogRef.current?.focus();
  }, [isMobile, open]);

  const closeDesktopViewer = () => {
    onOpenChange(false);
    triggerRef.current?.focus();
  };

  if (isMobile) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] max-h-[84vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-base font-bold">
                  {label}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  {t("viewResults.content.full", { label })}
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label={t("viewResults.content.close", { label })}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={16} />
              </Dialog.Close>
            </div>
            <MarkdownContent content={content} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeDesktopViewer();
      }}
      className="absolute right-0 top-full z-50 mt-2 max-h-80 w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-bold text-slate-950">{label}</h3>
        <button
          type="button"
          aria-label={t("viewResults.content.close", { label })}
          onClick={closeDesktopViewer}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
        >
          <X size={16} />
        </button>
      </div>
      <MarkdownContent content={content} />
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="mt-3 text-sm leading-6 text-slate-700 [&_a]:underline [&_a]:underline-offset-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-2 [&_p:first-child]:mt-0 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 559px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return isMobile;
}

export function markdownToPlainText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateDisplayWidth(value: string, maxWidth: number) {
  let width = 0;
  let result = "";
  for (const character of value) {
    const characterWidth = (character.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
    if (width + characterWidth > maxWidth) {
      return `${result.trimEnd()}…`;
    }
    result += character;
    width += characterWidth;
  }
  return result;
}
