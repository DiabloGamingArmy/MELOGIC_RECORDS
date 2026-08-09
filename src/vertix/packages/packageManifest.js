export const VERTIX_PACK_SCHEMA_VERSION = 1

export const VERTIX_PACKAGE_ID_PATTERN = /^@[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,127}$/
export const VERTIX_PUBLISHER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const VERTIX_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseVertixPackManifest(input) {
  if (typeof input === 'string') return JSON.parse(input)
  if (!isPlainObject(input)) throw new TypeError('A Vertix Pack manifest must be a JSON object or JSON string.')
  return typeof structuredClone === 'function'
    ? structuredClone(input)
    : JSON.parse(JSON.stringify(input))
}

export function vertixPackageIdentity(manifest = {}) {
  return manifest.id && manifest.version ? `${manifest.id}@${manifest.version}` : ''
}

export function vertixPackageAssetId(manifest = {}, assetUuid = '') {
  const packageIdentity = vertixPackageIdentity(manifest)
  return packageIdentity && assetUuid ? `${packageIdentity}:${assetUuid}` : ''
}
