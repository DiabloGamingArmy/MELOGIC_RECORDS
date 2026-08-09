'use strict'

const zlib = require('node:zlib')

const LIMITS = Object.freeze({ maxArchiveBytes: 512 * 1024 * 1024, maxUncompressedBytes: 1024 * 1024 * 1024, maxEntries: 5000, maxEntryBytes: 512 * 1024 * 1024, maxCompressionRatio: 250 })
const STATUS = Object.freeze({ UNCHECKED: 'unchecked', COMPATIBLE: 'compatible', INCOMPATIBLE: 'incompatible', ERROR: 'error' })
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  return crc >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function isZipFile(file = {}) {
  const name = String(file.name || file.displayPath || '').toLowerCase()
  const mime = String(file.contentType || file.type || '').toLowerCase()
  return name.endsWith('.zip') || mime === 'application/zip' || mime === 'application/x-zip-compressed'
}

function safePath(value = '') {
  const path = String(value || '').replace(/\\/g, '/')
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) || /[\u0000-\u001f\u007f]/.test(path)) return false
  let decoded = ''
  try { decoded = decodeURIComponent(path) } catch { return false }
  return decoded.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

function centralDirectoryEntries(buffer, limits = LIMITS) {
  const endOffset = findEndOfCentralDirectory(buffer)
  if (endOffset < 0) throw new Error('ZIP central directory is missing.')
  const declaredEntries = buffer.readUInt16LE(endOffset + 10)
  const directorySize = buffer.readUInt32LE(endOffset + 12)
  const directoryOffset = buffer.readUInt32LE(endOffset + 16)
  if (declaredEntries > limits.maxEntries) throw new Error('ZIP contains too many entries.')
  if (directoryOffset + directorySize > buffer.length) throw new Error('ZIP central directory is truncated.')
  const entries = []
  let offset = directoryOffset
  let totalUncompressed = 0
  while (offset < directoryOffset + directorySize && entries.length < declaredEntries) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP central directory entry is invalid.')
    const flags = buffer.readUInt16LE(offset + 8)
    const compression = buffer.readUInt16LE(offset + 10)
    const expectedCrc32 = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/')
    if (!safePath(name.replace(/\/$/, ''))) throw new Error(`Unsafe ZIP path: ${name}`)
    if ((flags & 1) !== 0) throw new Error('Encrypted ZIP entries are not supported.')
    if (![0, 8].includes(compression)) throw new Error(`Unsupported ZIP compression method for ${name}.`)
    if (uncompressedSize > limits.maxEntryBytes) throw new Error(`ZIP entry is too large: ${name}`)
    if (uncompressedSize / Math.max(1, compressedSize) > limits.maxCompressionRatio) throw new Error(`Unsafe ZIP compression ratio: ${name}`)
    totalUncompressed += uncompressedSize
    if (totalUncompressed > limits.maxUncompressedBytes) throw new Error('ZIP expands beyond the supported size.')
    entries.push({ name, compression, compressedSize, uncompressedSize, expectedCrc32, localOffset, isDirectory: name.endsWith('/') })
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (entries.length !== declaredEntries) throw new Error('ZIP entry count does not match its directory.')
  return { entries, totalUncompressed }
}

function extractEntry(buffer, entry) {
  const offset = entry.localOffset
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`ZIP local header is invalid: ${entry.name}`)
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const start = offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new Error(`ZIP entry is truncated: ${entry.name}`)
  const compressed = buffer.subarray(start, end)
  const bytes = entry.compression === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize })
  if (bytes.length !== entry.uncompressedSize) throw new Error(`ZIP entry size mismatch: ${entry.name}`)
  if (crc32(bytes) !== entry.expectedCrc32) throw new Error(`ZIP entry checksum mismatch: ${entry.name}`)
  return bytes
}

function validateGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return false
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) return false
  const jsonLength = buffer.readUInt32LE(12)
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > buffer.length || jsonLength % 4 !== 0) return false
  try {
    const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').replace(/[\u0000\u0020]+$/g, ''))
    if (gltf?.asset?.version !== '2.0') return false
    if ((gltf.buffers || []).some((item) => typeof item.uri === 'string' && item.uri.trim())) return false
    if ((gltf.images || []).some((item) => typeof item.uri === 'string' && !item.uri.startsWith('data:'))) return false
    return true
  } catch { return false }
}

function inspectVertixArchive(buffer, limits = LIMITS) {
  if (!Buffer.isBuffer(buffer) || buffer.length > limits.maxArchiveBytes) return { status: STATUS.INCOMPATIBLE, compatible: false, compatibleAssetCount: 0, errors: ['ZIP exceeds the supported archive size.'] }
  try {
    const { entries, totalUncompressed } = centralDirectoryEntries(buffer, limits)
    const glbs = entries.filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith('.glb'))
    const assetPaths = []
    let invalidAssetCount = 0
    for (const entry of glbs) {
      if (validateGlb(extractEntry(buffer, entry))) assetPaths.push(entry.name)
      else invalidAssetCount += 1
    }
    const compatible = assetPaths.length > 0
    return {
      status: compatible ? STATUS.COMPATIBLE : STATUS.INCOMPATIBLE,
      compatible,
      compatibleAssetCount: assetPaths.length,
      invalidAssetCount,
      archiveEntryCount: entries.length,
      archiveUncompressedBytes: totalUncompressed,
      assetPaths,
      errors: compatible ? [] : ['ZIP does not contain a valid, self-contained GLB asset.'],
      validatedAt: new Date().toISOString()
    }
  } catch (error) {
    return { status: STATUS.INCOMPATIBLE, compatible: false, compatibleAssetCount: 0, invalidAssetCount: 0, archiveEntryCount: 0, archiveUncompressedBytes: 0, assetPaths: [], errors: [error.message || 'ZIP validation failed.'], validatedAt: new Date().toISOString() }
  }
}

function eligibleVertixFile(file = {}) {
  return isZipFile(file) && file.isVertixAsset === true && file.vertixAssetValidation?.status === STATUS.COMPATIBLE && file.vertixAssetValidation?.compatible === true && Number(file.vertixAssetValidation?.compatibleAssetCount || 0) > 0
}

function deriveVertixProductFields(files = []) {
  const compatible = files.filter((file) => isZipFile(file) && file.vertixAssetValidation?.status === STATUS.COMPATIBLE && file.vertixAssetValidation?.compatible === true)
  const eligible = files.filter(eligibleVertixFile)
  return {
    containsVertixAssets: compatible.length > 0,
    hasVertixAssets: eligible.length > 0,
    vertixAssetCount: eligible.reduce((sum, file) => sum + Number(file.vertixAssetValidation.compatibleAssetCount || 0), 0),
    vertixAssetFileIds: eligible.map((file) => file.id)
  }
}

module.exports = { LIMITS, STATUS, isZipFile, safePath, validateGlb, centralDirectoryEntries, extractEntry, inspectVertixArchive, eligibleVertixFile, deriveVertixProductFields }
