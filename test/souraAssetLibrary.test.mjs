import assert from 'node:assert/strict'
import test from 'node:test'
import { AssetLibrary, migrateLegacyAssetLibraryState } from '../src/studio/assets/AssetLibrary.js'
import { buildArchiveHierarchy, stableAssetId } from '../src/studio/assets/assetModel.js'
import { WebAssetStorage } from '../src/studio/assets/storage/WebAssetStorage.js'
import { isNativeAssetRuntime } from '../src/studio/assets/storage/NativeAssetStorage.js'
import { deriveProductSouraCapability, isEligibleSouraAssetFile, withSouraAssetFlag } from '../src/soura/marketplace/souraAssetFiles.js'
import { isSafeArchivePath } from '../src/vertix/marketplace/vertixAssetFiles.js'

const compatible = { status: 'compatible', compatible: true, compatibleAssetCount: 2, assetPaths: ['Drums/Kicks/one.wav', 'Drums/Snares/two.wav'] }

test('Soura compatibility remains separate from explicit creator intent', () => {
  const detected = withSouraAssetFlag({ id: 'a', name: 'audio.zip' }, false, compatible)
  const approved = withSouraAssetFlag({ id: 'b', name: 'approved.zip' }, true, compatible)
  const capability = deriveProductSouraCapability([detected, approved])
  assert.equal(isEligibleSouraAssetFile(detected), false)
  assert.equal(isEligibleSouraAssetFile(approved), true)
  assert.equal(withSouraAssetFlag({ id: 'bad', name: 'bad.zip' }, true, { status: 'incompatible', compatible: false }).isSouraAsset, false)
  assert.equal(capability.containsSouraAssets, true)
  assert.equal(capability.hasSouraAssets, true)
  assert.deepEqual(capability.eligibleFiles.map((file) => file.id), ['b'])
})

test('archive hierarchy is preserved with stable folder and audio ids', () => {
  const options = { rootName: 'Drum Pack', productId: 'product-1', entries: compatible.assetPaths.map((archivePath) => ({ archivePath, storagePath: `users/u/soura/${archivePath}` })) }
  const first = buildArchiveHierarchy(options)
  const second = buildArchiveHierarchy(options)
  assert.deepEqual(first.map((asset) => asset.id), second.map((asset) => asset.id))
  const kicks = first.find((asset) => asset.name === 'Kicks')
  const kick = first.find((asset) => asset.name === 'one.wav')
  assert.equal(kick.parentId, kicks.id)
  assert.equal(kick.source.archivePath, 'Drums/Kicks/one.wav')
})

test('provider normalization, legacy state migration, and storage feature detection are safe', async () => {
  const library = new AssetLibrary([{ id: 'primitive', sourceType: 'primitive', async listAssets() { return [{ id: stableAssetId('test', 'tone'), name: 'Tone', kind: 'audio', sourceType: 'primitive', parentId: 'primitive' }] } }])
  await library.refresh()
  assert.equal(library.listChildren('primitive')[0].name, 'Tone')
  assert.equal(migrateLegacyAssetLibraryState({ activePanel: 'loops' }).activePanel, 'asset-library')
  const storage = new WebAssetStorage({ indexedDB: null, navigator: {} })
  assert.equal(storage.supportsOpfs(), false)
  const blob = new Blob(['audio'], { type: 'audio/wav' })
  await storage.importFile({ id: 'session-audio', name: 'session.wav', kind: 'audio', sourceType: 'user' }, blob)
  assert.equal((await storage.listMetadata())[0].id, 'session-audio')
  assert.equal((await storage.getBlob({ id: 'session-audio' })).size, blob.size)
  assert.equal(isNativeAssetRuntime(), false)
  assert.equal(isSafeArchivePath('../escape.wav'), false)
  assert.equal(isSafeArchivePath('Drums/Kicks/one.wav'), true)
})
