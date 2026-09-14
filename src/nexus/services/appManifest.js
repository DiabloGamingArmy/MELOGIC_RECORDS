/*
  Melogic Nexus - application manifest
*/

const APP_ICON_ROOT = "/assets/app-icons";

export const NEXUS_APP_MANIFEST_VERSION = 1;

export const NEXUS_RELEASE_CHANNELS = Object.freeze({
  stable: "stable",
  beta: "beta",
  development: "development",
  unreleased: "unreleased",
});

export const NEXUS_INSTALL_STRATEGIES = Object.freeze({
  bundled: "bundled-runtime",
  managed: "nexus-managed",
  unavailable: "unavailable",
});

const RAW_MANIFEST = [
  {
    id: "vertix",
    name: "Vertix",
    category: "3D & Animation",
    description: "3D visualization, stage design, and animation.",
    accent: "V",
    icon: `${APP_ICON_ROOT}/vertix.png`,
    release: {
      channel: NEXUS_RELEASE_CHANNELS.beta,
      displayVersion: "v0.0",
      available: true,
    },
    install: {
      strategy: NEXUS_INSTALL_STRATEGIES.bundled,
      installable: false,
      uninstallable: false,
      repairable: false,
      managedByNexus: false,
    },
    launch: {
      enabled: true,
      label: "vertix",
      title: "Vertix",
      projectBrowserUrl: "/stage.html",
      window: {
        width: 1440,
        height: 900,
        minWidth: 1050,
        minHeight: 700,
      },
    },
  },
  {
    id: "soura",
    name: "Soura",
    category: "Audio Production",
    description: "Music creation, recording, editing, mixing, and production.",
    accent: "S",
    icon: `${APP_ICON_ROOT}/soura.png`,
    release: {
      channel: NEXUS_RELEASE_CHANNELS.stable,
      displayVersion: "Web",
      available: true,
    },
    install: {
      strategy: NEXUS_INSTALL_STRATEGIES.bundled,
      installable: false,
      uninstallable: false,
      repairable: false,
      managedByNexus: false,
    },
    launch: {
      enabled: true,
      label: "soura",
      title: "Soura",
      projectBrowserUrl: "/soura.html",
      window: {
        width: 1440,
        height: 900,
        minWidth: 1050,
        minHeight: 700,
      },
    },
  },
  {
    id: "cineara",
    name: "Cineara",
    category: "Video Editing",
    description: "Video editing and post-production.",
    accent: "C",
    icon: `${APP_ICON_ROOT}/cineara.png`,
    release: {
      channel: NEXUS_RELEASE_CHANNELS.unreleased,
      displayVersion: "—",
      available: false,
    },
    install: {
      strategy: NEXUS_INSTALL_STRATEGIES.unavailable,
      installable: false,
      uninstallable: false,
      repairable: false,
      managedByNexus: false,
    },
    launch: { enabled: false },
  },
  {
    id: "inkora",
    name: "Inkora",
    category: "Graphics & Artwork",
    description: "2D graphics, artwork, and visual design.",
    accent: "I",
    icon: `${APP_ICON_ROOT}/inkora.png`,
    release: {
      channel: NEXUS_RELEASE_CHANNELS.unreleased,
      displayVersion: "—",
      available: false,
    },
    install: {
      strategy: NEXUS_INSTALL_STRATEGIES.unavailable,
      installable: false,
      uninstallable: false,
      repairable: false,
      managedByNexus: false,
    },
    launch: { enabled: false },
  },
  {
    id: "lucentra",
    name: "Lucentra",
    category: "Live Performance",
    description: "Live performance, playback, and show execution.",
    accent: "L",
    icon: `${APP_ICON_ROOT}/lucentra.png`,
    release: {
      channel: NEXUS_RELEASE_CHANNELS.unreleased,
      displayVersion: "—",
      available: false,
    },
    install: {
      strategy: NEXUS_INSTALL_STRATEGIES.unavailable,
      installable: false,
      uninstallable: false,
      repairable: false,
      managedByNexus: false,
    },
    launch: { enabled: false },
  },
  {
    id: "rundown-pilot",
    name: "Rundown Pilot",
    category: "Show Control",
    description: "Production rundown and show-control management.",
    accent: "R",
    icon: `${APP_ICON_ROOT}/rundown-pilot.png`,
    release: {
      channel: NEXUS_RELEASE_CHANNELS.unreleased,
      displayVersion: "—",
      available: false,
    },
    install: {
      strategy: NEXUS_INSTALL_STRATEGIES.unavailable,
      installable: false,
      uninstallable: false,
      repairable: false,
      managedByNexus: false,
    },
    launch: { enabled: false },
  },
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return value;
}

