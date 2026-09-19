import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Area } from "../../domain/task";

export function AreaDeleteDialog({
  area,
  taskCount,
  open,
  onOpenChange,
}: {
  area?: Area;
  taskCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  if (!area) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-bold">
                {t("organization.areas.deleteDialog.title")}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">
                {t("organization.areas.deleteDialog.description", {
                  name: area.name,
                  count: taskCount,
                })}
                <span className="mt-2 block font-medium text-rose-700">
                  {t("organization.areas.deleteDialog.guidance")}
                </span>
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              aria-label={t("organization.areas.deleteDialog.closeAria")}
            >
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              {t("organization.areas.deleteDialog.close")}
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
