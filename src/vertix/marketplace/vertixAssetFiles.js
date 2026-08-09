import { validateGlb } from '../assets/glbAsset.js'

export const VertixArchiveValidationStatus = Object.freeze({
  UNCHECKED: 'unchecked',
  CHECKING: 'checking',
  COMPATIBLE: 'compatible',
  INCOMPATIBLE: 'incompatible',
  ERROR: 'error'
})

export const VERTIX_ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxUncompressedBytes: 1024 * 1024 * 1024,
  maxEntries: 5000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 250
})

export function isZipDeliverable(file = {}) {
  const name = String(file.name || file.displayPath || '').split('?')[0].toLowerCase()
  const mime = String(file.contentType || file.type || '').toLowerCase()
  return name.endsWith('.zip') || ['application/zip', 'application/x-zip-compressed'].includes(mime)
}

export function isSafeArchivePath(value = '') {
  const path = String(value || '').replace(/\\/g, '/')
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) || /[\u0000-\u001f\u007f]/.test(path)) return false
  try {
    const decoded = decodeURIComponent(path)
    return decoded.split('/').every((part) => part && part !== '.' && part !== '..')
  } catch { return false }
}

export function normalizeVertixArchiveCapability(input = {}) {
  const status = Object.values(VertixArchiveValidationStatus).includes(input.status) ? input.status : VertixArchiveValidationStatus.UNCHECKED
  return Object.freeze({
    status,
    compatible: status === VertixArchiveValidationStatus.COMPATIBLE && input.compatible !== false,
    compatibleAssetCount: Math.max(0, Number(input.compatibleAssetCount || 0)),
    invalidAssetCount: Math.max(0, Number(input.invalidAssetCount || 0)),
    archiveEntryCount: Math.max(0, Number(input.archiveEntryCount || 0)),
    archiveUncompressedBytes: Math.max(0, Number(input.archiveUncompressedBytes || 0)),
    assetPaths: Object.freeze((Array.isArray(input.assetPaths) ? input.assetPaths : []).map(String)),
    errors: Object.freeze((Array.isArray(input.errors) ? input.errors : []).map(String)),
    validatedAt: String(input.validatedAt || '')
  })
}

export function isEligibleVertixAssetFile(file = {}) {
  const capability = normalizeVertixArchiveCapability(file.vertixAssetValidation || file.vertixCapability)
  return isZipDeliverable(file) && file.isVertixAsset === true && capability.compatible && capability.compatibleAssetCount > 0
}

export function deriveProductVertixCapability(files = []) {
  const rows = Array.isArray(files) ? files : []
  const compatibleFiles = rows.filter((file) => isZipDeliverable(file) && normalizeVertixArchiveCapability(file.vertixAssetValidation || file.vertixCapability).compatible)
  const eligibleFiles = rows.filter(isEligibleVertixAssetFile)
  return Object.freeze({
    containsVertixAssets: compatibleFiles.length > 0,
    hasVertixAssets: eligibleFiles.length > 0,
    compatibleFileCount: compatibleFiles.length,
    eligibleFileCount: eligibleFiles.length,
    compatibleAssetCount: compatibleFiles.reduce((sum, file) => sum + normalizeVertixArchiveCapability(file.vertixAssetValidation || file.vertixCapability).compatibleAssetCount, 0),
    eligibleAssetCount: eligibleFiles.reduce((sum, file) => sum + normalizeVertixArchiveCapability(file.vertixAssetValidation || file.vertixCapability).compatibleAssetCount, 0),
    eligibleFiles: Object.freeze(eligibleFiles)
  })
}

function zipEntryRatio(entry) {
  const compressed = Math.max(1, Number(entry?._data?.compressedSize ?? entry?.compressedSize ?? 0))
  const uncompressed = Math.max(0, Number(entry?._data?.uncompressedSize ?? entry?.uncompressedSize ?? 0))
  return uncompressed / compressed
}

/** Browser-side preflight. The backend repeats this validation before trust. */
export async function inspectVertixAssetArchive(file, limits = VERTIX_ARCHIVE_LIMITS) {
  const errors = []
  if (!file || !isZipDeliverable(file)) return normalizeVertixArchiveCapability({ status: VertixArchiveValidationStatus.INCOMPATIBLE, errors: ['Only ZIP deliverables can be Vertix Asset packs.'] })
  if (Number(file.size || 0) > limits.maxArchiveBytes) return normalizeVertixArchiveCapability({ status: VertixArchiveValidationStatus.INCOMPATIBLE, errors: ['ZIP exceeds the supported archive size.'] })
  try {
    const { default: JSZip } = await import('jszip')
    const archive = await JSZip.loadAsync(file, { checkCRC32: true, createFolders: false })
    const entries = Object.values(archive.files).filter((entry) => !entry.dir)
    if (entries.length > limits.maxEntries) errors.push('ZIP contains too many entries.')
    let totalBytes = 0
    for (const entry of entries) {
      if (!isSafeArchivePath(entry.name)) errors.push(`Unsafe archive path: ${entry.name}`)
      const size = Number(entry?._data?.uncompressedSize || 0)
      totalBytes += size
      if (size > limits.maxEntryBytes) errors.push(`Archive entry is too large: ${entry.name}`)
      if (zipEntryRatio(entry) > limits.maxCompressionRatio) errors.push(`Unsafe compression ratio: ${entry.name}`)
    }
    if (totalBytes > limits.maxUncompressedBytes) errors.push('ZIP expands beyond the supported uncompressed size.')
    if (errors.length) return normalizeVertixArchiveCapability({ status: VertixArchiveValidationStatus.INCOMPATIBLE, archiveEntryCount: entries.length, archiveUncompressedBytes: totalBytes, errors, validatedAt: new Date().toISOString() })
    const glbEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith('.glb'))
    const validPaths = []
    let invalidAssetCount = 0
    for (const entry of glbEntries) {
      const validation = validateGlb(await entry.async('uint8array'))
      if (validation.valid) validPaths.push(entry.name)
      else invalidAssetCount += 1
    }
    if (!validPaths.length) errors.push('ZIP does not contain a valid, self-contained GLB asset.')
    return normalizeVertixArchiveCapability({
      status: validPaths.length ? VertixArchiveValidationStatus.COMPATIBLE : VertixArchiveValidationStatus.INCOMPATIBLE,
      compatible: validPaths.length > 0,
      compatibleAssetCount: validPaths.length,
      invalidAssetCount,
      archiveEntryCount: entries.length,
      archiveUncompressedBytes: totalBytes,
      assetPaths: validPaths,
      errors,
      validatedAt: new Date().toISOString()
    })
  } catch (error) {
    return normalizeVertixArchiveCapability({ status: VertixArchiveValidationStatus.ERROR, errors: [error?.message || 'ZIP could not be inspected.'], validatedAt: new Date().toISOString() })
  }
}

export function withVertixAssetFlag(file, requested, validation) {
  const capability = normalizeVertixArchiveCapability(validation || file?.vertixAssetValidation)
  const isVertixAsset = requested === true && isZipDeliverable(file) && capability.compatible
  return Object.freeze({ ...file, isVertixAsset, vertixAssetValidation: capability })
}
