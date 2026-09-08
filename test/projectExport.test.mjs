import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planExport, exportCapabilities, sanitizeExportName } from '../src/studio/export/exportPlan.js'
import { encodeWav } from '../src/studio/export/wavEncoder.js'
const track = { id: 'a', instrument: { enabled: true } }
const audio = { id: 'clip', type: 'audio', trackId: 'a', startBeat: 4, endBeat: 12 }
const midi = { id: 'midi', type: 'midi', trackId: 'a', startBeat: 0, endBeat: 8, notes: [{ note: 60 }] }
const plan = (extra = {}) => planExport({ tracks: [track], regions: [audio, midi], toSeconds: beat => beat / 2, ...extra })
test('entire project includes audio, MIDI and explicit tail', () => { assert.equal(plan().end, 6); assert.equal(plan().duration, 8); assert.equal(plan({ regions: [midi], tail: 0 }).duration, 4) })
test('cycle retains preroll and adds tail once', () => { const result = plan({ range: 'cycle', cycle: { start: 4, end: 8 } }); assert.equal(result.start, 2); assert.equal(result.end, 4); assert.equal(result.duration, 4); assert.equal(result.renderDuration, 6) })
test('invalid/empty ranges rejected', () => { assert.throws(() => plan({ regions: [] }), /no audible/); assert.throws(() => plan({ range: 'cycle' }), /cycle/); assert.throws(() => plan({ range: 'cycle', cycle: { start: 8, end: 4 } }), /cycle/); assert.throws(() => plan({ tail: -1 }), /tail/) })
test('mute and solo determine audible project end', () => {
  assert.throws(() => plan({ tracks: [{ ...track, muted: true }] }), /no audible/)
  assert.throws(() => plan({ regions: [{ ...audio, audioEdit: { mute: true } }] }), /no audible/)
  const result = plan({ tracks: [track, { id: 'b', soloed: true }], regions: [audio, { ...audio, trackId: 'b', endBeat: 4 }] })
  assert.equal(result.end, 2)
})
test('safe filenames and reserved names', () => { assert.equal(sanitizeExportName('../Mix: A.wav'), '.._Mix_ A.wav'); assert.equal(sanitizeExportName('CON'), '_CON.wav'); assert.equal(sanitizeExportName('...'), 'Soura Mix.wav'); assert.equal(sanitizeExportName('雪.wav'), '雪.wav') })
test('capabilities advertise only actual formats and rates', () => {
  const supportedRates = [44100, 48000, 96000, 192000]
  const web = exportCapabilities({ supportedRates }); assert.deepEqual(web.rates, [48000, 44100]); assert.equal(web.delivery, 'download'); assert.deepEqual(web.formats.map(f => f.id), ['wav'])
  const desktop = exportCapabilities({ desktop: true, supportedRates }); assert.deepEqual(desktop.rates, [48000, 44100, 96000, 192000]); assert.equal(desktop.delivery, 'native')
})
for (const depth of [16, 24, 32]) test(`WAV ${depth}: header, size, stereo interleaving and signed samples`, () => {
  const result = encodeWav([new Float32Array([0.5, -1]), new Float32Array([-0.5, 1])], 48000, depth)
  const view = new DataView(result.buffer), header = depth === 32 ? 56 : 44
  assert.equal(Buffer.from(result.buffer).subarray(0, 4).toString(), 'RIFF')
  assert.equal(view.getUint16(20, true), depth === 32 ? 3 : 1); assert.equal(view.getUint16(22, true), 2)
  assert.equal(view.getUint32(24, true), 48000); assert.equal(view.getUint16(34, true), depth)
  assert.equal(view.getUint32(header - 4, true), 4 * depth / 8)
  assert.equal(result.buffer.byteLength, header + 4 * depth / 8)
  if (depth === 16) { assert.equal(view.getInt16(header, true), 16384); assert.equal(view.getInt16(header + 2, true), -16384) }
  if (depth === 24) { assert.equal(view.getUint8(header + 2), 64); assert.equal(view.getUint8(header + 5), 192) }
  if (depth === 32) { assert.equal(view.getFloat32(header, true), .5); assert.equal(view.getFloat32(header + 4, true), -.5) }
})
test('24-bit precision, RIFF padding, clipping and normalization', () => {
  const sample = new Float32Array([1 / 65536])
  const view = new DataView(encodeWav([sample], 44100, 24).buffer)
  assert.equal(view.getUint8(44), 128); assert.equal(view.byteLength, 48)
  const channels = [new Float32Array([2, -2])]
  assert.equal(encodeWav(channels, 48000).clipped, true)
  const normalized = encodeWav(channels, 48000, 32, true)
  assert.equal(normalized.clipped, false); assert.ok(Math.abs(new DataView(normalized.buffer).getFloat32(56, true) - 10 ** (-1 / 20)) < 1e-6)
  assert.equal(channels[0][0], 2)
  assert.throws(() => encodeWav([new Float32Array([NaN])], 48000), /invalid audio/)
})
test('entry points share action; live and offline use the same bus and source factories', () => {
  const source = readFileSync(new URL('../src/studioProject.js', import.meta.url), 'utf8')
  assert.match(source, /label: 'Export\.\.\.', action: 'export-project'/)
  assert.match(source, /data-daw-menu-action="export-project">Export/)
  assert.match(source, /action === 'export-project'.*openProjectExport/)
  assert.ok((source.match(/createMasterMixBus\(/g) || []).length >= 2)
  assert.ok((source.match(/scheduleProjectAudioSource\(/g) || []).length >= 3)
  assert.match(source, /masterLevel: masterAudioBus\?\.gain.gain.value \?\? 1/)
})
