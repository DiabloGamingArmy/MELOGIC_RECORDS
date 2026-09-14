/*
  Melogic Nexus — canonical project registry contract.
  Patch 01 establishes metadata ownership before filesystem discovery/UI work.
*/
export const MELOGIC_PROJECT_SCHEMA_VERSION = 1;

export const PROJECT_APPLICATIONS = Object.freeze({
  vertix: Object.freeze({ id: "vertix", name: "Vertix", category: "3D & Animation" }),
  soura: Object.freeze({ id: "soura", name: "Soura", category: "Audio Production" }),
  cineara: Object.freeze({ id: "cineara", name: "Cineara", category: "Video Editing" }),
  inkora: Object.freeze({ id: "inkora", name: "Inkora", category: "Graphics & Artwork" }),
  lucentra: Object.freeze({ id: "lucentra", name: "Lucentra", category: "Live Performance" }),
  "rundown-pilot": Object.freeze({ id: "rundown-pilot", name: "Rundown Pilot", category: "Show Control" }),
});

export const MELOGIC_PROJECT_REGISTRY_STORAGE_KEY =
  "melogic.nexus.projects.registry.v1";

export const MELOGIC_PROJECT_REGISTRY_EVENT =
  "melogic:nexus-project-registry-changed";

const LEGACY_SEED_PROJECTS = Object.freeze([
  Object.freeze({
    id: "legacy-vertix-beta-project",
    name: "Vertix Beta Project",
    applicationId: "vertix",
    modifiedLabel: "Recently",
    metadata: { source: "legacy-nexus-placeholder" },
  }),
  Object.freeze({
    id: "legacy-soura-untitled-audio-project",
    name: "Untitled Audio Project",
    applicationId: "soura",
    modifiedLabel: "Recently",
    metadata: { source: "legacy-nexus-placeholder" },
  }),
]);

const EMPTY_REGISTRY = Object.freeze({
  schemaVersion: MELOGIC_PROJECT_SCHEMA_VERSION,
  projects: Object.freeze([]),
});


function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullableString(value) {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(cleanString).filter(Boolean))];
}

function normalizeCloud(cloud) {
  const source = cloud && typeof cloud === "object" ? cloud : {};
  const allowedStates = new Set(["local", "synced", "syncing", "conflict", "error"]);
  return {
    enabled: Boolean(source.enabled),
    state: allowedStates.has(source.state) ? source.state : "local",
    remoteId: cleanNullableString(source.remoteId),
    lastSyncedAt: normalizeIsoDate(source.lastSyncedAt),
  };
}

export function formatProjectModified(isoDate, now = new Date()) {
  if (!isoDate) return "Recently";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Recently";
  const deltaMs = now.getTime() - date.getTime();
  if (deltaMs < 0) return "Recently";
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  }).format(date);
}

export function createProjectRecord(input = {}) {
  const applicationId = cleanString(input.applicationId || input.appId);
  const application = PROJECT_APPLICATIONS[applicationId];
  if (!application) {
    throw new Error(`[Nexus Projects] Unknown applicationId: ${applicationId || "(empty)"}`);
  }

  const name = cleanString(input.name);
  if (!name) throw new Error("[Nexus Projects] Project name is required.");

  const id = cleanString(input.id) || `${applicationId}:${name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  const createdAt = normalizeIsoDate(input.createdAt);
  const modifiedAt = normalizeIsoDate(input.modifiedAt) || createdAt;

  return {
    schemaVersion: MELOGIC_PROJECT_SCHEMA_VERSION,
    id,
    name,
    applicationId,
    applicationName: application.name,
    projectPath: cleanNullableString(input.projectPath),
    projectFile: cleanNullableString(input.projectFile),
    thumbnailPath: cleanNullableString(input.thumbnailPath),
    createdAt,
    modifiedAt,
    modifiedLabel: cleanString(input.modifiedLabel) || formatProjectModified(modifiedAt),
    favorite: Boolean(input.favorite),
    tags: normalizeTags(input.tags),
    cloud: normalizeCloud(input.cloud),
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? { ...input.metadata } : {},
  };
}

export function validateProjectRecord(project) {
  const errors = [];
  if (!project || typeof project !== "object") {
    return { valid: false, errors: ["Project record must be an object."] };
  }
  if (project.schemaVersion !== MELOGIC_PROJECT_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${project.schemaVersion}`);
  }
  if (!cleanString(project.id)) errors.push("id is required.");
  if (!cleanString(project.name)) errors.push("name is required.");
  if (!PROJECT_APPLICATIONS[cleanString(project.applicationId)]) {
    errors.push("applicationId must identify a registered Melogic application.");
  }
  return { valid: errors.length === 0, errors };
}

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && window.localStorage;
  } catch {
    return false;
  }
}

