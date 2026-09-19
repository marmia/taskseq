import {
  CalendarDays,
  CalendarRange,
  Inbox,
  Layers3,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router";
import { useAppSettings } from "../settings-store";
import { NewTaskDialog } from "./new-task-dialog";
import { SearchDialog } from "./search-dialog";
import { ViewNavigation } from "./view-navigation";

const navigation = [
  { label: "Inbox", to: "/inbox", icon: Inbox },
  { label: "Today", to: "/today", icon: CalendarDays },
  { label: "This Week", to: "/week", icon: CalendarRange },
  { label: "View", to: "/views", icon: null },
  { label: "Area", to: "/areas", icon: Layers3 },
  { label: "Trash", to: "/trash", icon: Trash2 },
  { label: "Settings", to: "/settings", icon: Settings },
];

function Navigation({
  mobile = false,
  onNewTask,
  onSearch,
}: {
  mobile?: boolean;
  onNewTask: () => void;
  onSearch: () => void;
}) {
  const navigationLabelId = useId();
  const baseClassName = [
    "group flex items-center rounded-xl text-sm font-medium transition",
    mobile
      ? "min-w-[72px] flex-col gap-1 px-3 py-2 text-[11px]"
      : "gap-3 px-3 py-2.5",
  ].join(" ");

  return (
    <>
      <span id={navigationLabelId} lang="en" className="sr-only">
        Primary navigation
      </span>
      <nav
        aria-labelledby={navigationLabelId}
        className={
          mobile
            ? "flex min-w-max items-center gap-1 px-2"
            : "flex flex-col gap-1"
        }
      >
        <button
          type="button"
          lang="en"
          onClick={onNewTask}
          className={`${baseClassName} text-slate-500 hover:bg-white hover:text-slate-950`}
        >
          <Plus size={mobile ? 18 : 17} strokeWidth={1.8} />
          <span>New</span>
        </button>
        <button
          type="button"
          lang="en"
          onClick={onSearch}
          className={`${baseClassName} text-slate-500 hover:bg-white hover:text-slate-950`}
        >
          <Search size={mobile ? 18 : 17} strokeWidth={1.8} />
          <span>Search</span>
        </button>
        {navigation.map(({ label, to, icon: Icon }) =>
          label === "View" ? (
            <ViewNavigation
              key={to}
              mobile={mobile}
              className={baseClassName}
            />
          ) : (
            <NavLink
              key={to}
              to={to}
              lang="en"
              className={({ isActive }) =>
                [
                  baseClassName,
                  isActive
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-500 hover:bg-white hover:text-slate-950",
                ].join(" ")
              }
            >
              {Icon ? <Icon size={mobile ? 18 : 17} strokeWidth={1.8} /> : null}
              <span>{label}</span>
            </NavLink>
          ),
        )}
      </nav>
    </>
  );
}

export function AppShell() {
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { t } = useTranslation();
  const { ownerTimeZone } = useAppSettings();

  return (
    <div className="min-h-dvh bg-[#f6f7f4] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-slate-200/80 bg-[#eef0eb] px-4 py-5 lg:flex lg:flex-col">
        <NavLink to="/today" className="mb-6 flex items-center gap-3 px-2">
          <span className="grid size-9 place-items-center rounded-xl bg-lime-300 font-black text-slate-950">
            T
          </span>
          <span>
            <strong className="block text-sm tracking-tight" lang="en">
              Taskseq
            </strong>
            <span className="text-xs text-slate-500">
              {t("common.shell.workspace")}
            </span>
          </span>
        </NavLink>

        <Navigation
          onNewTask={() => setNewTaskOpen(true)}
          onSearch={() => setSearchOpen(true)}
        />

        <div className="mt-auto rounded-2xl border border-slate-200 bg-white/75 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {t("common.shell.ownerTimezone")}
          </p>
          <p className="mt-1 text-sm font-medium" lang="en">
            {ownerTimeZone}
          </p>
        </div>
      </aside>

      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200/80 bg-[#f6f7f4]/90 px-4 backdrop-blur lg:hidden">
        <NavLink to="/today" className="flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-xl bg-lime-300 font-black">
            T
          </span>
          <span lang="en">Taskseq</span>
        </NavLink>
        <span
          className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm"
          lang="en"
        >
          {ownerTimeZone}
        </span>
      </header>

      <main className="min-h-dvh pb-24 lg:ml-60 lg:pb-0">
        <Outlet />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 overflow-x-auto border-t border-slate-200 bg-white/95 py-1 backdrop-blur lg:hidden">
        <Navigation
          mobile
          onNewTask={() => setNewTaskOpen(true)}
          onSearch={() => setSearchOpen(true)}
        />
      </div>

      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
