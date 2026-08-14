'use strict'

const crypto = require('node:crypto')
const { LIMITS, STATUS, isZipFile, safePath, centralDirectoryEntries, extractEntry } = require('./vertixAssetArchives')

const AUDIO_FORMATS = new Set(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'webm', 'flac'])
const MIME_BY_FORMAT = Object.freeze({ wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' })
const extension = (name = '') => String(name).split('.').pop().toLowerCase()

function validateAudioContainer(bytes, format) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return false
  if (format === 'wav') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE'
  if (format === 'flac') return bytes.subarray(0, 4).toString() === 'fLaC'
  if (format === 'ogg' || format === 'oga') return bytes.subarray(0, 4).toString() === 'OggS'
  if (format === 'mp3') return bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if (format === 'm4a' || format === 'aac') return (bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0) || bytes.subarray(4, 8).toString() === 'ftyp'
  if (format === 'webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  return false
}

function inspectSouraArchive(buffer, limits = { ...LIMITS, maxEntries: 7500, maxUncompressedBytes: 2 * 1024 * 1024 * 1024 }) {
  if (!Buffer.isBuffer(buffer) || buffer.length > limits.maxArchiveBytes) return { status: STATUS.INCOMPATIBLE, compatible: false, compatibleAssetCount: 0, errors: ['ZIP exceeds the supported archive size.'] }
  try {
    const { entries, totalUncompressed } = centralDirectoryEntries(buffer, limits)
    const recognized = entries.filter((entry) => !entry.isDirectory && AUDIO_FORMATS.has(extension(entry.name)))
    const assets = []
    let invalidAssetCount = 0
    for (const entry of recognized) {
      const format = extension(entry.name)
      const bytes = extractEntry(buffer, entry)
      if (validateAudioContainer(bytes, format)) assets.push({ archivePath: entry.name, format, byteSize: bytes.length, contentHash: crypto.createHash('sha256').update(bytes).digest('hex'), mimeType: MIME_BY_FORMAT[format] })
      else invalidAssetCount += 1
    }
    const compatible = assets.length > 0
    return { status: compatible ? STATUS.COMPATIBLE : STATUS.INCOMPATIBLE, compatible, compatibleAssetCount: assets.length, invalidAssetCount, archiveEntryCount: entries.length, archiveUncompressedBytes: totalUncompressed, assetPaths: assets.map((asset) => asset.archivePath), assets, errors: compatible ? [] : ['ZIP does not contain a recognized audio file with a valid container signature.'], validatedAt: new Date().toISOString() }
  } catch (error) { return { status: STATUS.INCOMPATIBLE, compatible: false, compatibleAssetCount: 0, invalidAssetCount: 0, archiveEntryCount: 0, archiveUncompressedBytes: 0, assetPaths: [], assets: [], errors: [error.message || 'ZIP validation failed.'], validatedAt: new Date().toISOString() } }
}

function eligibleSouraFile(file = {}) {
  return isZipFile(file) && file.isSouraAsset === true && file.souraAssetValidation?.status === STATUS.COMPATIBLE && file.souraAssetValidation?.compatible === true && Number(file.souraAssetValidation?.compatibleAssetCount || 0) > 0
}

function deriveSouraProductFields(files = []) {
  const compatible = files.filter((file) => isZipFile(file) && file.souraAssetValidation?.status === STATUS.COMPATIBLE && file.souraAssetValidation?.compatible === true)
  const eligible = files.filter(eligibleSouraFile)
  return { containsSouraAssets: compatible.length > 0, hasSouraAssets: eligible.length > 0, souraAssetCount: eligible.reduce((sum, file) => sum + Number(file.souraAssetValidation.compatibleAssetCount || 0), 0), souraAssetFileIds: eligible.map((file) => file.id) }
}

function souraEntitlementAllows({ uid = '', artistId = '', entitlementExists = false, entitlementStatus = '', libraryExists = false, libraryStatus = '' } = {}) {
  if (uid && artistId === uid) return true
  return (entitlementExists && (entitlementStatus || 'active') === 'active') || (libraryExists && (libraryStatus || 'active') === 'active')
}

module.exports = { AUDIO_FORMATS, MIME_BY_FORMAT, safePath, isZipFile, validateAudioContainer, inspectSouraArchive, eligibleSouraFile, deriveSouraProductFields, souraEntitlementAllows }
