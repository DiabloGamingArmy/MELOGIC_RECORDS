import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SOURA_EDITOR_FORMAT_VERSION,
  computePortableTrackSourceRevision,
  createTrackDependencyDescriptor,
  getPortableTrackPlaybackDecision,
  serializePortableInstrument,
  serializePortableTrackRender
} from '../src/studio/portability/portableTrackRender.js'
import { planPortableRenderStrategy, PortableRenderProviderRegistry } from '../src/studio/portability/portableRenderStrategies.js'

const nativeTrack = () => ({
  id: 'track-1',
  volume: 72,
  pan: 0,
  instrument: {
    id: 'instrument-1',
    type: 'native-vst3',
    name: 'Serum 2',
    pluginInstanceId: 'native-vst3:track-1:/Users/alice/Library/Audio/Plug-Ins/VST3/Serum.vst3',
    params: {
      nativePluginPath: '/Users/alice/Library/Audio/Plug-Ins/VST3/Serum.vst3',
      nativePluginName: 'Serum 2',
      nativePluginVendor: 'Xfer Records',
      nativePluginVersion: '2.0',
      nativePluginBundleId: 'com.xferrecords.serum2',
      nativePluginFormat: 'VST3',
      nativeExecutionState: 'running',
      presetState: { cutoff: 0.42 }
    }
  },
  midiEffects: [],
  audioEffects: [{ id: 'compressor-1', type: 'compressor', enabled: true, params: { threshold: -12 } }],
  automation: { volume: [] }
})
const regions = () => [{ trackId: 'track-1', type: 'midi', startBeat: 0, endBeat: 4, notes: [{ note: 60, startBeat: 0, durationBeats: 1, velocity: 0.8 }] }]
const tempoEvents = [{ beat: 0, bpm: 120 }]
const timeSignatureEvents = [{ beat: 0, numerator: 4, denominator: 4 }]

test('format v5 strips local VST3 runtime data but preserves dependency and preset state', () => {
  const track = nativeTrack()
  const serialized = serializePortableInstrument(track.instrument)
  assert.equal(SOURA_EDITOR_FORMAT_VERSION, 5)
  assert.equal(serialized.params.nativePluginPath, undefined)
  assert.equal(serialized.params.nativeExecutionState, undefined)
  assert.equal(serialized.pluginInstanceId, undefined)
  assert.deepEqual(serialized.params.presetState, { cutoff: 0.42 })
  assert.deepEqual(createTrackDependencyDescriptor(track.instrument), {
    capability: 'native-vst3-host',
    format: 'VST3',
    id: 'com.xferrecords.serum2',
    kind: 'instrument-plugin',
    name: 'Serum 2',
    vendor: 'Xfer Records',
    version: '2.0'
  })
})

test('portable revision follows audible source, not machine path or live fader state', () => {
  const track = nativeTrack()
  const input = { track, regions: regions(), tempoEvents, timeSignatureEvents }
  const revision = computePortableTrackSourceRevision(input)
  track.instrument.params.nativePluginPath = '/Volumes/Other/Serum.vst3'
  track.volume = 12
  track.pan = 80
  assert.equal(computePortableTrackSourceRevision(input), revision)
  track.audioEffects[0].params.threshold = -18
  assert.notEqual(computePortableTrackSourceRevision(input), revision)
})

test('missing plug-in uses only a current render and preserves live recovery', () => {
  const track = nativeTrack()
  const sourceRevision = computePortableTrackSourceRevision({ track, regions: regions(), tempoEvents, timeSignatureEvents })
  track.portableRender = {
    sourceRevision,
    createdAt: '2026-08-29T00:00:00.000Z',
    audio: { downloadUrl: 'https://example.invalid/serum-render.wav', durationSeconds: 2, startBeat: 0, endBeat: 4 }
  }
  const web = getPortableTrackPlaybackDecision({ track, regions: regions(), tempoEvents, timeSignatureEvents, capabilities: { nativeVst3Host: false } })
  assert.equal(web.mode, 'portable')
  const desktop = getPortableTrackPlaybackDecision({ track, regions: regions(), tempoEvents, timeSignatureEvents, capabilities: { nativeVst3Host: true } })
  assert.equal(desktop.mode, 'live')
  const editedRegions = regions()
  editedRegions[0].notes[0].note = 61
  const stale = getPortableTrackPlaybackDecision({ track, regions: editedRegions, tempoEvents, timeSignatureEvents, capabilities: { nativeVst3Host: false } })
  assert.equal(stale.mode, 'stale')
  assert.equal(serializePortableTrackRender(track.portableRender, stale.sourceRevision).status, 'stale')
})

test('render strategy selects supported providers without claiming native offline support', async () => {
  assert.deepEqual(planPortableRenderStrategy({ offlineAudio: true, webAudio: true }), { strategy: 'offline-audio-context', fallback: 'realtime-web-audio' })
  assert.deepEqual(planPortableRenderStrategy({ nativeVst3Host: true, nativeOfflinePluginRender: false }, { dependency: { capability: 'native-vst3-host' } }), { strategy: 'realtime-native', fallback: null })
  const registry = new PortableRenderProviderRegistry().register('test', { render: async ({ value }) => value * 2 })
  assert.equal(await registry.render({ strategy: 'test' }, { value: 4 }), 8)
})

