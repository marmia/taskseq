import { Check, Tag } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Tag as TagReference } from "../../domain/task";
import { useAppSettings } from "../settings-store";
import { useTaskStore } from "../task-store";

export function tagSegments(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function TagInput({
  value,
  onChange,
  containerClassName,
  inputClassName,
  placeholder,
  ariaLabel,
  listLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  containerClassName?: string;
  inputClassName?: string;
  placeholder: string;
  ariaLabel: string;
  listLabel: string;
}) {
  const { tasks } = useTaskStore();
  const { tags } = useAppSettings();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const existingTags = useMemo(
    () =>
      [
        ...new Map(
          [...tasks.flatMap((task) => task.tags), ...tags].map((tag) => [
            tag.id,
            tag,
          ]),
        ).values(),
      ].sort((left, right) => left.name.localeCompare(right.name)),
    [tasks, tags],
  );
  const segments = tagSegments(value);
  const rawParts = value.split(",");
  const query = rawParts.at(-1)?.trim().toLowerCase() ?? "";
  const prefixTags = rawParts
    .slice(0, -1)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const excludedTags = hasTyped ? prefixTags : segments;
  const candidates = existingTags.filter(
    (tag) =>
      !excludedTags.includes(tag.name.toLowerCase()) &&
      (!hasTyped || !query || tag.name.toLowerCase().includes(query)),
  );

  const chooseTag = (tag: TagReference) => {
    const nextTags = [...(hasTyped ? prefixTags : segments)];
    if (!nextTags.includes(tag.name.toLowerCase())) nextTags.push(tag.name);
    onChange(nextTags.join(", "));
    setHasTyped(false);
    setActiveIndex(0);
    setOpen(false);
  };

  return (
    <div
      className={["relative", containerClassName ?? "mt-1.5"]
        .filter(Boolean)
        .join(" ")}
      onBlurCapture={(event) => {
        if (
          !event.relatedTarget ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <Tag
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400"
      />
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setHasTyped(true);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => {
          setHasTyped(false);
          setActiveIndex(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (!open || candidates.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % candidates.length);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(
              (current) =>
                (current - 1 + candidates.length) % candidates.length,
            );
          }
          if (event.key === "Enter") {
            event.preventDefault();
            chooseTag(candidates[activeIndex] ?? candidates[0]);
          }
        }}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && candidates.length > 0}
        className={[
          "w-full rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none placeholder:text-slate-300 focus:border-slate-500",
          inputClassName ?? "py-2",
        ]
          .filter(Boolean)
          .join(" ")}
        placeholder={placeholder}
      />

      {open && candidates.length > 0 ? (
        <ul
          id={listId}
          aria-label={listLabel}
          className="absolute inset-x-0 bottom-full z-30 mb-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          {candidates.map((tag, index) => (
            <li key={tag.id}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseTag(tag)}
                className={[
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs",
                  index === activeIndex
                    ? "bg-slate-100 text-slate-950"
                    : "text-slate-600 hover:bg-slate-50",
                ].join(" ")}
              >
                <Tag size={13} className="text-slate-400" />
                <span className="flex-1">{tag.name}</span>
                {segments.includes(tag.name.toLowerCase()) ? (
                  <Check size={13} className="text-emerald-600" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function resolveTagInput(value: string, tags: TagReference[]) {
  const tagIds: number[] = [];
  const newTagNames: string[] = [];
  const tagByName = new Map(tags.map((tag) => [tag.name, tag]));

  for (const name of tagSegments(value)) {
    const tag = tagByName.get(name);
    if (tag) {
      if (!tagIds.includes(tag.id)) tagIds.push(tag.id);
    } else if (!newTagNames.includes(name)) {
      newTagNames.push(name);
    }
  }

  return { tagIds, newTagNames };
}
