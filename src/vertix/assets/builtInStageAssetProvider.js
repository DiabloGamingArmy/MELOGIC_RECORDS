import { createVertixAssetRegistry } from './assetRegistry.js'
import { createBrowserPackRegistryStorage, createPackInstallationRegistry } from '../packages/packInstallationRegistry.js'

export const builtInStageAssetPackage = Object.freeze({
  packageId: 'com.melogic.vertix.builtin-primitives',
  packageVersion: '1.0.0',
  publisherId: 'melogic',
  source: 'built-in',
  integrity: 'vertix-builtin-primitives-v1'
})

const primitiveDefinitions = [
  { id: 'primitive-cube', label: 'Cube', type: 'primitive-cube', icon: 'Cube', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 1, z: 0 }, technicalMetadata: { vertices: 24, triangles: 12 } },
  { id: 'primitive-plane', label: 'Plane', type: 'primitive-plane', icon: 'Plane', dimensions: { width: 4, depth: 4, height: 0.04 }, position: { x: 0, y: 0.02, z: 0 }, technicalMetadata: { vertices: 4, triangles: 2 } },
  { id: 'primitive-uv-sphere', label: 'UV Sphere', type: 'primitive-uv-sphere', icon: 'UV', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 1, z: 0 } },
  { id: 'primitive-icosphere', label: 'Icosphere', type: 'primitive-icosphere', icon: 'Ico', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 1, z: 0 } },
  { id: 'primitive-cylinder', label: 'Cylinder', type: 'primitive-cylinder', icon: 'Cyl', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 1, z: 0 } },
  { id: 'primitive-cone', label: 'Cone', type: 'primitive-cone', icon: 'Cone', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 1, z: 0 } },
  { id: 'primitive-torus', label: 'Torus', type: 'primitive-torus', icon: 'Torus', dimensions: { width: 2.6, depth: 2.6, height: 0.8 }, position: { x: 0, y: 1, z: 0 } }
]

function defineBuiltInAsset(asset) {
  return Object.freeze({
    ...asset,
    assetId: `${builtInStageAssetPackage.packageId}:${asset.id}`,
    assetUuid: `${builtInStageAssetPackage.packageId}:${asset.id}`,
    displayName: asset.label,
    fileName: '',
    format: 'procedural',
    mimeType: 'application/x-vertix-primitive',
    sourceType: 'built-in',
    category: 'primitive',
    layer: 'stage',
    tags: ['primitive', 'built-in', asset.type],
    source: builtInStageAssetPackage.source,
    virtualPath: `VERTIX/Built-in/Primitives/${asset.label}`,
    preview: { icon: asset.icon, kind: 'procedural-3d' },
    metadata: { color: '#53667f', units: 'm', ...(asset.metadata || {}) },
    defaultTransform: {
      position: { ...asset.position },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    },
    provenance: {
      ...builtInStageAssetPackage,
      assetUuid: `${builtInStageAssetPackage.packageId}:${asset.id}`
    }
  })
}

export const builtInStageAssets = Object.freeze(primitiveDefinitions.map(defineBuiltInAsset))

export const builtInStageAssetProvider = Object.freeze({
  id: 'builtin-primitives',
  package: builtInStageAssetPackage,
  listAssets: () => builtInStageAssets,
  getAsset: (assetId) => builtInStageAssets.find((asset) => asset.id === assetId),
  listAssetGroups: () => [{ key: 'primitives', label: 'Primitives', assetIds: builtInStageAssets.map((asset) => asset.id) }]
})

export const vertixAssetRegistry = createVertixAssetRegistry([builtInStageAssetProvider])

// Only small install/source metadata lives here. GLB bytes use account storage
// and the disposable binary cache in binaryAssetCache.js.
export const vertixPackInstallationRegistry = createPackInstallationRegistry({
  assetRegistry: vertixAssetRegistry,
  environment: globalThis.__VERTIX_RUNTIME__ === 'desktop' ? 'desktop' : 'web',
  storage: createBrowserPackRegistryStorage()
})

vertixPackInstallationRegistry.hydrate()
