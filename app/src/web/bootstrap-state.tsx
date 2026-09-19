import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { I18nextProvider } from "react-i18next";
import type { BootstrapResponse } from "../shared/api-schema";
import { loadBootstrap } from "./api-client";
import { applyDisplayLanguage, i18n } from "./i18n";
import { NotificationProvider } from "./notification-center";

type BootstrapSnapshotUpdate =
  | BootstrapResponse
  | ((snapshot: BootstrapResponse) => BootstrapResponse);

type BootstrapState = {
  snapshot: BootstrapResponse;
  isInitialSnapshot: boolean;
  replaceSnapshot: (update: BootstrapSnapshotUpdate) => void;
  retry: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; snapshot: BootstrapResponse };

const BootstrapContext = createContext<BootstrapState | null>(null);

export function BootstrapProvider({
  children,
  initialSnapshot,
}: PropsWithChildren<{ initialSnapshot?: BootstrapResponse }>) {
  const [loadState, setLoadState] = useState<LoadState>(() =>
    initialSnapshot
      ? { status: "ready", snapshot: initialSnapshot }
      : { status: "loading" },
  );
  const [requestVersion, setRequestVersion] = useState(0);
  const retry = useCallback(
    () => setRequestVersion((version) => version + 1),
    [],
  );
  const replaceSnapshot = useCallback((update: BootstrapSnapshotUpdate) => {
    setLoadState((current) => {
      if (current.status !== "ready") return current;
      return {
        status: "ready",
        snapshot:
          typeof update === "function" ? update(current.snapshot) : update,
      };
    });
  }, []);
  const reloadKey = initialSnapshot ? null : requestVersion;

  useEffect(() => {
    if (reloadKey === null) return;

    let active = true;
    setLoadState({ status: "loading" });

    void loadBootstrap().then(
      (snapshot) => {
        if (active) setLoadState({ status: "ready", snapshot });
      },
      () => {
        if (active) setLoadState({ status: "error" });
      },
    );

    return () => {
      active = false;
    };
  }, [reloadKey]);

  applyDisplayLanguage(
    loadState.status === "ready"
      ? loadState.snapshot.ownerSettings.displayLanguage
      : "en",
  );

  const englishMessages = i18n.getFixedT("en");

  if (loadState.status === "loading") {
    return (
      <div
        className="grid min-h-dvh place-items-center text-sm text-slate-500"
        role="status"
      >
        {englishMessages("common.bootstrap.loading")}
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div
          className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          role="alert"
        >
          <h1 className="text-base font-semibold">
            {englishMessages("common.bootstrap.errorTitle")}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {englishMessages("common.bootstrap.errorDescription")}
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-5 rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white"
          >
            {englishMessages("common.bootstrap.retry")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <I18nextProvider i18n={i18n}>
      <NotificationProvider>
        <BootstrapContext.Provider
          value={{
            snapshot: loadState.snapshot,
            isInitialSnapshot: Boolean(initialSnapshot),
            replaceSnapshot,
            retry,
          }}
        >
          {children}
        </BootstrapContext.Provider>
      </NotificationProvider>
    </I18nextProvider>
  );
}

export function useBootstrap() {
  const bootstrap = useContext(BootstrapContext);
  if (!bootstrap) {
    throw new Error("useBootstrap must be used inside BootstrapProvider");
  }
  return bootstrap;
}