function cloneRegistry(registry) {
  return {
    schemaVersion: MELOGIC_PROJECT_SCHEMA_VERSION,
    projects: registry.projects.map((project) => ({ ...project })),
  };
}

function createEmptyRegistry() {
  return cloneRegistry(EMPTY_REGISTRY);
}

function normalizeStoredRegistry(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.projects)) {
    return createEmptyRegistry();
  }

  const projects = [];

  for (const candidate of value.projects) {
    try {
      const normalized = createProjectRecord(candidate);
      const validation = validateProjectRecord(normalized);

      if (validation.valid) {
        projects.push(normalized);
      } else {
        console.warn(
          "[Nexus Projects] Ignoring invalid stored project:",
          validation.errors,
          candidate,
        );
      }
    } catch (error) {
      console.warn(
        "[Nexus Projects] Ignoring unreadable stored project:",
        error,
        candidate,
      );
    }
  }

  return {
    schemaVersion: MELOGIC_PROJECT_SCHEMA_VERSION,
    projects,
  };
}

function readStoredRegistry() {
  if (!canUseLocalStorage()) {
    return createEmptyRegistry();
  }

  const raw = window.localStorage.getItem(
    MELOGIC_PROJECT_REGISTRY_STORAGE_KEY,
  );

  if (!raw) {
    return createEmptyRegistry();
  }

  try {
    return normalizeStoredRegistry(JSON.parse(raw));
  } catch (error) {
    console.error(
      "[Nexus Projects] Registry JSON is corrupt. Stored data was not overwritten.",
      error,
    );
    return createEmptyRegistry();
  }
}

function writeStoredRegistry(registry, { emit = true } = {}) {
  const normalized = normalizeStoredRegistry(registry);

  if (canUseLocalStorage()) {
    window.localStorage.setItem(
      MELOGIC_PROJECT_REGISTRY_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  }

  if (emit && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(MELOGIC_PROJECT_REGISTRY_EVENT, {
        detail: {
          projects: normalized.projects.map((project) => ({ ...project })),
        },
      }),
    );
  }

  return normalized;
}

function initializeRegistryIfNeeded() {
  const registry = readStoredRegistry();

  if (registry.projects.length > 0) {
    return registry;
  }

  const seeded = {
    schemaVersion: MELOGIC_PROJECT_SCHEMA_VERSION,
    projects: LEGACY_SEED_PROJECTS.map(createProjectRecord),
  };

  return writeStoredRegistry(seeded, { emit: false });
}

