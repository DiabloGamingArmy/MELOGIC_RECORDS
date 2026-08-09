import assert from 'node:assert/strict'
import test from 'node:test'
import { createVertixAssetRegistry } from '../src/vertix/assets/assetRegistry.js'
import {
  builtInStageAssetPackage,
  builtInStageAssets,
  vertixAssetRegistry
} from '../src/vertix/assets/builtInStageAssetProvider.js'

test('built-in Vertix assets retain their stable identities and specialized metadata', () => {
  const assetIds = builtInStageAssets.map((asset) => asset.id)
  const movingHead = vertixAssetRegistry.getAsset('asset-moving-head')

  assert.equal(assetIds.length, 23)
  assert.equal(new Set(assetIds).size, assetIds.length)
  assert.ok(assetIds.includes('primitive-rectangle'))
  assert.ok(assetIds.includes('asset-power-distro'))
  assert.equal(movingHead.metadata.address, 1)
  assert.deepEqual(movingHead.defaultTransform.position, { x: 0, y: 8, z: -8 })
  assert.deepEqual(movingHead.preview, { icon: 'MH' })
  assert.ok(movingHead.tags.includes('lighting'))
})

test('registry exposes category lookup, asset lookup, groups, and built-in provenance', () => {
  const movingHead = vertixAssetRegistry.getAsset('asset-moving-head')
  const lightingAssets = vertixAssetRegistry.listAssets({ category: 'lighting' })
  const groups = vertixAssetRegistry.listAssetGroups()

  assert.equal(vertixAssetRegistry.getAsset('missing-asset'), undefined)
  assert.deepEqual(lightingAssets.map((asset) => asset.id), ['asset-moving-head', 'asset-led-bar'])
  assert.deepEqual(groups.map((group) => group.key), ['primitives', 'production'])
  assert.deepEqual(movingHead.provenance, {
    ...builtInStageAssetPackage,
    assetUuid: 'com.melogic.vertix.builtin-stage-assets:asset-moving-head'
  })
})

test('registry rejects duplicate asset IDs across providers', () => {
  const duplicateRegistry = createVertixAssetRegistry([
    { id: 'first', listAssets: () => [{ id: 'shared-id' }] },
    { id: 'second', listAssets: () => [{ id: 'shared-id' }] }
  ])

  assert.throws(() => duplicateRegistry.listAssets(), /Duplicate Vertix asset id: shared-id/)
})
