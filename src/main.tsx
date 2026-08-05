import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyTheme, getStoredTheme } from "./theme/theme";

applyTheme(getStoredTheme());

const componentPromise = getCurrentWindow().label === "tray"
  ? import("./tray/TrayApp")
  : import("./App");

void componentPromise.then(({ default: RootComponent }) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <RootComponent />
    </React.StrictMode>,
  );
});
