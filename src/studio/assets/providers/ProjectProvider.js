import { listAccessibleStudioProjects } from '../../../data/studioProjectService.js'
import { normalizeAsset, stableAssetId } from '../assetModel.js'
import { getStorageAssetUrl } from '../../../firebase/storageAssets.js'

export class ProjectProvider {
  constructor({ listProjects = listAccessibleStudioProjects } = {}) { this.id = 'project'; this.sourceType = 'project'; this.listProjects = listProjects }
  async listAssets({ uid = '', currentProjectId = '' } = {}) {
    if (!uid) return []
    const projects = await this.listProjects(uid)
    return projects.filter((project) => project.id !== currentProjectId).flatMap((project) => {
      const projectFolderId = stableAssetId('project-folder', project.id)
      const folder = normalizeAsset({ id: projectFolderId, name: project.title, kind: 'collection', sourceType: 'project', parentId: 'project', readOnly: true, source: { projectId: project.id } })
      const regions = (project.editorState?.regions || project.editorState?.midiRegions || []).filter((region) => region.type === 'audio' && region.audioClip?.storagePath)
      return [folder, ...regions.map((region) => normalizeAsset({
        id: stableAssetId('project-audio', `${project.id}|${region.audioClip.audioAssetId || region.id}`),
        name: region.name || region.audioClip.fileName || 'Project audio',
        kind: 'audio', sourceType: 'project', parentId: projectFolderId, readOnly: true,
        audio: { duration: region.fileDurationSeconds || region.audioClip.fileDurationSeconds, channels: region.audioClip.channelCount, sampleRate: region.audioClip.sampleRate, format: String(region.audioClip.fileName || '').split('.').pop(), byteSize: region.audioClip.fileSizeBytes },
        source: { projectId: project.id, storagePath: region.audioClip.storagePath, sourceRegionId: region.id, contentType: region.audioClip.contentType }
      }))]
    })
  }
  async resolveAsset(asset) {
    const url = await getStorageAssetUrl(asset.source.storagePath, { scopeKey: `soura-project-asset:${asset.source.projectId}`, type: 'soura-project-audio', warnOnFail: true })
    if (!url) throw new Error('Project audio could not be resolved.')
    return { asset, url, storagePath: asset.source.storagePath, fileName: asset.name, contentType: asset.source.contentType || 'audio/*' }
  }
}
