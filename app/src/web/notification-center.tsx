import { X } from "lucide-react";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { DisplayLanguage } from "../shared/api-schema";

export type NotificationType = "error" | "warning" | "info";

type NotificationInput = {
  type: NotificationType;
  message: string;
  language?: DisplayLanguage;
};

type Notification = NotificationInput & {
  id: string;
  revision: number;
  returnFocusTo: HTMLElement | null;
};

type NotificationContextValue = {
  addNotification: (notification: NotificationInput) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

const notificationTypeKeys = {
  error: "common.notifications.type.error",
  warning: "common.notifications.type.warning",
  info: "common.notifications.type.info",
} as const satisfies Record<NotificationType, string>;

const notificationStyles: Record<
  NotificationType,
  { container: string; label: string }
> = {
  error: {
    container: "border-rose-200 border-l-rose-500",
    label: "text-rose-700",
  },
  warning: {
    container: "border-amber-200 border-l-amber-500",
    label: "text-amber-700",
  },
  info: {
    container: "border-sky-200 border-l-sky-500",
    label: "text-sky-700",
  },
};

const notificationDurations: Record<NotificationType, number> = {
  error: 10_000,
  warning: 10_000,
  info: 5_000,
};

export function NotificationProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextNotificationIdRef = useRef(0);
  const addNotification = useCallback((notification: NotificationInput) => {
    const returnFocusTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const id = `notification-${nextNotificationIdRef.current}`;
    nextNotificationIdRef.current += 1;
    setNotifications((current) => {
      const duplicate = current.find(
        (candidate) =>
          candidate.type === notification.type &&
          candidate.message === notification.message,
      );
      if (duplicate) {
        return [
          {
            ...duplicate,
            revision: duplicate.revision + 1,
            returnFocusTo,
          },
          ...current.filter((candidate) => candidate.id !== duplicate.id),
        ];
      }
      return [
        {
          ...notification,
          id,
          revision: 0,
          returnFocusTo,
        },
        ...current,
      ].slice(0, 3);
    });
  }, []);
  const dismissNotification = useCallback((id: string) => {
    setNotifications((current) =>
      current.filter((notification) => notification.id !== id),
    );
  }, []);
  const value = useMemo(() => ({ addNotification }), [addNotification]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {notifications.length > 0 ? (
        <aside
          aria-label={t("common.notifications.regionLabel")}
          className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+4rem)] z-[90] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 lg:left-auto lg:right-5 lg:top-5 lg:w-96 lg:translate-x-0"
        >
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onDismiss={dismissNotification}
            />
          ))}
        </aside>
      ) : null}
    </NotificationContext.Provider>
  );
}

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  const { i18n, t } = useTranslation();
  const translate = notification.language
    ? i18n.getFixedT(notification.language)
    : t;
  const typeLabel = translate(notificationTypeKeys[notification.type]);
  const timeoutRef = useRef<number | null>(null);
  const remainingRef = useRef(notificationDurations[notification.type]);
  const startedAtRef = useRef<number | null>(null);
  const pauseReasonsRef = useRef(new Set<"hover" | "focus">());

  const clearTimer = useCallback((preserveRemaining: boolean) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (preserveRemaining && startedAtRef.current !== null) {
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAtRef.current),
      );
    }
    startedAtRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(
      () => onDismiss(notification.id),
      remainingRef.current,
    );
  }, [notification.id, onDismiss]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a repeated notification increments revision to restart its full display time.
  useEffect(() => {
    clearTimer(false);
    remainingRef.current = notificationDurations[notification.type];
    if (pauseReasonsRef.current.size === 0) startTimer();
    return () => clearTimer(false);
  }, [clearTimer, notification.revision, notification.type, startTimer]);

  const pauseTimer = (reason: "hover" | "focus") => {
    if (pauseReasonsRef.current.has(reason)) return;
    if (pauseReasonsRef.current.size === 0) clearTimer(true);
    pauseReasonsRef.current.add(reason);
  };

  const resumeTimer = (reason: "hover" | "focus") => {
    pauseReasonsRef.current.delete(reason);
    if (pauseReasonsRef.current.size === 0) startTimer();
  };

  const closeNotification = () => {
    onDismiss(notification.id);
    queueMicrotask(() => {
      if (notification.returnFocusTo?.isConnected) {
        notification.returnFocusTo.focus();
      }
    });
  };

  return (
    <section
      lang={notification.language}
      aria-label={translate("common.notifications.itemLabel", {
        type: typeLabel,
        message: notification.message,
      })}
      className={`pointer-events-auto grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl border border-l-4 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.18)] ${notificationStyles[notification.type].container}`}
      onMouseEnter={() => pauseTimer("hover")}
      onMouseLeave={() => resumeTimer("hover")}
      onFocus={() => pauseTimer("focus")}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        resumeTimer("focus");
      }}
    >
      <div className="min-w-0">
        <p
          className={`text-xs font-bold uppercase tracking-[0.12em] ${notificationStyles[notification.type].label}`}
        >
          {typeLabel}
        </p>
        <p
          className="mt-1 break-words text-sm leading-5 text-slate-700"
          lang={notification.language}
        >
          {notification.message}
        </p>
      </div>
      <button
        type="button"
        aria-label={translate("common.notifications.close", {
          message: notification.message,
        })}
        onClick={closeNotification}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </section>
  );
}

export function useNotifications() {
  const notifications = useContext(NotificationContext);
  if (!notifications) {
    throw new Error(
      "useNotifications must be used inside NotificationProvider",
    );
  }
  return notifications;
}
