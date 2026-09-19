import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { BootstrapProvider } from "./bootstrap-state";
import { router } from "./router";
import { AppSettingsProvider } from "./settings-store";
import "./styles.css";
import { TaskStoreProvider } from "./task-store";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <BootstrapProvider>
      <AppSettingsProvider>
        <TaskStoreProvider>
          <RouterProvider router={router} />
        </TaskStoreProvider>
      </AppSettingsProvider>
    </BootstrapProvider>
  </StrictMode>,
);
