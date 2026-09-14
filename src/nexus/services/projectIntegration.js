/*
  Melogic Nexus - application project integration bridge

  Converts application-owned project records into the stable Nexus Project
  Schema. Nexus indexes metadata; it does not own the source project document.
*/

import {
  getProjectRegistry,
  unregisterProject,
  upsertProject,
} from "./projectRegistry";

const SOURCE_SOURA_CLOUD = "soura-cloud";
const SOURCE_VERTIX_CLOUD = "vertix-cloud";
const LEGACY_SOURCE = "legacy-nexus-placeholder";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function timestampToIso(value) {
  if (!value) return null;

  try {
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    if (typeof value.toMillis === "function") {
      const millis = value.toMillis();
      if (Number.isFinite(millis)) {
        return new Date(millis).toISOString();
      }
    }

    if (typeof value.seconds === "number") {
      const millis =
        value.seconds * 1000 +
        Math.floor(Number(value.nanoseconds || 0) / 1_000_000);

      return new Date(millis).toISOString();
    }

    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // Ignore malformed external timestamp values.
  }

  return null;
}

function projectSourceId(applicationId, projectId) {
  const id = cleanString(projectId);
  return id ? `${applicationId}:${id}` : "";
}

function preserveUserMetadata(existing, next) {
  if (!existing) return next;

  return {
    ...next,
    favorite: Boolean(existing.favorite),
    tags:
      Array.isArray(existing.tags) && existing.tags.length
        ? existing.tags
        : next.tags,
  };
}

function removeLegacyPlaceholder(applicationId) {
  for (const project of getProjectRegistry()) {
    if (
      project.applicationId === applicationId &&
      project.metadata?.source === LEGACY_SOURCE
    ) {
      unregisterProject(project.id);
    }
  }
}

function reconcileCloudSource({
  applicationId,
  source,
  records,
}) {
  const current = getProjectRegistry();
  const incomingIds = new Set(records.map((record) => record.id));

  for (const project of current) {
    if (
      project.applicationId !== applicationId ||
      project.metadata?.source !== source
    ) {
      continue;
    }

    if (!incomingIds.has(project.id)) {
      unregisterProject(project.id);
    }
  }

  for (const record of records) {
    const existing = getProjectRegistry().find(
      (project) => project.id === record.id,
    );

    upsertProject(preserveUserMetadata(existing, record));
  }

  removeLegacyPlaceholder(applicationId);
  return records.length;
}

function souraProjectRecord(project) {
  const sourceProjectId = cleanString(project?.id);
  if (!sourceProjectId) return null;

  const modifiedAt =
    timestampToIso(project.lastOpenedAt) ||
    timestampToIso(project.updatedAt) ||
    timestampToIso(project.createdAt);

  const createdAt = timestampToIso(project.createdAt);
  const type = cleanString(project.type);
  const bpm = Number(project.bpm);
  const key = cleanString(project.key);

  const tags = [
    type,
    Number.isFinite(bpm) ? `${bpm} BPM` : "",
    key,
  ].filter(Boolean);

  return {
    id: projectSourceId("soura", sourceProjectId),
    name: cleanString(project.title) || "Untitled Soura Project",
    applicationId: "soura",
    createdAt,
    modifiedAt,
    favorite: false,
    tags,
    cloud: {
      enabled: true,
      state: "synced",
      remoteId: sourceProjectId,
      lastSyncedAt: new Date().toISOString(),
    },
    metadata: {
      source: SOURCE_SOURA_CLOUD,
      sourceProjectId,
      type: type || null,
      bpm: Number.isFinite(bpm) ? bpm : null,
      key: key || null,
    },
  };
}

function vertixProjectRecord(project) {
  const sourceProjectId = cleanString(project?.id);
  if (!sourceProjectId) return null;

  const modifiedAt =
    timestampToIso(project.lastOpenedAt) ||
    timestampToIso(project.updatedAt) ||
    timestampToIso(project.createdAt);

  const createdAt = timestampToIso(project.createdAt);
  const stageType = cleanString(project.stageType);

  return {
    id: projectSourceId("vertix", sourceProjectId),
    name: cleanString(project.title) || "Untitled Vertix Project",
    applicationId: "vertix",
    createdAt,
    modifiedAt,
    favorite: false,
    tags: [stageType].filter(Boolean),
    cloud: {
      enabled: true,
      state: "synced",
      remoteId: sourceProjectId,
      lastSyncedAt: new Date().toISOString(),
    },
    metadata: {
      source: SOURCE_VERTIX_CLOUD,
      sourceProjectId,
      stageType: stageType || null,
      ownerId: cleanString(project.ownerId) || null,
    },
  };
}

export function syncSouraProjectsToNexus(projects) {
  if (!Array.isArray(projects)) return 0;

  const records = projects
    .map(souraProjectRecord)
    .filter(Boolean);

  return reconcileCloudSource({
    applicationId: "soura",
    source: SOURCE_SOURA_CLOUD,
    records,
  });
}

export function syncVertixProjectsToNexus(projects) {
  if (!Array.isArray(projects)) return 0;

  const records = projects
    .map(vertixProjectRecord)
    .filter(Boolean);

  return reconcileCloudSource({
    applicationId: "vertix",
    source: SOURCE_VERTIX_CLOUD,
    records,
  });
}

export function indexSingleSouraProject(project) {
  const record = souraProjectRecord(project);
  if (!record) return null;

  const existing = getProjectRegistry().find(
    (candidate) => candidate.id === record.id,
  );

  const saved = upsertProject(
    preserveUserMetadata(existing, record),
  );

  removeLegacyPlaceholder("soura");
  return saved;
}
