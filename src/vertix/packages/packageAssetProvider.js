import { vertixPackageAssetId, vertixPackageIdentity } from './packageManifest.js'
import { validateVertixPackManifest } from './packageValidator.js'

export class VertixPackValidationError extends Error {
  constructor(validation) {
    super('Vertix Pack validation failed.')
    this.name = 'VertixPackValidationError'
    this.validation = validation
  }
}

export function createVertixPack(manifestInput) {
  const validation = validateVertixPackManifest(manifestInput)
  return Object.freeze({
    manifest: validation.manifest,
    identity: validation.manifest ? vertixPackageIdentity(validation.manifest) : '',
    integrity: validation.manifest?.integrity || '',
    validation
  })
}

function registryAssetFromDeclaration(manifest, declaration) {
  const assetUuid = String(declaration.uuid || declaration.id)
  const defaultTransform = declaration.defaultTransform && typeof declaration.defaultTransform === 'object'
    ? declaration.defaultTransform
    : {}
  const integrity = declaration.integrity
    || (typeof declaration.source === 'object' ? declaration.source.integrity : '')
    || manifest.integrity
    || ''
  return Object.freeze({
    ...declaration,
    id: vertixPackageAssetId(manifest, assetUuid),
    assetUuid,
    label: declaration.name || declaration.label,
    name: declaration.name || declaration.label,
    type: declaration.type,
    category: declaration.category,
    layer: declaration.layer || declaration.category,
    dimensions: { ...(declaration.dimensions || {}) },
    position: { ...(declaration.position || defaultTransform.position || {}) },
    defaultTransform: {
      ...defaultTransform,
      position: { ...(defaultTransform.position || declaration.position || {}) },
      rotation: { x: 0, y: 0, z: 0, ...(defaultTransform.rotation || {}) },
      scale: { x: 1, y: 1, z: 1, ...(defaultTransform.scale || {}) }
    },
    metadata: { ...(declaration.metadata || {}) },
    tags: [...(declaration.tags || [])],
    provenance: {
      packageId: manifest.id,
      packageVersion: manifest.version,
      publisherId: manifest.publisher.id,
      assetUuid,
      source: 'vertix-pack',
      integrity
    }
  })
}

export function createPackageAssetProvider(packOrManifest) {
  const pack = packOrManifest?.validation ? packOrManifest : createVertixPack(packOrManifest)
  if (!pack.validation.valid) throw new VertixPackValidationError(pack.validation)
  const manifest = pack.manifest
  const assets = Object.freeze(manifest.assets.map((asset) => registryAssetFromDeclaration(manifest, asset)))
  const byRegistryId = new Map(assets.map((asset) => [asset.id, asset]))
  const byAssetUuid = new Map(assets.map((asset) => [asset.assetUuid, asset]))
  const categories = [...new Set(assets.map((asset) => asset.category))]

  return Object.freeze({
    id: `vertix-pack:${pack.identity}`,
    package: manifest,
    pack,
    listAssets: () => assets,
    getAsset: (assetId) => byRegistryId.get(assetId) || byAssetUuid.get(assetId),
    listAssetGroups: () => categories.map((category) => ({
      key: `${manifest.id}:${category}`,
      label: category,
      assetIds: assets.filter((asset) => asset.category === category).map((asset) => asset.id)
    }))
  })
}
