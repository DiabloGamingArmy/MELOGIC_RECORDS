export function canonicalProductStoragePrefix(productId = '') {
  return `products/${String(productId || '').trim()}/`
}

function stableReferenceId(productId = '', value = '') {
  let hash = 2166136261
  const input = `${productId}|${value}`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `file-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function normalizeProductStoragePath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim()
}

export function isProductScopedStoragePath(productId = '', value = '') {
  const path = normalizeProductStoragePath(value)
  if (!path || /^https?:\/+\/?/i.test(path) || /^gs:\/+\/?/i.test(path) || path.startsWith('users/')) return false
  const unsafeSegment = path.split('/').some((segment) => {
    try { return ['.', '..'].includes(decodeURIComponent(segment).toLowerCase()) } catch { return true }
  })
  return !unsafeSegment && path.startsWith(canonicalProductStoragePrefix(productId))
}

export function normalizeProductDeliverableReferences(productId = '', rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object').map((row, index) => {
    const storagePath = normalizeProductStoragePath(row.storagePath || row.path || row.filePath || '')
    return { ...row, id: String(row.id || stableReferenceId(productId, storagePath || row.name || index)), productId: String(productId || row.productId || ''), storagePath }
  })
}

function sameStorageReference(row = {}, target = {}) {
  const rowId = String(row.id || '')
  const targetId = String(target.id || '')
  const rowPath = normalizeProductStoragePath(row.storagePath || row.path || row.filePath || '')
  const targetPath = normalizeProductStoragePath(target.storagePath || target.path || target.filePath || '')
  return Boolean((rowId && targetId && rowId === targetId) || (rowPath && targetPath && rowPath === targetPath))
}

export function removeProductFileReferences(draft = {}, target = {}) {
  const next = { ...(draft || {}) }
  for (const key of ['deliverableFiles', 'files', 'fileMetadata', 'uploadedFiles', 'folderDeliverables']) {
    if (Array.isArray(next[key])) next[key] = next[key].filter((row) => !sameStorageReference(row, target))
  }
  const targetPath = normalizeProductStoragePath(target.storagePath || target.path || target.filePath || '')
  for (const key of ['downloadPath', 'primaryDownloadPath']) {
    if (targetPath && normalizeProductStoragePath(next[key]) === targetPath) next[key] = ''
  }
  return next
}

export function listManifestStoragePaths(manifest = {}) {
  const rows = []
  const add = (field, value) => { if (String(value || '').trim()) rows.push({ field, path: normalizeProductStoragePath(value) }) }
  for (const field of ['coverPath', 'thumbnailPath', 'downloadPath', 'licensePath', 'primaryPreviewPath', 'primaryDownloadPath']) add(field, manifest[field])
  for (const field of ['galleryPaths', 'previewAudioPaths', 'previewVideoPaths']) (Array.isArray(manifest[field]) ? manifest[field] : []).forEach((value, index) => add(`${field}.${index}`, value))
  for (const field of ['files', 'fileMetadata', 'uploadedFiles', 'deliverableFiles']) (Array.isArray(manifest[field]) ? manifest[field] : []).forEach((row, index) => add(`${field}.${row?.id || index}.storagePath`, row?.storagePath || row?.path || row?.filePath))
  const preview = manifest.previewAssignment && typeof manifest.previewAssignment === 'object' ? manifest.previewAssignment : {}
  for (const field of ['hoverVideoPath', 'hoverAudioPath', 'detailHeroPreviewPath', 'demoReelPath']) add(`previewAssignment.${field}`, preview[field])
  return rows
}

export function findNonProductScopedManifestPaths(productId = '', manifest = {}) {
  return listManifestStoragePaths(manifest).filter((row) => !isProductScopedStoragePath(productId, row.path))
}
