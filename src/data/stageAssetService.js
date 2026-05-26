import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { STORAGE_PATHS } from '../config/storagePaths'

export const STAGE_ASSET_CATEGORIES = ['Stages', 'Audio', 'Lighting', 'Rigging', 'Video', 'Backline', 'Performers', 'Venue']

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

export async function listStageAssetCategories() {
  return [...STAGE_ASSET_CATEGORIES]
}

export async function listFeaturedStageTemplates() {
  return [
    { id: 'festival-a', name: 'Festival Main A', tags: ['Outdoor', 'Large format'], status: 'preview' },
    { id: 'club-b', name: 'Club Standard B', tags: ['Indoor', 'Compact'], status: 'preview' },
    { id: 'broadcast-c', name: 'Broadcast Set C', tags: ['TV', 'Multicam'], status: 'preview' }
  ]
}

export async function getStageProjectScaffold(projectId = '') {
  const id = String(projectId || '').trim() || 'draft-stage-project'
  return {
    id,
    title: 'Untitled Stage Plan',
    units: 'ft',
    snap: 'grid-2ft',
    viewportMode: 'audience',
    selectedObject: 'stageDeck',
    status: 'foundation-preview',
    storage: getStageAssetStorageRoots(id)
  }
}
