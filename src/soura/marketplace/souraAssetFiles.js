import { isSafeArchivePath, isZipDeliverable } from '../../vertix/marketplace/vertixAssetFiles.js'

export const SouraArchiveValidationStatus = Object.freeze({ UNCHECKED: 'unchecked', CHECKING: 'checking', COMPATIBLE: 'compatible', INCOMPATIBLE: 'incompatible', ERROR: 'error' })
export const SOURA_AUDIO_FORMATS = Object.freeze(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'webm', 'flac'])
export const SOURA_ARCHIVE_LIMITS = Object.freeze({ maxArchiveBytes: 512 * 1024 * 1024, maxUncompressedBytes: 2 * 1024 * 1024 * 1024, maxEntries: 7500, maxEntryBytes: 512 * 1024 * 1024, maxCompressionRatio: 250 })

export function normalizeSouraArchiveCapability(input = {}) {
  const status = Object.values(SouraArchiveValidationStatus).includes(input.status) ? input.status : SouraArchiveValidationStatus.UNCHECKED
  return Object.freeze({
    status,
    compatible: status === SouraArchiveValidationStatus.COMPATIBLE && input.compatible !== false,
    compatibleAssetCount: Math.max(0, Number(input.compatibleAssetCount || 0)),
    invalidAssetCount: Math.max(0, Number(input.invalidAssetCount || 0)),
    archiveEntryCount: Math.max(0, Number(input.archiveEntryCount || 0)),
    archiveUncompressedBytes: Math.max(0, Number(input.archiveUncompressedBytes || 0)),
    assetPaths: Object.freeze((Array.isArray(input.assetPaths) ? input.assetPaths : []).map(String)),
    assets: Object.freeze((Array.isArray(input.assets) ? input.assets : []).map((asset) => Object.freeze({ ...asset }))),
    errors: Object.freeze((Array.isArray(input.errors) ? input.errors : []).map(String)),
    validatedAt: String(input.validatedAt || '')
  })
}

function extension(path = '') { return String(path).split('.').pop().toLowerCase() }
function ratio(entry) { return Number(entry?._data?.uncompressedSize || 0) / Math.max(1, Number(entry?._data?.compressedSize || 0)) }

async function validateAudioBytes(entry) {
  const ext = extension(entry.name)
  const bytes = await entry.async('uint8array')
  if (bytes.length < 4) return false
  if (ext === 'wav') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE'
  if (ext === 'flac') return String.fromCharCode(...bytes.slice(0, 4)) === 'fLaC'
  if (ext === 'ogg' || ext === 'oga') return String.fromCharCode(...bytes.slice(0, 4)) === 'OggS'
  if (ext === 'mp3') return String.fromCharCode(...bytes.slice(0, 3)) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if (ext === 'm4a' || ext === 'aac') return (bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0) || String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  if (ext === 'webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  return false
}

export async function inspectSouraAssetArchive(file, limits = SOURA_ARCHIVE_LIMITS) {
  if (!file || !isZipDeliverable(file)) return normalizeSouraArchiveCapability({ status: 'incompatible', errors: ['Only ZIP deliverables can be Soura Asset packs.'] })
  if (Number(file.size || 0) > limits.maxArchiveBytes) return normalizeSouraArchiveCapability({ status: 'incompatible', errors: ['ZIP exceeds the supported archive size.'] })
  try {
    const { default: JSZip } = await import('jszip')
    const archive = await JSZip.loadAsync(file, { checkCRC32: true, createFolders: false })
    const entries = Object.values(archive.files).filter((entry) => !entry.dir)
    const errors = []
    let totalBytes = 0
    if (entries.length > limits.maxEntries) errors.push('ZIP contains too many entries.')
    for (const entry of entries) {
      if (!isSafeArchivePath(entry.name)) errors.push(`Unsafe archive path: ${entry.name}`)
      const size = Number(entry?._data?.uncompressedSize || 0)
      totalBytes += size
      if (size > limits.maxEntryBytes) errors.push(`Archive entry is too large: ${entry.name}`)
      if (ratio(entry) > limits.maxCompressionRatio) errors.push(`Unsafe compression ratio: ${entry.name}`)
    }
    if (totalBytes > limits.maxUncompressedBytes) errors.push('ZIP expands beyond the supported uncompressed size.')
    if (errors.length) return normalizeSouraArchiveCapability({ status: 'incompatible', archiveEntryCount: entries.length, archiveUncompressedBytes: totalBytes, errors, validatedAt: new Date().toISOString() })
    const recognized = entries.filter((entry) => SOURA_AUDIO_FORMATS.includes(extension(entry.name)))
    const assets = []
    let invalidAssetCount = 0
    for (const entry of recognized) {
      if (await validateAudioBytes(entry)) assets.push({ archivePath: entry.name, format: extension(entry.name), byteSize: Number(entry?._data?.uncompressedSize || 0), runtimeSupport: 'browser-dependent' })
      else invalidAssetCount += 1
    }
    if (!assets.length) errors.push('ZIP does not contain a recognized audio file with a valid container signature.')
    return normalizeSouraArchiveCapability({ status: assets.length ? 'compatible' : 'incompatible', compatible: assets.length > 0, compatibleAssetCount: assets.length, invalidAssetCount, archiveEntryCount: entries.length, archiveUncompressedBytes: totalBytes, assetPaths: assets.map((asset) => asset.archivePath), assets, errors, validatedAt: new Date().toISOString() })
  } catch (error) { return normalizeSouraArchiveCapability({ status: 'error', errors: [error?.message || 'ZIP could not be inspected.'], validatedAt: new Date().toISOString() }) }
}

export function isEligibleSouraAssetFile(file = {}) {
  const validation = normalizeSouraArchiveCapability(file.souraAssetValidation)
  return isZipDeliverable(file) && file.isSouraAsset === true && validation.compatible && validation.compatibleAssetCount > 0
}

export function withSouraAssetFlag(file, requested, validation) {
  const capability = normalizeSouraArchiveCapability(validation || file?.souraAssetValidation)
  return Object.freeze({ ...file, isSouraAsset: requested === true && isZipDeliverable(file) && capability.compatible, souraAssetValidation: capability })
}

export function deriveProductSouraCapability(files = []) {
  const rows = Array.isArray(files) ? files : []
  const compatibleFiles = rows.filter((file) => isZipDeliverable(file) && normalizeSouraArchiveCapability(file.souraAssetValidation).compatible)
  const eligibleFiles = rows.filter(isEligibleSouraAssetFile)
  return Object.freeze({ containsSouraAssets: compatibleFiles.length > 0, hasSouraAssets: eligibleFiles.length > 0, compatibleFileCount: compatibleFiles.length, eligibleFileCount: eligibleFiles.length, compatibleAssetCount: compatibleFiles.reduce((sum, file) => sum + normalizeSouraArchiveCapability(file.souraAssetValidation).compatibleAssetCount, 0), eligibleAssetCount: eligibleFiles.reduce((sum, file) => sum + normalizeSouraArchiveCapability(file.souraAssetValidation).compatibleAssetCount, 0), eligibleFiles: Object.freeze(eligibleFiles) })
}
