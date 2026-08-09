import assert from 'node:assert/strict'
import test from 'node:test'
import { createVertixAssetRegistry } from '../src/vertix/assets/assetRegistry.js'
import {
  builtInStageAssetPackage,
  builtInStageAssets,
  vertixAssetRegistry
} from '../src/vertix/assets/builtInStageAssetProvider.js'

test('built-in Vertix assets are the seven portable procedural primitives', () => {
  const assetIds = builtInStageAssets.map((asset) => asset.id)
  const cube = vertixAssetRegistry.getAsset('primitive-cube')

  assert.equal(assetIds.length, 7)
  assert.equal(new Set(assetIds).size, assetIds.length)
  assert.deepEqual(assetIds, ['primitive-cube', 'primitive-plane', 'primitive-uv-sphere', 'primitive-icosphere', 'primitive-cylinder', 'primitive-cone', 'primitive-torus'])
  assert.deepEqual(cube.defaultTransform.position, { x: 0, y: 1, z: 0 })
  assert.deepEqual(cube.preview, { icon: 'Cube', kind: 'procedural-3d' })
  assert.equal(cube.virtualPath, 'VERTIX/Built-in/Primitives/Cube')
})

test('registry exposes category lookup, asset lookup, groups, and built-in provenance', () => {
  const cube = vertixAssetRegistry.getAsset('primitive-cube')
  const primitiveAssets = vertixAssetRegistry.listAssets({ category: 'primitive' })
  const groups = vertixAssetRegistry.listAssetGroups()

  assert.equal(vertixAssetRegistry.getAsset('missing-asset'), undefined)
  assert.equal(primitiveAssets.length, 7)
  assert.deepEqual(groups.map((group) => group.key), ['primitives'])
  assert.deepEqual(cube.provenance, {
    ...builtInStageAssetPackage,
    assetUuid: 'com.melogic.vertix.builtin-primitives:primitive-cube'
  })
})

test('registry rejects duplicate asset IDs across providers', () => {
  const duplicateRegistry = createVertixAssetRegistry([
    { id: 'first', listAssets: () => [{ id: 'shared-id' }] },
    { id: 'second', listAssets: () => [{ id: 'shared-id' }] }
  ])

  assert.throws(() => duplicateRegistry.listAssets(), /Duplicate Vertix asset id: shared-id/)
})
