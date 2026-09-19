import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, ListFilter, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router";
import type { View } from "../../shared/api-schema";
import { useAppSettings } from "../settings-store";

export function ViewNavigation({
  mobile = false,
  className,
}: {
  mobile?: boolean;
  className: string;
}) {
  const { views } = useAppSettings();
  const sortedViews = sortViews(views);

  if (mobile) {
    return <MobileViewNavigation views={sortedViews} className={className} />;
  }

  return <DesktopViewNavigation views={sortedViews} className={className} />;
}

export function sortViews(views: View[]) {
  return [...views].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      }) || left.id.localeCompare(right.id),
  );
}

function DesktopViewNavigation({
  views,
  className,
}: {
  views: View[];
  className: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-1">
        <NavLink
          to="/views"
          lang="en"
          className={({ isActive }) =>
            [
              className,
              "min-w-0 flex-1",
              isActive
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-500 hover:bg-white hover:text-slate-950",
            ].join(" ")
          }
        >
          <ListFilter size={17} strokeWidth={1.8} />
          <span lang="en">View</span>
        </NavLink>
        <button
          type="button"
          lang="en"
          aria-label="Open Views"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-950"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      </div>
      {open ? <ViewLinks views={views} desktop /> : null}
    </div>
  );
}

function MobileViewNavigation({
  views,
  className,
}: {
  views: View[];
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          lang="en"
          aria-label="Open View menu"
          className={`${className} text-slate-500 hover:bg-white hover:text-slate-950`}
        >
          <ListFilter size={18} strokeWidth={1.8} />
          <span lang="en">View</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[80] max-h-[82vh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title lang="en" className="text-base font-bold">
                View
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                {t("common.viewNavigation.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              aria-label={t("common.viewNavigation.close")}
            >
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="mt-5 grid gap-2">
            <Link
              to="/views"
              onClick={close}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-950"
              lang="en"
            >
              All Views
            </Link>
            <Link
              to="/views?new=1"
              onClick={close}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-950"
              lang="en"
            >
              New View
            </Link>
            <ViewLinks views={views} onNavigate={close} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ViewLinks({
  views,
  desktop = false,
  onNavigate,
}: {
  views: View[];
  desktop?: boolean;
  onNavigate?: () => void;
}) {
  const labelId = useId();

  if (views.length === 0) {
    return (
      <p
        lang="en"
        className={
          desktop
            ? "ml-8 px-3 py-2 text-xs text-slate-400"
            : "rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400"
        }
      >
        No Views yet.
      </p>
    );
  }

  return (
    <>
      <span id={labelId} lang="en" className="sr-only">
        Views
      </span>
      <ol
        aria-labelledby={labelId}
        className={desktop ? "mt-1 grid gap-1 pl-8" : "grid gap-2"}
      >
        {views.map((view) => (
          <li key={view.id}>
            <Link
              to={`/views/${view.id}`}
              onClick={onNavigate}
              className={
                desktop
                  ? "block rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-white hover:text-slate-950"
                  : "block rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-950"
              }
            >
              {view.name}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
