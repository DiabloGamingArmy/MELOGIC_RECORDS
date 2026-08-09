const cleanString = (value) => String(value ?? '').trim()

const positiveNumber = (value, fallback = 1) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * A project-owned, exact pointer to a registry asset. The scene object's id is
 * deliberately not part of this shape: one asset can be placed many times.
 */
export function normalizeProjectAssetReference(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return null
  return {
    ...reference,
    packageId: cleanString(reference.packageId),
    packageVersion: cleanString(reference.packageVersion),
    assetUuid: cleanString(reference.assetUuid),
    integrity: cleanString(reference.integrity),
    publisherId: cleanString(reference.publisherId),
    providerId: cleanString(reference.providerId)
  }
}

export function isValidProjectAssetReference(reference) {
  const normalized = normalizeProjectAssetReference(reference)
  return Boolean(normalized?.packageId && normalized.packageVersion && normalized.assetUuid && normalized.integrity)
}

export function createProjectAssetReference(asset, { providerId = '' } = {}) {
  const provenance = asset?.provenance
  if (!provenance || typeof provenance !== 'object') return null
  const reference = normalizeProjectAssetReference({
    packageId: provenance.packageId,
    packageVersion: provenance.packageVersion,
    assetUuid: provenance.assetUuid,
    integrity: provenance.integrity,
    publisherId: provenance.publisherId,
    providerId
  })
  return isValidProjectAssetReference(reference) ? reference : null
}

export function normalizeLastKnownBounds(bounds, fallbackDimensions = {}) {
  const source = bounds && typeof bounds === 'object' ? bounds : {}
  return {
    width: positiveNumber(source.width, positiveNumber(fallbackDimensions.width, 1)),
    depth: positiveNumber(source.depth, positiveNumber(fallbackDimensions.depth, 1)),
    height: positiveNumber(source.height, positiveNumber(fallbackDimensions.height, 1))
  }
}

export function lastKnownBoundsFromAsset(asset, fallbackDimensions = {}) {
  return normalizeLastKnownBounds(asset?.dimensions, fallbackDimensions)
}

export function projectAssetReferenceKey(reference) {
  const normalized = normalizeProjectAssetReference(reference)
  if (!isValidProjectAssetReference(normalized)) return ''
  return [normalized.packageId, normalized.packageVersion, normalized.assetUuid, normalized.integrity].join('|')
}
