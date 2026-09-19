import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNotifications } from "../notification-center";
import { settingsMutationFailure } from "../settings-mutation-errors";
import { useAppSettings } from "../settings-store";

export function TagDeleteDialog({
  tag,
  open,
  onOpenChange,
}: {
  tag: { id: number; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { deleteTag } = useAppSettings();
  const { addNotification } = useNotifications();
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await deleteTag(tag.id);
      onOpenChange(false);
    } catch (error: unknown) {
      addNotification(
        settingsMutationFailure("delete-tag", tag.name, error, t),
      );
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <Dialog.Title className="text-base font-bold">
            {t("organization.tags.deleteDialog.title")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">
            <Trans
              i18nKey="organization.tags.deleteDialog.description"
              values={{ name: tag.name }}
              components={{ strong: <strong /> }}
            />
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              {t("organization.tags.deleteDialog.cancel")}
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="min-h-10 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("organization.tags.deleteDialog.delete")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