function validateManifest(apps) {
  const ids = new Set();
  const labels = new Set();

  for (const app of apps) {
    if (!app?.id || typeof app.id !== "string") {
      throw new Error("[Nexus Manifest] Every application requires a string id.");
    }

    if (ids.has(app.id)) {
      throw new Error(`[Nexus Manifest] Duplicate application id: ${app.id}`);
    }

    ids.add(app.id);

    if (!app.name || !app.category || !app.icon) {
      throw new Error(
        `[Nexus Manifest] ${app.id} is missing required presentation metadata.`,
      );
    }

    if (!app.release || typeof app.release.available !== "boolean") {
      throw new Error(
        `[Nexus Manifest] ${app.id} is missing release availability metadata.`,
      );
    }

    if (!app.install?.strategy) {
      throw new Error(
        `[Nexus Manifest] ${app.id} is missing an install strategy.`,
      );
    }

    if (app.launch?.enabled) {
      const launch = app.launch;
      const window = launch.window;

      if (!launch.label || !launch.title || !launch.projectBrowserUrl || !window) {
        throw new Error(
          `[Nexus Manifest] ${app.id} is launchable but has incomplete launch metadata.`,
        );
      }

      if (labels.has(launch.label)) {
        throw new Error(
          `[Nexus Manifest] Duplicate Tauri window label: ${launch.label}`,
        );
      }

      labels.add(launch.label);

      for (const key of ["width", "height", "minWidth", "minHeight"]) {
        if (!Number.isFinite(window[key]) || window[key] <= 0) {
          throw new Error(
            `[Nexus Manifest] ${app.id} has invalid window.${key}.`,
          );
        }
      }
    }
  }
}

validateManifest(RAW_MANIFEST);

export const NEXUS_APP_MANIFEST = deepFreeze([...RAW_MANIFEST]);

export function getNexusAppManifest() {
  return NEXUS_APP_MANIFEST;
}

export function getNexusAppById(appId) {
  const id = typeof appId === "string" ? appId.trim() : "";
  if (!id) return null;

  return NEXUS_APP_MANIFEST.find((app) => app.id === id) || null;
}

export function isNexusAppLaunchable(appOrId) {
  const app =
    typeof appOrId === "string"
      ? getNexusAppById(appOrId)
      : appOrId;

  return Boolean(app?.release?.available && app?.launch?.enabled);
}

export function getNexusLaunchConfig(appId) {
  const app = getNexusAppById(appId);

  if (!isNexusAppLaunchable(app)) {
    return null;
  }

  return {
    appId: app.id,
    label: app.launch.label,
    title: app.launch.title,
    projectBrowserUrl: app.launch.projectBrowserUrl,
    ...app.launch.window,
  };
}

export function getNexusAppCatalog() {
  return NEXUS_APP_MANIFEST.map((app) => ({
    id: app.id,
    name: app.name,
    category: app.category,
    description: app.description,
    accent: app.accent,
    icon: app.icon,
    status: app.release.available
      ? app.release.channel === NEXUS_RELEASE_CHANNELS.beta
        ? "Beta"
        : "Available"
      : "Coming Soon",
    version: app.release.displayVersion,
    action: isNexusAppLaunchable(app) ? "Open" : "Unavailable",
    releaseChannel: app.release.channel,
    installStrategy: app.install.strategy,
    managedByNexus: app.install.managedByNexus,
  }));
}
