import { createVertixAssetRecord, createVertixAssetVersion, stableVertixId, VertixAssetSourceType } from './assetFilesystem.js'

export const GLB_MAGIC = 0x46546c67
export const GLB_JSON_CHUNK = 0x4e4f534a
export const GLB_BINARY_CHUNK = 0x004e4942
export const GLB_MIME_TYPE = 'model/gltf-binary'
export const DEFAULT_GLB_LIMITS = Object.freeze({ maxBytes: 512 * 1024 * 1024, maxVertices: 20_000_000, maxTriangles: 20_000_000 })

const asBytes = (input) => input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null
const issue = (code, message) => Object.freeze({ code, message })

function parseChunks(bytes, declaredLength) {
  const chunks = []
  let offset = 12
  while (offset < declaredLength) {
    if (offset + 8 > declaredLength) throw new Error('GLB_CHUNK_HEADER_TRUNCATED')
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
    const length = view.getUint32(0, true)
    const type = view.getUint32(4, true)
    const start = offset + 8
    const end = start + length
    if (end > declaredLength || length % 4 !== 0) throw new Error('GLB_CHUNK_INVALID')
    chunks.push({ type, bytes: bytes.subarray(start, end) })
    offset = end
  }
  return chunks
}

function accessorCount(gltf, index) {
  return Math.max(0, Number(gltf?.accessors?.[index]?.count || 0))
}

function primitiveTriangles(gltf, primitive = {}) {
  const count = primitive.indices !== undefined ? accessorCount(gltf, primitive.indices) : accessorCount(gltf, primitive.attributes?.POSITION)
  const mode = Number(primitive.mode ?? 4)
  if (mode === 4) return Math.floor(count / 3)
  if (mode === 5 || mode === 6) return Math.max(0, count - 2)
  return 0
}

function technicalMetadata(gltf = {}) {
  const primitives = (gltf.meshes || []).flatMap((mesh) => Array.isArray(mesh.primitives) ? mesh.primitives : [])
  const positionAccessors = new Set(primitives.map((primitive) => primitive.attributes?.POSITION).filter((value) => value !== undefined))
  const vertices = [...positionAccessors].reduce((sum, index) => sum + accessorCount(gltf, index), 0)
  const triangles = primitives.reduce((sum, primitive) => sum + primitiveTriangles(gltf, primitive), 0)
  const durations = (gltf.animations || []).map((animation) => Math.max(0, ...(animation.samplers || []).map((sampler) => Number(gltf.accessors?.[sampler.input]?.max?.[0] || 0))))
  const positionBounds = [...positionAccessors].map((index) => gltf.accessors?.[index]).filter((accessor) => Array.isArray(accessor?.min) && Array.isArray(accessor?.max))
  const bounds = positionBounds.length ? {
    min: [0, 1, 2].map((axis) => Math.min(...positionBounds.map((accessor) => Number(accessor.min[axis] || 0)))),
    max: [0, 1, 2].map((axis) => Math.max(...positionBounds.map((accessor) => Number(accessor.max[axis] || 0))))
  } : null
  return Object.freeze({
    gltfVersion: String(gltf.asset?.version || ''),
    generator: String(gltf.asset?.generator || ''),
    vertices,
    triangles,
    meshCount: (gltf.meshes || []).length,
    primitiveCount: primitives.length,
    materialCount: (gltf.materials || []).length,
    textureCount: (gltf.textures || []).length,
    animationCount: (gltf.animations || []).length,
    animationDuration: durations.length ? Math.max(...durations) : 0,
    nodeCount: (gltf.nodes || []).length,
    jointCount: (gltf.skins || []).reduce((sum, skin) => sum + (skin.joints || []).length, 0),
    hasMorphTargets: primitives.some((primitive) => Array.isArray(primitive.targets) && primitive.targets.length > 0),
    usedExtensions: [...new Set([...(gltf.extensionsUsed || []), ...(gltf.extensionsRequired || [])])],
    bounds,
    units: 'm'
  })
}

