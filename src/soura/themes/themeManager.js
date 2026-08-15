/**
 * Soura experimental theme manager.
 *
 * Deliberately session-only:
 * - no localStorage
 * - no automatic theme activation
 * - default Soura remains unchanged
 *
 * Console:
 *   SouraThemes.enable("light")
 *   SouraThemes.disable()
 *   SouraThemes.current()
 *   SouraThemes.list()
 */
const THEMES = Object.freeze({
  light: new URL("./light.css", import.meta.url).href,
});

const LINK_ID = "soura-experimental-theme";
let activeTheme = null;

function removeThemeLink() {
  document.getElementById(LINK_ID)?.remove();
}

async function enable(name) {
  const key = String(name || "").trim().toLowerCase();
  const href = THEMES[key];

  if (!href) {
    throw new Error(
      `[SouraThemes] Unknown theme "${name}". Available: ${Object.keys(THEMES).join(", ")}`
    );
  }

  removeThemeLink();

  const link = document.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.souraTheme = key;

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error(`[SouraThemes] Failed to load theme "${key}".`)),
      { once: true }
    );
  });

  document.head.appendChild(link);

  try {
    await loaded;
    activeTheme = key;
    document.documentElement.dataset.souraTheme = key;
    console.info(`[SouraThemes] Enabled "${key}" for this session.`);
    return key;
  } catch (error) {
    removeThemeLink();
    activeTheme = null;
    delete document.documentElement.dataset.souraTheme;
    throw error;
  }
}

function disable() {
  removeThemeLink();
  activeTheme = null;
  delete document.documentElement.dataset.souraTheme;
  console.info("[SouraThemes] Experimental theme disabled.");
}

function current() {
  return activeTheme;
}

function list() {
  return Object.keys(THEMES);
}

export function installSouraThemeConsole() {
  if (typeof window === "undefined") return null;

  const api = Object.freeze({ enable, disable, current, list });
  Object.defineProperty(window, "SouraThemes", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });

  return api;
}