function projectSortTime(project) {
  const value = project.modifiedAt || project.createdAt;
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareModifiedDescending(a, b) {
  return projectSortTime(b) - projectSortTime(a);
}

function findProjectIndex(projects, projectId) {
  const id = cleanString(projectId);
  if (!id) return -1;
  return projects.findIndex((project) => project.id === id);
}

export function getProjectRegistry() {
  return initializeRegistryIfNeeded().projects.map((project) => ({
    ...project,
    cloud: { ...project.cloud },
    tags: [...project.tags],
    metadata: { ...project.metadata },
  }));
}

export function getRecentProjects({ limit = 8 } = {}) {
  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : 8;

  return getProjectRegistry()
    .sort(compareModifiedDescending)
    .slice(0, safeLimit)
    .map((project) => ({
      ...project,
      modifiedLabel: project.modifiedAt
        ? formatProjectModified(project.modifiedAt)
        : project.modifiedLabel,
    }));
}

export function getProjectById(projectId) {
  const id = cleanString(projectId);
  if (!id) return null;

  return (
    getProjectRegistry().find((project) => project.id === id) || null
  );
}

export function getProjectsForApplication(applicationId) {
  const id = cleanString(applicationId);

  return getProjectRegistry().filter(
    (project) => project.applicationId === id,
  );
}

export function registerProject(input) {
  const project = createProjectRecord(input);
  const registry = initializeRegistryIfNeeded();

  if (findProjectIndex(registry.projects, project.id) !== -1) {
    throw new Error(
      `[Nexus Projects] Project already registered: ${project.id}`,
    );
  }

  registry.projects.push(project);
  writeStoredRegistry(registry);

  return { ...project };
}

export function upsertProject(input) {
  const project = createProjectRecord(input);
  const registry = initializeRegistryIfNeeded();
  const index = findProjectIndex(registry.projects, project.id);

  if (index === -1) {
    registry.projects.push(project);
  } else {
    registry.projects[index] = project;
  }

  writeStoredRegistry(registry);
  return { ...project };
}

export function updateProject(projectId, changes = {}) {
  const registry = initializeRegistryIfNeeded();
  const index = findProjectIndex(registry.projects, projectId);

  if (index === -1) {
    throw new Error(`[Nexus Projects] Unknown project: ${projectId}`);
  }

  const current = registry.projects[index];

  const updated = createProjectRecord({
    ...current,
    ...changes,
    id: current.id,
    applicationId: changes.applicationId || current.applicationId,
    metadata: {
      ...current.metadata,
      ...(changes.metadata || {}),
    },
    cloud: {
      ...current.cloud,
      ...(changes.cloud || {}),
    },
  });

  registry.projects[index] = updated;
  writeStoredRegistry(registry);

  return { ...updated };
}

export function unregisterProject(projectId) {
  const registry = initializeRegistryIfNeeded();
  const index = findProjectIndex(registry.projects, projectId);

  if (index === -1) {
    return false;
  }

  registry.projects.splice(index, 1);
  writeStoredRegistry(registry);

  return true;
}

export function setProjectFavorite(projectId, favorite) {
  return updateProject(projectId, {
    favorite: Boolean(favorite),
  });
}

export function touchProject(projectId, modifiedAt = new Date()) {
  const date =
    modifiedAt instanceof Date
      ? modifiedAt
      : new Date(modifiedAt);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      "[Nexus Projects] touchProject received an invalid date.",
    );
  }

  return updateProject(projectId, {
    modifiedAt: date.toISOString(),
    modifiedLabel: "",
  });
}

export function replaceProjectRegistry(projects) {
  if (!Array.isArray(projects)) {
    throw new Error(
      "[Nexus Projects] replaceProjectRegistry expects an array.",
    );
  }

  const normalized = {
    schemaVersion: MELOGIC_PROJECT_SCHEMA_VERSION,
    projects: projects.map(createProjectRecord),
  };

  return writeStoredRegistry(normalized).projects;
}

export function clearProjectRegistry({ reseedLegacy = false } = {}) {
  const registry = {
    schemaVersion: MELOGIC_PROJECT_SCHEMA_VERSION,
    projects: reseedLegacy
      ? LEGACY_SEED_PROJECTS.map(createProjectRecord)
      : [],
  };

  writeStoredRegistry(registry);
  return [];
}

export function subscribeProjectRegistry(listener) {
  if (typeof listener !== "function") {
    throw new TypeError(
      "[Nexus Projects] subscribeProjectRegistry requires a function.",
    );
  }

  if (typeof window === "undefined") {
    return () => {};
  }

  const handleInternal = () => listener(getProjectRegistry());

  const handleStorage = (event) => {
    if (event.key === MELOGIC_PROJECT_REGISTRY_STORAGE_KEY) {
      listener(getProjectRegistry());
    }
  };

  window.addEventListener(
    MELOGIC_PROJECT_REGISTRY_EVENT,
    handleInternal,
  );
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(
      MELOGIC_PROJECT_REGISTRY_EVENT,
      handleInternal,
    );
    window.removeEventListener("storage", handleStorage);
  };
}

