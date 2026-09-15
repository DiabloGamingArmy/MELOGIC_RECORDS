import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { section } from './helpers/souraPersistenceHarness.mjs'
test('same metadata on different files never substitutes the first decoded audio', async () => {
  let decodes = 0
  const context = vm.createContext({ audioImportPreviewCache: new Map(), isSupportedAudioFile: () => true,
    getAudioContext: () => ({ decodeAudioData: async bytes => { decodes++; return { sampleRate: 48000, numberOfChannels: 1, duration: 1, value: new Uint8Array(bytes)[0] } } }),
    parseWavBitDepth: () => ({ bitDepth: 16 }), extensionForAudioFile: () => 'wav', buildAudioWaveformFromBuffer: () => ({}), WAVEFORM_PERSISTED_MAX_PEAKS: 2400, minAudioRegionSeconds: .01 })
  vm.runInContext(section('function audioImportCacheKey(', 'function getAudioImportRegionLabel('), context)
  const file = value => ({ name: 'take.wav', size: 1, lastModified: 1, type: 'audio/wav', arrayBuffer: async () => new Uint8Array([value]).buffer })
  const first = file(1), second = file(2)
  assert.equal((await context.decodeAudioFileForImport(first)).audioBuffer.value, 1)
  assert.equal((await context.decodeAudioFileForImport(second)).audioBuffer.value, 2)
  await context.decodeAudioFileForImport(first)
  assert.equal(decodes, 2)
})
