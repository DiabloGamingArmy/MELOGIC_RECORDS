const KINDS = new Set(['folder', 'audio', 'collection'])
const SOURCE_TYPES = new Set(['primitive', 'marketplace', 'user', 'project'])

export function stableAssetId(namespace = 'asset', value = '') {
  let hash = 2166136261
  const input = `${namespace}|${String(value || '')}`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${namespace}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function normalizeAsset(input = {}) {
  const kind = KINDS.has(input.kind) ? input.kind : 'audio'
  const sourceType = SOURCE_TYPES.has(input.sourceType) ? input.sourceType : 'user'
  const source = input.source && typeof input.source === 'object' ? { ...input.source } : {}
  const audio = kind === 'audio' && input.audio && typeof input.audio === 'object' ? {
    duration: Number.isFinite(Number(input.audio.duration)) ? Math.max(0, Number(input.audio.duration)) : undefined,
    channels: Number.isFinite(Number(input.audio.channels)) ? Math.max(1, Number(input.audio.channels)) : undefined,
    sampleRate: Number.isFinite(Number(input.audio.sampleRate)) ? Math.max(1, Number(input.audio.sampleRate)) : undefined,
    bpm: Number.isFinite(Number(input.audio.bpm)) ? Number(input.audio.bpm) : undefined,
    key: input.audio.key ? String(input.audio.key) : undefined,
    format: input.audio.format ? String(input.audio.format).toLowerCase() : undefined,
    byteSize: Number.isFinite(Number(input.audio.byteSize)) ? Math.max(0, Number(input.audio.byteSize)) : undefined
  } : undefined
  const defaultCapabilities = kind === 'audio'
    ? { preview: true, dragToTimeline: true, insertAtPlayhead: true, download: false, delete: sourceType === 'user' }
    : { preview: false, dragToTimeline: false, insertAtPlayhead: false, download: false, delete: false }
  return Object.freeze({
    id: String(input.id || stableAssetId(sourceType, input.archivePath || input.name || 'asset')),
    name: String(input.name || 'Untitled').slice(0, 240),
    kind,
    sourceType,
    parentId: input.parentId == null ? null : String(input.parentId),
    audio,
    source: Object.freeze(source),
    capabilities: Object.freeze({ ...defaultCapabilities, ...(input.capabilities || {}) }),
    metadata: Object.freeze(input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}),
    readOnly: input.readOnly === true || sourceType === 'marketplace' || sourceType === 'project'
  })
}

export function normalizeAssetList(rows = []) {
  const seen = new Set()
  return (Array.isArray(rows) ? rows : []).map(normalizeAsset).filter((asset) => {
    if (seen.has(asset.id)) return false
    seen.add(asset.id)
    return true
  })
}

export function buildArchiveHierarchy({ sourceType = 'marketplace', rootId, rootName, productId = '', projectId = '', publisherId = '', sourceFileId = '', version = '', entries = [] } = {}) {
  const collectionId = rootId || stableAssetId(`${sourceType}-collection`, `${productId || projectId}|${rootName}`)
  const packId = rootId || collectionId
  const output = [normalizeAsset({ id: collectionId, name: rootName || 'Collection', kind: 'collection', sourceType, parentId: sourceType, readOnly: true, source: { productId, packId, projectId, publisherId, version } })]
  const folders = new Map()
  for (const entry of entries) {
    const archivePath = String(entry.archivePath || entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!archivePath) continue
    const segments = archivePath.split('/').filter(Boolean)
    const fileName = segments.pop()
    let parentId = collectionId
    let logicalPath = ''
    for (const segment of segments) {
      logicalPath = logicalPath ? `${logicalPath}/${segment}` : segment
      const folderId = stableAssetId(`${sourceType}-folder`, `${collectionId}|${logicalPath}`)
      if (!folders.has(folderId)) {
        const folder = normalizeAsset({ id: folderId, name: segment, kind: 'folder', sourceType, parentId, readOnly: true, source: { productId, packId, projectId, publisherId, archivePath: logicalPath, version } })
        folders.set(folderId, folder)
        output.push(folder)
      }
      parentId = folderId
    }
    output.push(normalizeAsset({
      id: entry.assetId || stableAssetId(`${sourceType}-audio`, `${collectionId}|${archivePath}`),
      name: entry.name || fileName,
      kind: 'audio',
      sourceType,
      parentId,
      readOnly: true,
      audio: { duration: entry.duration, channels: entry.channels, sampleRate: entry.sampleRate, format: entry.format || fileName?.split('.').pop(), byteSize: entry.byteSize || entry.fileSize },
      source: { productId, packId, projectId, publisherId, sourceFileId: entry.sourceFileId || sourceFileId, archivePath, storagePath: entry.storagePath, localPath: entry.localPath, contentHash: entry.contentHash, version },
      metadata: { tags: entry.tags || [], productTitle: rootName || '' },
      capabilities: { preview: true, dragToTimeline: true, insertAtPlayhead: true, download: Boolean(entry.storagePath), delete: false }
    }))
  }
  return output
}
