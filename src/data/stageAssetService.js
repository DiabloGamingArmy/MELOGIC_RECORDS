import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { STORAGE_PATHS } from '../config/storagePaths'

export const STAGE_ASSET_CATEGORIES = [
  { key: 'stages', label: 'Stages' },
  { key: 'audio', label: 'Audio' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'rigging', label: 'Rigging' },
  { key: 'video', label: 'Video' },
  { key: 'backline', label: 'Backline' },
  { key: 'performers', label: 'Performers' },
  { key: 'venue', label: 'Venue' }
]

export const STAGE_PLACEHOLDER_ASSETS = [
  { id: 'club-stage-32x20', name: 'Club Stage 32x20', category: 'stages', type: 'deck' },
  { id: 'drum-kit-standard', name: 'Drum Kit Standard', category: 'backline', type: 'instrument' },
  { id: 'moving-head-basic', name: 'Moving Head Basic', category: 'lighting', type: 'fixture' },
  { id: 'truss-10ft-box', name: 'Truss 10ft Box', category: 'rigging', type: 'truss' },
  { id: 'camera-tripod', name: 'Camera Tripod', category: 'video', type: 'camera' },
  { id: 'pa-speaker-stack', name: 'PA Speaker Stack', category: 'audio', type: 'speaker' },
  { id: 'barricade-8ft', name: 'Barricade 8ft', category: 'venue', type: 'barrier' },
  { id: 'vocalist-marker', name: 'Vocalist Marker', category: 'performers', type: 'marker' }
]

export function normalizeStageAsset(assetId, raw = {}) {
  return {
    id: assetId,
    slug: raw.slug || assetId,
    name: raw.name || 'Untitled Stage Asset',
    category: raw.category || 'venue',
    type: raw.type || 'generic',
    status: raw.status || 'draft',
    version: Number(raw.version || 1),
    latestVersion: Number(raw.latestVersion || raw.version || 1),
    modelPath: raw.modelPath || '',
    thumbnailPath: raw.thumbnailPath || '',
    previewPath: raw.previewPath || '',
    manifestPath: raw.manifestPath || '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    dimensions: raw.dimensions || null,
    createdBy: raw.createdBy || '',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null
  }
}

export function getStageAssetCollectionNames() {
  return {
    assets: FIRESTORE_COLLECTIONS.stageAssets,
    drafts: FIRESTORE_COLLECTIONS.stageAssetDrafts,
    packs: FIRESTORE_COLLECTIONS.stageAssetPacks,
    templates: FIRESTORE_COLLECTIONS.stageTemplates,
    projects: FIRESTORE_COLLECTIONS.stageProjects
  }
}

export function getStageAssetStorageRoots(projectId = '') {
  return {
    projectRoot: STORAGE_PATHS.stageProjectRoot(projectId),
    assetsRoot: STORAGE_PATHS.stageProjectAssetsRoot(projectId),
    thumbnailsRoot: STORAGE_PATHS.stageProjectThumbnailsRoot(projectId),
    snapshotsRoot: STORAGE_PATHS.stageProjectSnapshotsRoot(projectId),
    exportsRoot: STORAGE_PATHS.stageProjectExportsRoot(projectId)
  }
}

// TODO: Future: load published stage assets from Firestore when Stage library backend is available.
export async function listPublishedStageAssets() {
  try {
    return STAGE_PLACEHOLDER_ASSETS.map((asset) => normalizeStageAsset(asset.id, { ...asset, status: 'published' }))
  } catch {
    return []
  }
}
