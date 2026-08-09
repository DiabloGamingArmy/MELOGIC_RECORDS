import { isValidProjectAssetReference, normalizeProjectAssetReference, projectAssetReferenceKey } from './assetReference.js'

export const AssetResolutionStatus = Object.freeze({
  RESOLVED: 'RESOLVED',
  MISSING: 'MISSING',
  UNAVAILABLE: 'UNAVAILABLE',
  INCOMPATIBLE: 'INCOMPATIBLE',
  INVALID: 'INVALID',
  ERROR: 'ERROR'
})

export const AssetResolutionReason = Object.freeze({
  PACKAGE_NOT_AVAILABLE: 'PACKAGE_NOT_AVAILABLE',
  VERSION_NOT_AVAILABLE: 'VERSION_NOT_AVAILABLE',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  INTEGRITY_MISMATCH: 'INTEGRITY_MISMATCH',
  PACK_UNAVAILABLE: 'PACK_UNAVAILABLE',
  PACK_INCOMPATIBLE: 'PACK_INCOMPATIBLE',
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  LEGACY_OBJECT: 'LEGACY_OBJECT'
})

const assetProvenance = (asset) => asset?.provenance && typeof asset.provenance === 'object' ? asset.provenance : {}
const resolution = (status, reason, reference, asset = null) => Object.freeze({ status, reason, reference, asset })

/**
 * Resolves only an exact package/version/UUID match. Version fallback would
 * silently alter a show file, so it is intentionally absent here.
 */
export function createProjectAssetResolver(registry, { packRegistry } = {}) {
  if (!registry || typeof registry.listAssets !== 'function') throw new TypeError('A Vertix asset registry with listAssets() is required.')

  function resolve(reference) {
    const normalized = normalizeProjectAssetReference(reference)
    if (!isValidProjectAssetReference(normalized)) {
      return resolution(AssetResolutionStatus.INVALID, AssetResolutionReason.INVALID_REFERENCE, normalized)
    }

    const packAvailability = packRegistry?.availabilityFor?.(normalized)
    if (packAvailability?.availability === 'UNAVAILABLE') {
      return resolution(AssetResolutionStatus.UNAVAILABLE, AssetResolutionReason.PACK_UNAVAILABLE, normalized)
    }
    if (packAvailability?.availability === 'INCOMPATIBLE') {
      return resolution(AssetResolutionStatus.INCOMPATIBLE, AssetResolutionReason.PACK_INCOMPATIBLE, normalized)
    }

    const assets = registry.listAssets()
    const samePackage = assets.filter((asset) => assetProvenance(asset).packageId === normalized.packageId)
    if (!samePackage.length) return resolution(AssetResolutionStatus.MISSING, AssetResolutionReason.PACKAGE_NOT_AVAILABLE, normalized)

    const sameVersion = samePackage.filter((asset) => assetProvenance(asset).packageVersion === normalized.packageVersion)
    if (!sameVersion.length) return resolution(AssetResolutionStatus.MISSING, AssetResolutionReason.VERSION_NOT_AVAILABLE, normalized)

    const asset = sameVersion.find((candidate) => assetProvenance(candidate).assetUuid === normalized.assetUuid)
    if (!asset) return resolution(AssetResolutionStatus.MISSING, AssetResolutionReason.ASSET_NOT_FOUND, normalized)

    const integrity = String(assetProvenance(asset).integrity || '').trim()
    if (normalized.integrity && integrity !== normalized.integrity) {
      return resolution(AssetResolutionStatus.MISSING, AssetResolutionReason.INTEGRITY_MISMATCH, normalized)
    }
    return resolution(AssetResolutionStatus.RESOLVED, '', normalized, asset)
  }

  return Object.freeze({ resolve })
}

export function resolveProjectObjectAsset(object, resolver) {
  const objectId = String(object?.id || object?.key || '')
  if (!object?.assetReference) {
    return Object.freeze({ objectId, status: AssetResolutionStatus.RESOLVED, reason: AssetResolutionReason.LEGACY_OBJECT, reference: null, asset: null })
  }
  return Object.freeze({ objectId, ...resolver.resolve(object.assetReference) })
}

export function resolveProjectAssets(project, resolver) {
  const results = {}
  for (const object of Array.isArray(project?.objects) ? project.objects : []) {
    const result = resolveProjectObjectAsset(object, resolver)
    if (result.objectId) results[result.objectId] = result
  }
  return Object.freeze(results)
}

export function reResolveProjectAssets(project, resolver) {
  return resolveProjectAssets(project, resolver)
}

export function summarizeProjectAssetDependencies(project, resolver) {
  const dependencies = new Map()
  for (const object of Array.isArray(project?.objects) ? project.objects : []) {
    if (!object?.assetReference) continue
    const result = resolveProjectObjectAsset(object, resolver)
    const reference = result.reference
    if (!reference) continue
    const key = `${reference.packageId}|${reference.packageVersion}|${reference.integrity}`
    const dependency = dependencies.get(key) || {
      packageId: reference.packageId,
      packageVersion: reference.packageVersion,
      integrity: reference.integrity,
      publisherId: reference.publisherId,
      assetUuids: [],
      objectIds: [],
      status: AssetResolutionStatus.RESOLVED,
      reasons: []
    }
    if (!dependency.assetUuids.includes(reference.assetUuid)) dependency.assetUuids.push(reference.assetUuid)
    dependency.objectIds.push(result.objectId)
    if (result.status !== AssetResolutionStatus.RESOLVED) dependency.status = result.status
    if (result.reason && !dependency.reasons.includes(result.reason)) dependency.reasons.push(result.reason)
    dependencies.set(key, dependency)
  }
  return Object.freeze([...dependencies.values()].map((dependency) => Object.freeze({ ...dependency, assetUuids: Object.freeze([...dependency.assetUuids]), objectIds: Object.freeze([...dependency.objectIds]), reasons: Object.freeze([...dependency.reasons]) })))
}

export function assetReferenceIdentity(reference) {
  return projectAssetReferenceKey(reference)
}
