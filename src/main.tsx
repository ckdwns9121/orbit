import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { applyTheme, getStoredTheme } from "./shared/config/theme/theme";

applyTheme(getStoredTheme());

const windowLabel = getCurrentWindow().label;
if (windowLabel !== "tray") {
  void getCurrentWebview().setZoom(1.2).catch((cause) => {
    console.warn("Orbit UI 배율을 적용하지 못했습니다.", cause);
  });
}

const componentPromise = windowLabel === "tray"
  ? import("./widgets/tray")
  : import("./app/App");

void componentPromise.then(({ default: RootComponent }) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <RootComponent />
    </React.StrictMode>,
  );
});
