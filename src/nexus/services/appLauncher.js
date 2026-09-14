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

const WINDOW_GEOMETRY_STORAGE_PREFIX =
  "melogic.nexus.window.";

const WINDOW_GEOMETRY_SAVE_DELAY_MS = 250;

const nexusWindow = getCurrentWindow();

function windowGeometryStorageKey(appId) {
  return `${WINDOW_GEOMETRY_STORAGE_PREFIX}${appId}`;
}

function clampDimension(value, minimum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.round(number));
}

function loadWindowGeometry(appId, config) {
  const fallback = {
    width: config.width,
    height: config.height,
    maximized: false,
  };

  try {
    const raw = localStorage.getItem(
      windowGeometryStorageKey(appId),
    );

    if (!raw) return fallback;

    const saved = JSON.parse(raw);

    return {
      width: clampDimension(
        saved?.width,
        config.minWidth,
        config.width,
      ),
      height: clampDimension(
        saved?.height,
        config.minHeight,
        config.height,
      ),
      maximized: saved?.maximized === true,
    };
  } catch (error) {
    console.warn(
      `[Nexus Launcher] Could not read saved window geometry for ${appId}:`,
      error,
    );
    return fallback;
  }
}

function saveWindowGeometry(appId, geometry) {
  try {
    localStorage.setItem(
      windowGeometryStorageKey(appId),
      JSON.stringify({
        width: Math.round(geometry.width),
        height: Math.round(geometry.height),
        maximized: geometry.maximized === true,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.warn(
      `[Nexus Launcher] Could not save window geometry for ${appId}:`,
      error,
    );
  }
}

async function readLogicalWindowSize(appWindow) {
  const [physicalSize, scaleFactor] = await Promise.all([
    appWindow.outerSize(),
    appWindow.scaleFactor(),
  ]);

  const scale = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;

  return {
    width: physicalSize.width / scale,
    height: physicalSize.height / scale,
  };
}

async function captureWindowGeometry(
  appId,
  config,
  appWindow,
  previousGeometry,
) {
  let maximized = false;

  try {
    maximized = await appWindow.isMaximized();
  } catch (error) {
    console.warn(
      `[Nexus Launcher] Could not read maximized state for ${config.title}:`,
      error,
    );
  }

  if (maximized) {
    const geometry = {
      ...previousGeometry,
      maximized: true,
    };

    saveWindowGeometry(appId, geometry);
    return geometry;
  }

  try {
    const size = await readLogicalWindowSize(appWindow);

    const geometry = {
      width: clampDimension(
        size.width,
        config.minWidth,
        config.width,
      ),
      height: clampDimension(
        size.height,
        config.minHeight,
        config.height,
      ),
      maximized: false,
    };

    saveWindowGeometry(appId, geometry);
    return geometry;
  } catch (error) {
    console.warn(
      `[Nexus Launcher] Could not capture window size for ${config.title}:`,
      error,
    );
    return previousGeometry;
  }
}

async function attachWindowGeometryPersistence(
  appId,
  config,
  appWindow,
  initialGeometry,
) {
  let lastGeometry = { ...initialGeometry };
  let saveTimer = null;
  let destroyed = false;

  const flush = async () => {
    if (destroyed) return;

    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    lastGeometry = await captureWindowGeometry(
      appId,
      config,
      appWindow,
      lastGeometry,
    );
  };

  const scheduleSave = () => {
    if (destroyed) return;

    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      flush().catch((error) => {
        console.warn(
          `[Nexus Launcher] Deferred window geometry save failed for ${config.title}:`,
          error,
        );
      });
    }, WINDOW_GEOMETRY_SAVE_DELAY_MS);
  };

  const unlisten = [];

  try {
    unlisten.push(
      await appWindow.onResized(scheduleSave),
    );
  } catch (error) {
    console.warn(
      `[Nexus Launcher] Could not observe resize events for ${config.title}:`,
      error,
    );
  }

  return {
    flush,

    dispose() {
      destroyed = true;

      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }

      for (const stop of unlisten) {
        try {
          stop?.();
        } catch {}
      }
    },
  };
}

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

async function attachReturnToNexusLifecycle(
  appWindow,
  geometryPersistence = null,
) {
  let forceCloseInProgress = false;

  try {
    await appWindow.onCloseRequested(async (event) => {
      /*
        Nexus owns this child-window lifecycle.

        Prevent Tauri's default close path, finish the geometry save, then
        force-destroy the child window. destroy() bypasses closeRequested,
        so this cannot recurse.
      */
      event.preventDefault();

      if (forceCloseInProgress) {
        return;
      }

      forceCloseInProgress = true;

      try {
        await geometryPersistence?.flush?.();
      } catch (error) {
        console.warn(
          "[Nexus Launcher] Could not flush window geometry before close:",
          error,
        );
      }

      try {
        await appWindow.destroy();
      } catch (error) {
        forceCloseInProgress = false;

        console.error(
          "[Nexus Launcher] Could not destroy application window:",
          error,
        );

        await restoreNexus();
        return;
      }

      await restoreNexus();
    });
  } catch (error) {
    console.warn(
      "[Nexus Launcher] Could not attach close lifecycle:",
      error,
    );
  }

  try {
    await appWindow.once("tauri://destroyed", async () => {
      geometryPersistence?.dispose?.();

      if (!forceCloseInProgress) {
        await restoreNexus();
      }
    });
  } catch (error) {
    console.warn(
      "[Nexus Launcher] Could not attach destroyed lifecycle:",
      error,
    );
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

  const savedGeometry =
    loadWindowGeometry(
      appId,
      config,
    );

  const appWindow = new WebviewWindow(config.label, {
    url: config.projectBrowserUrl,
    title: config.title,

    width: savedGeometry.width,
    height: savedGeometry.height,

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
        const geometryPersistence =
          await attachWindowGeometryPersistence(
            appId,
            config,
            appWindow,
            savedGeometry,
          );

        await attachReturnToNexusLifecycle(
          appWindow,
          geometryPersistence,
        );

        if (savedGeometry.maximized) {
          try {
            await appWindow.maximize();
          } catch (error) {
            console.warn(
              `[Nexus Launcher] Could not restore maximized state for ${config.title}:`,
              error,
            );
          }
        }

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
