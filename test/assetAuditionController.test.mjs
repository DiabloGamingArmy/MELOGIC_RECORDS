import assert from 'node:assert/strict'
import test from 'node:test'
import { AssetAuditionController } from '../src/studio/assets/AssetAuditionController.js'

const audio = (id) => ({ id, kind: 'audio', capabilities: { preview: true } })
const folder = (id) => ({ id, kind: 'folder', capabilities: { preview: false } })

function harness() {
  const events = []
  const sources = []
  const controller = new AssetAuditionController({
    createSource: async (asset) => {
      const source = { assetId: asset.id, stopped: false, async play() {}, stop() { this.stopped = true }, onEnded(callback) { this.ended = callback } }
      sources.push(source)
      return source
    },
    onStateChange: (state) => events.push(state)
  })
  return { controller, events, sources }
}

test('audition toggles the same asset and replaces the previous source', async () => {
  const { controller, sources } = harness()
  await controller.toggle(audio('a'))
  assert.equal(controller.snapshot().playbackState, 'playing')
  await controller.toggle(audio('a'))
  assert.equal(controller.snapshot().playbackState, 'stopped')
  await controller.toggle(audio('a'))
  await controller.toggle(audio('b'))
  assert.equal(sources.at(-2).stopped, true)
  assert.equal(controller.snapshot().activeAssetId, 'b')
})

test('space-style audition navigation autoplays until stopped', async () => {
  const { controller } = harness()
  const assets = [audio('a'), audio('b'), audio('c')]
  controller.selectAsset(assets[0])
  await controller.playSelected((id) => assets.find((asset) => asset.id === id), { autoplayNavigation: true })
  await controller.moveSelection(1, assets)
  assert.equal(controller.snapshot().activeAssetId, 'b')
  await controller.moveSelection(-1, assets)
  assert.equal(controller.snapshot().activeAssetId, 'a')
  controller.stop()
  await controller.moveSelection(1, assets)
  assert.equal(controller.snapshot().selectedAssetId, 'b')
  assert.equal(controller.snapshot().activeAssetId, '')
})

test('folders and non-previewable items cannot be auditioned', async () => {
  const { controller, sources } = harness()
  assert.equal(await controller.toggle(folder('folder')), false)
  assert.equal(sources.length, 0)
})

