const clone = (value) => globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()
const text = (value) => String(value ?? '').trim()

export const VertixDirectoryKind = Object.freeze({
  ROOT: 'root',
  BUILT_IN: 'built-in',
  PROJECT: 'project',
  MARKETPLACE: 'marketplace',
  USER: 'user'
})

export const VertixAssetSourceType = Object.freeze({
  BUILT_IN: 'built-in',
  IMPORTED: 'imported',
  MARKETPLACE: 'marketplace',
  PROJECT: 'project',
  SHARED: 'shared'
})

export function stableVertixId(prefix = 'entry') {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${uuid}`
}

export function createVertixDirectory(input = {}) {
  const folderId = text(input.folderId || input.id) || stableVertixId('folder')
  const name = text(input.name)
  if (!name || name.includes('/') || name === '.' || name === '..') throw new TypeError('Vertix directory names must be one safe path segment.')
  return Object.freeze({
    folderId,
    ownerId: text(input.ownerId),
    parentFolderId: text(input.parentFolderId),
    name,
    kind: Object.values(VertixDirectoryKind).includes(input.kind) ? input.kind : VertixDirectoryKind.USER,
    projectId: text(input.projectId),
    sourceId: text(input.sourceId),
    readOnly: input.readOnly === true,
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now()
  })
}

export function createVertixAssetRecord(input = {}) {
  const assetId = text(input.assetId || input.id) || stableVertixId('asset')
  const currentVersionId = text(input.currentVersionId || input.versionId)
  if (!text(input.displayName || input.name)) throw new TypeError('A Vertix asset needs a display name.')
  if (!currentVersionId) throw new TypeError('A Vertix asset needs an immutable currentVersionId.')
  return Object.freeze({
    assetId,
    ownerId: text(input.ownerId),
    displayName: text(input.displayName || input.name),
    fileName: text(input.fileName),
    format: text(input.format).toLowerCase(),
    mimeType: text(input.mimeType),
    sourceType: Object.values(VertixAssetSourceType).includes(input.sourceType) ? input.sourceType : VertixAssetSourceType.IMPORTED,
    sourceId: text(input.sourceId),
    sourceProductId: text(input.sourceProductId),
    sourcePackId: text(input.sourcePackId),
    sourcePackVersion: text(input.sourcePackVersion),
    publisherId: text(input.publisherId),
    currentVersionId,
    contentHash: text(input.contentHash),
    metadata: clone(input.metadata || {}),
    technicalMetadata: clone(input.technicalMetadata || {}),
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now()
  })
}

export function createVertixAssetVersion(input = {}) {
  const assetId = text(input.assetId)
  const versionId = text(input.versionId) || stableVertixId('version')
  if (!assetId || !text(input.contentHash)) throw new TypeError('A Vertix asset version needs assetId and contentHash.')
  return Object.freeze({
    versionId,
    assetId,
    storageObjectId: text(input.storageObjectId || input.storagePath),
    contentHash: text(input.contentHash),
    fileSize: Math.max(0, Number(input.fileSize || 0)),
    mimeType: text(input.mimeType),
    technicalMetadata: clone(input.technicalMetadata || {}),
    createdAt: input.createdAt || now()
  })
}

export function createVertixFolderEntry(input = {}) {
  if (!text(input.folderId) || !text(input.assetId)) throw new TypeError('A folder entry needs folderId and assetId.')
  return Object.freeze({ entryId: text(input.entryId) || stableVertixId('entry'), folderId: text(input.folderId), assetId: text(input.assetId), createdAt: input.createdAt || now() })
}

export function createDefaultVertixFilesystem({ ownerId = '', projects = [], activeProjectId = '' } = {}) {
  const folders = [
    createVertixDirectory({ folderId: 'vertix-root', ownerId, name: 'VERTIX', kind: VertixDirectoryKind.ROOT, readOnly: true }),
    createVertixDirectory({ folderId: 'vertix-built-in', ownerId, parentFolderId: 'vertix-root', name: 'Built-in', kind: VertixDirectoryKind.BUILT_IN, readOnly: true }),
    createVertixDirectory({ folderId: 'vertix-built-in-primitives', ownerId, parentFolderId: 'vertix-built-in', name: 'Primitives', kind: VertixDirectoryKind.BUILT_IN, readOnly: true }),
    createVertixDirectory({ folderId: 'vertix-marketplace', ownerId, parentFolderId: 'vertix-root', name: 'Marketplace', kind: VertixDirectoryKind.MARKETPLACE, readOnly: true })
  ]
  projects.forEach((project) => folders.push(createVertixDirectory({
    folderId: `vertix-project:${text(project.id)}`,
    ownerId,
    parentFolderId: 'vertix-root',
    projectId: text(project.id),
    name: text(project.name) || 'Untitled Project',
    kind: VertixDirectoryKind.PROJECT,
    readOnly: text(project.id) !== text(activeProjectId)
  })))
  return Object.freeze({ rootFolderId: 'vertix-root', activeProjectFolderId: activeProjectId ? `vertix-project:${text(activeProjectId)}` : '', folders: Object.freeze(folders) })
}

/**
 * Record-oriented virtual filesystem. Paths are derived presentation; asset
 * identity and versions never change when entries move or folders rename.
 */
export function createVertixFilesystem({ folders = [], assets = [], versions = [], entries = [], activeProjectId = '' } = {}) {
  const folderMap = new Map(folders.map((folder) => [folder.folderId, clone(folder)]))
  const assetMap = new Map(assets.map((asset) => [asset.assetId, clone(asset)]))
  const versionMap = new Map(versions.map((version) => [version.versionId, clone(version)]))
  const entryMap = new Map(entries.map((entry) => [entry.entryId, clone(entry)]))
  const history = []
  let historyIndex = -1

  const folder = (folderId) => folderMap.get(text(folderId)) || null
  const assertOwnedWritable = (folderId) => {
    const target = folder(folderId)
    if (!target) throw new Error('FOLDER_NOT_FOUND')
    if (target.readOnly || (target.kind === VertixDirectoryKind.PROJECT && target.projectId !== activeProjectId)) throw new Error('FOLDER_READ_ONLY')
    return target
  }
  const descendants = (folderId) => {
    const found = new Set()
    const visit = (parentId) => folderMap.forEach((candidate) => {
      if (candidate.parentFolderId === parentId && !found.has(candidate.folderId)) { found.add(candidate.folderId); visit(candidate.folderId) }
    })
    visit(folderId)
    return found
  }
  const breadcrumb = (folderId) => {
    const rows = []
    const seen = new Set()
    let current = folder(folderId)
    while (current && !seen.has(current.folderId)) { rows.unshift(clone(current)); seen.add(current.folderId); current = folder(current.parentFolderId) }
    return rows
  }
  const navigate = (folderId, { replace = false } = {}) => {
    if (!folder(folderId)) throw new Error('FOLDER_NOT_FOUND')
    if (replace && historyIndex >= 0) history[historyIndex] = folderId
    else { history.splice(historyIndex + 1); history.push(folderId); historyIndex = history.length - 1 }
    return clone(folder(folderId))
  }
  const createFolder = (parentFolderId, name, options = {}) => {
    const parent = assertOwnedWritable(parentFolderId)
    if ([...folderMap.values()].some((candidate) => candidate.parentFolderId === parent.folderId && candidate.name.toLocaleLowerCase() === text(name).toLocaleLowerCase())) throw new Error('FOLDER_NAME_CONFLICT')
    const next = createVertixDirectory({ ...options, ownerId: options.ownerId || parent.ownerId, parentFolderId: parent.folderId, name })
    folderMap.set(next.folderId, clone(next))
    return clone(next)
  }
  const renameFolder = (folderId, name) => {
    const target = assertOwnedWritable(folderId)
    const safe = createVertixDirectory({ ...target, name, updatedAt: now() })
    folderMap.set(folderId, clone(safe))
    return clone(safe)
  }
  const moveFolder = (folderId, parentFolderId) => {
    const target = assertOwnedWritable(folderId)
    assertOwnedWritable(parentFolderId)
    if (folderId === parentFolderId || descendants(folderId).has(parentFolderId)) throw new Error('FOLDER_RECURSIVE_MOVE')
    const moved = { ...target, parentFolderId, updatedAt: now() }
    folderMap.set(folderId, moved)
    return clone(moved)
  }
  const moveAsset = (entryId, folderId) => {
    const entry = entryMap.get(entryId)
    if (!entry) throw new Error('ENTRY_NOT_FOUND')
    assertOwnedWritable(entry.folderId)
    assertOwnedWritable(folderId)
    entry.folderId = folderId
    return clone(entry)
  }
  const copyAssetToCurrentProject = (assetId, destinationFolderId) => {
    if (!assetMap.has(assetId)) throw new Error('ASSET_NOT_FOUND')
    const target = assertOwnedWritable(destinationFolderId)
    if (target.projectId !== activeProjectId && !breadcrumb(target.folderId).some((item) => item.projectId === activeProjectId)) throw new Error('DESTINATION_NOT_ACTIVE_PROJECT')
    const next = createVertixFolderEntry({ folderId: target.folderId, assetId })
    entryMap.set(next.entryId, clone(next))
    return clone(next)
  }
  const deleteFolder = (folderId, { recursive = false } = {}) => {
    assertOwnedWritable(folderId)
    const nested = descendants(folderId)
    const affected = new Set([folderId, ...nested])
    const hasContents = [...entryMap.values()].some((entry) => affected.has(entry.folderId)) || nested.size > 0
    if (hasContents && !recursive) throw new Error('FOLDER_NOT_EMPTY')
    ;[...entryMap.entries()].forEach(([id, entry]) => { if (affected.has(entry.folderId)) entryMap.delete(id) })
    affected.forEach((id) => folderMap.delete(id))
    // Asset records/versions remain: another project or folder entry can still
    // reference the same immutable source binary.
    return true
  }

  return Object.freeze({
    navigate,
    back: () => historyIndex > 0 ? clone(folder(history[--historyIndex])) : null,
    forward: () => historyIndex < history.length - 1 ? clone(folder(history[++historyIndex])) : null,
    parent: (folderId) => clone(folder(folder(folderId)?.parentFolderId)),
    breadcrumb,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    moveAsset,
    copyAssetToCurrentProject,
    listFolders: (parentFolderId) => [...folderMap.values()].filter((item) => item.parentFolderId === parentFolderId).map(clone),
    listAssets: (folderId) => [...entryMap.values()].filter((entry) => entry.folderId === folderId).map((entry) => ({ entry: clone(entry), asset: clone(assetMap.get(entry.assetId)), version: clone(versionMap.get(assetMap.get(entry.assetId)?.currentVersionId)) })),
    snapshot: () => ({ folders: [...folderMap.values()].map(clone), assets: [...assetMap.values()].map(clone), versions: [...versionMap.values()].map(clone), entries: [...entryMap.values()].map(clone) })
  })
}