export function validateGlb(input, limits = DEFAULT_GLB_LIMITS) {
  const errors = []
  const warnings = []
  const bytes = asBytes(input)
  if (!bytes) return Object.freeze({ valid: false, errors: [issue('glb.input-invalid', 'GLB input must be binary data.')], warnings, gltf: null, technicalMetadata: null })
  if (bytes.byteLength < 20) errors.push(issue('glb.too-small', 'The file is too small to be a GLB.'))
  if (bytes.byteLength > Number(limits.maxBytes || DEFAULT_GLB_LIMITS.maxBytes)) errors.push(issue('glb.too-large', 'The GLB exceeds the supported import size.'))
  if (errors.length) return Object.freeze({ valid: false, errors, warnings, gltf: null, technicalMetadata: null })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  const declaredLength = view.getUint32(8, true)
  if (magic !== GLB_MAGIC) errors.push(issue('glb.magic-invalid', 'The file does not contain a GLB header.'))
  if (version !== 2) errors.push(issue('glb.version-unsupported', 'Only glTF/GLB version 2 is supported.'))
  if (declaredLength !== bytes.byteLength) errors.push(issue('glb.length-invalid', 'The GLB declared length does not match its binary length.'))
  if (errors.length) return Object.freeze({ valid: false, errors, warnings, gltf: null, technicalMetadata: null })
  let chunks
  try { chunks = parseChunks(bytes, declaredLength) } catch (error) { errors.push(issue('glb.chunks-invalid', error.message)); return Object.freeze({ valid: false, errors, warnings, gltf: null, technicalMetadata: null }) }
  if (!chunks.length || chunks[0].type !== GLB_JSON_CHUNK) errors.push(issue('glb.json-chunk-missing', 'The first GLB chunk must be JSON.'))
  if (chunks.some((chunk, index) => index > 0 && ![GLB_BINARY_CHUNK].includes(chunk.type))) warnings.push(issue('glb.chunk-unknown', 'The GLB contains an unknown non-executable chunk.'))
  let gltf = null
  if (!errors.length) {
    try {
      const jsonText = new TextDecoder().decode(chunks[0].bytes).replace(/[\u0000\u0020]+$/g, '')
      gltf = JSON.parse(jsonText)
    } catch { errors.push(issue('glb.json-invalid', 'The GLB JSON chunk could not be parsed.')) }
  }
  if (gltf && gltf.asset?.version !== '2.0') errors.push(issue('glb.gltf-version-unsupported', 'The glTF asset must declare version 2.0.'))
  if (gltf && (gltf.buffers || []).some((buffer) => typeof buffer.uri === 'string' && buffer.uri.trim())) errors.push(issue('glb.external-resource', 'Library GLBs must be self-contained and cannot reference external buffers.'))
  if (gltf && (gltf.images || []).some((image) => typeof image.uri === 'string' && !image.uri.startsWith('data:'))) errors.push(issue('glb.external-resource', 'Library GLBs must be self-contained and cannot reference external images.'))
  const metadata = gltf ? technicalMetadata(gltf) : null
  if (metadata?.vertices > Number(limits.maxVertices || DEFAULT_GLB_LIMITS.maxVertices)) errors.push(issue('glb.vertices-limit', 'The GLB exceeds the supported vertex limit.'))
  if (metadata?.triangles > Number(limits.maxTriangles || DEFAULT_GLB_LIMITS.maxTriangles)) errors.push(issue('glb.triangles-limit', 'The GLB exceeds the supported triangle limit.'))
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings), gltf, technicalMetadata: metadata })
}

export async function sha256Hex(input) {
  const bytes = asBytes(input)
  if (!bytes || !globalThis.crypto?.subtle) throw new Error('SHA256_UNAVAILABLE')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Creates metadata records after the caller uploads bytes to account storage. */
export async function prepareGlbAssetImport(file, { ownerId = '', storageObjectId = '', folderId = '', sourceType = VertixAssetSourceType.IMPORTED } = {}) {
  if (!file?.arrayBuffer) throw new TypeError('A File-like GLB is required.')
  const bytes = await file.arrayBuffer()
  const validation = validateGlb(bytes)
  if (!validation.valid) return Object.freeze({ ok: false, validation })
  const contentHash = await sha256Hex(bytes)
  const assetId = stableVertixId('asset')
  const versionId = `${assetId}:sha256:${contentHash}`
  const version = createVertixAssetVersion({ assetId, versionId, storageObjectId, contentHash, fileSize: file.size || bytes.byteLength, mimeType: GLB_MIME_TYPE, technicalMetadata: validation.technicalMetadata })
  const asset = createVertixAssetRecord({ assetId, ownerId, displayName: String(file.name || 'Imported GLB').replace(/\.glb$/i, ''), fileName: file.name, format: 'glb', mimeType: GLB_MIME_TYPE, sourceType, sourceId: storageObjectId, currentVersionId: versionId, contentHash, technicalMetadata: validation.technicalMetadata, metadata: { folderId, importedAt: new Date().toISOString(), units: 'm' } })
  return Object.freeze({ ok: true, asset, version, bytes, validation })
}
