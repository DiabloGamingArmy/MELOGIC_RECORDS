/*
  Melogic desktop application runtime detector
  =============================================
  Loaded only by application/editor HTML entries.

  On the public website, application pages retain the website shell.
  Inside a Tauri/Nexus window, the page switches into desktop application
  mode and the global website navigation is removed from the visual layout.
*/

function isTauriRuntime() {
  return Boolean(
    globalThis.__TAURI_INTERNALS__
    || globalThis.__TAURI__
    || navigator.userAgent.includes("Tauri")
  );
}

export const isMelogicDesktopApp = isTauriRuntime();

if (isMelogicDesktopApp) {
  document.documentElement.classList.add(
    "melogic-desktop-app",
  );

  document.documentElement.dataset.melogicRuntime =
    "desktop";
} else {
  document.documentElement.dataset.melogicRuntime =
    "web";
}

/*
  Native application-window close guard
  -------------------------------------
  Nexus already handles returning itself when an application window receives
  a native close request. The application window must still be destroyed.
  Tauri Window.destroy() intentionally bypasses another closeRequested cycle,
  preventing the Soura window from remaining alive after the red macOS close
  button is pressed.
*/
if (isMelogicDesktopApp && !globalThis.__melogicNativeCloseGuardInstalled) {
  globalThis.__melogicNativeCloseGuardInstalled = true;

  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const currentWindow = getCurrentWindow();

      await currentWindow.onCloseRequested(async () => {
        try {
          await currentWindow.destroy();
        } catch (error) {
          console.error('[application-runtime] Failed to destroy application window.', error);
        }
      });
    })
    .catch((error) => {
      console.error('[application-runtime] Failed to install native close guard.', error);
    });
}

