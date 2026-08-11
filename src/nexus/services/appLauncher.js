import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/*
  NEXUS APPLICATION LIFECYCLE
  ===========================
  1. Nexus launches an application's PROJECT BROWSER.
  2. Only after the application window is created successfully does Nexus hide.
  3. Closing the application window restores and focuses Nexus.
  4. Opening an already-running application focuses it and hides Nexus again.

  Global product rule:
    Nexus -> App Project Browser -> Project Editor
*/

const APP_WINDOWS = {
  vertix: {
    label: "vertix",
    title: "Vertix",
    projectBrowserUrl: "/stage.html",
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
  },

  soura: {
    label: "soura",
    title: "Soura",
    projectBrowserUrl: "/soura.html",
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 700,
  },
};

const nexusWindow = getCurrentWindow();

async function hideNexus() {
  try {
    await nexusWindow.hide();
  } catch (error) {
    console.error("[Nexus Launcher] Could not hide Nexus:", error);
  }
}

async function restoreNexus() {
  try {
    await nexusWindow.show();
    await nexusWindow.unminimize();
    await nexusWindow.setFocus();
  } catch (error) {
    console.error("[Nexus Launcher] Could not restore Nexus:", error);
  }
}

async function focusExistingWindow(window) {
  try {
    await window.unminimize();
  } catch (error) {
    console.warn("[Nexus Launcher] Could not unminimize application window:", error);
  }

  try {
    await window.show();
  } catch (error) {
    console.warn("[Nexus Launcher] Could not show application window:", error);
  }

  await window.setFocus();
  await hideNexus();
}

async function attachReturnToNexusLifecycle(appWindow) {
  try {
    await appWindow.onCloseRequested(async () => {
      await restoreNexus();
    });
  } catch (error) {
    console.warn("[Nexus Launcher] Could not attach close lifecycle:", error);
  }

  try {
    await appWindow.once("tauri://destroyed", async () => {
      await restoreNexus();
    });
  } catch (error) {
    console.warn("[Nexus Launcher] Could not attach destroyed lifecycle:", error);
  }
}

export async function launchMelogicApp(appId) {
  const config = APP_WINDOWS[appId];

  if (!config) {
    throw new Error(`Nexus does not have a project browser registered for ${appId}.`);
  }

  const existing = await WebviewWindow.getByLabel(config.label);

  if (existing) {
    await focusExistingWindow(existing);

    return {
      created: false,
      window: existing,
    };
  }

  const appWindow = new WebviewWindow(config.label, {
    url: config.projectBrowserUrl,
    title: config.title,

    width: config.width,
    height: config.height,

    minWidth: config.minWidth,
    minHeight: config.minHeight,

    center: true,

    resizable: true,
    maximizable: true,
    minimizable: true,
    closable: true,

    visible: true,
    focus: true,
  });

  return await new Promise((resolve, reject) => {
    appWindow.once("tauri://created", async () => {
      try {
        await attachReturnToNexusLifecycle(appWindow);
        await appWindow.setFocus();
        await hideNexus();
      } catch (error) {
        console.warn(
          `[Nexus Launcher] ${config.title} opened, but lifecycle setup encountered an issue:`,
          error,
        );
      }

      resolve({
        created: true,
        window: appWindow,
      });
    });

    appWindow.once("tauri://error", (event) => {
      console.error(
        `[Nexus Launcher] Failed to create ${config.title} project-browser window:`,
        event,
      );

      reject(
        new Error(
          `Nexus could not open the ${config.title} project browser.`,
        ),
      );
    });
  });
}

export async function showNexus() {
  await restoreNexus();
}
