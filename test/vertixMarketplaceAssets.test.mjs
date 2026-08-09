import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveProductVertixCapability, isSafeArchivePath, withVertixAssetFlag } from '../src/vertix/marketplace/vertixAssetFiles.js'

const compatible = { status: 'compatible', compatible: true, compatibleAssetCount: 2, assetPaths: ['Truss/one.glb', 'Truss/two.glb'] }

test('technical ZIP compatibility and explicit publisher intent remain separate', () => {
  const detectedOnly = withVertixAssetFlag({ id: 'zip-a', name: 'pack.zip' }, false, compatible)
  const optedIn = withVertixAssetFlag({ id: 'zip-b', name: 'pack-two.zip' }, true, compatible)
  const capability = deriveProductVertixCapability([detectedOnly, optedIn, { id: 'pdf', name: 'manual.pdf', isVertixAsset: true }])
  assert.equal(capability.containsVertixAssets, true)
  assert.equal(capability.hasVertixAssets, true)
  assert.equal(capability.compatibleFileCount, 2)
  assert.deepEqual(capability.eligibleFiles.map((file) => file.id), ['zip-b'])
})

test('unsafe archive paths are rejected before installation', () => {
  assert.equal(isSafeArchivePath('Truss/Straight/1m.glb'), true)
  assert.equal(isSafeArchivePath('../escape.glb'), false)
  assert.equal(isSafeArchivePath('C:/escape.glb'), false)
  assert.equal(isSafeArchivePath('%2e%2e/escape.glb'), false)
})
