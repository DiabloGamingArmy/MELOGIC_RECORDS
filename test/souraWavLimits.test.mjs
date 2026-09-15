import test from 'node:test'
import assert from 'node:assert/strict'
import { audioBufferToWavBlob } from '../src/studio/audio/audioStretchRenderService.js'
import { encodeWav } from '../src/studio/export/wavEncoder.js'
test('rendered mono 24-bit WAV pads odd data without including padding in data size', async () => {
  const blob = audioBufferToWavBlob({ numberOfChannels: 1, length: 1, sampleRate: 48000, getChannelData: () => new Float32Array([.5]) }, { bitDepth: 24 })
  const bytes = new DataView(await blob.arrayBuffer())
  assert.equal(bytes.byteLength, 48); assert.equal(bytes.getUint32(4, true), 40); assert.equal(bytes.getUint32(40, true), 3)
})
test('both WAV encoders reject oversized logical payloads before allocation or PCM access', () => {
  const frames = 2 ** 31
  assert.throws(() => encodeWav([{ length: frames }, { length: frames }], 48000, 24), /WAV 4 GB limit/)
  assert.throws(() => audioBufferToWavBlob({ numberOfChannels: 2, length: frames, sampleRate: 48000, getChannelData() { throw Error('must not read') } }), /WAV 4 GB limit/)
})
