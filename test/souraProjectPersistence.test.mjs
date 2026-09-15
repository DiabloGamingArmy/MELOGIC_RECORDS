import test from 'node:test'
import assert from 'node:assert/strict'
import { persistenceHarness } from './helpers/souraPersistenceHarness.mjs'

test('reopening replaces the bootstrap track, including a deliberately empty project', () => {
  for (const tracks of [[], [{ id: 'kept', type: 'audio', name: 'Kept' }]]) {
    const app = persistenceHarness()
    app.applyLoadedEditorState({ version: 5, tracks, regions: [] })
    assert.deepEqual(Array.from(app.tracks, t => t.id), tracks.map(t => t.id))
  }
})

test('save, close runtime, reopen, save preserves authored project state', () => {
  const app = persistenceHarness({ tracks: [] })
  app.applyLoadedEditorState({ version: 5,
    projectMetadata: { title: 'Session', bpm: 123.456, key: 'D minor', timeSignature: '7/8' },
    timeline: { bars: 12, beatsPerBar: 7, positiveBeats: 84, pixelsPerBar: 210, preStartPixels: 210, playheadX: 630, trackHeight: 100, cycleRange: { startX: 270, endX: 570 } },
    globalTracks: { tempoEvents: [{ beat: 0, bpm: 123.456 }, { beat: 14, bpm: 97.2 }], timeSignatureEvents: [{ beat: 0, numerator: 7, denominator: 8 }], keySignatureEvents: [{ beat: 0, root: 'D', scale: 'minor' }], markers: [{ id: 'marker', beat: 14, name: 'Verse' }] },
    toggles: { followPlayhead: true, metronome: true, countIn: true, snap: false, cycle: true },
    notes: { pages: [{ id: 'p', title: 'Notes', body: 'Take two' }], activePageId: 'p' },
    tracks: [{ id: 'synth', type: 'software', name: 'Synth', volume: 63, pan: -35, muted: false, soloed: true, recordArmed: true,
      automation: { parameters: { volume: { points: [{ beat: 4, value: .5 }] } } },
      channelSettings: { midiInput: 'Keys', midiChannel: '2', audioOutput: 'Stereo Out', monitor: true, gainTrim: -3 },
      instrument: { type: 'melogic-wavetable', params: { cutoff: .32, customWave: [0, .3, -.2] } },
      midiEffects: [{ id: 'arp', type: 'arp', params: { rate: .25 }, enabled: false }],
      audioEffects: [{ id: 'eq', type: 'eq', params: { gain: 2 }, enabled: true }] }],
    regions: [{ id: 'midi', trackId: 'synth', type: 'midi', startBeat: 0, endBeat: 8, notes: [{ id: 'n', note: 60, startBeat: 0, durationBeats: 1, velocity: .7, notation: { articulation: 'staccato' } }], score: { clef: 'treble' } }]
  })
  const first = JSON.parse(JSON.stringify(app.buildEditorStateForSave()))
  const reopened = persistenceHarness()
  reopened.applyLoadedEditorState(JSON.parse(JSON.stringify(first)))
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.buildEditorStateForSave())), first)
})

test('malformed data is rejected before any live state changes', () => {
  for (const malformed of [[], { version: 999 }, { tracks: [null] }, { tracks: [{ id: 'x' }, { id: 'x' }] }, { tracks: [], regions: [{ id: 'r', trackId: 'missing' }] }, { regions: [{ id: 'r', trackId: 't', notes: [null] }] }, { globalTracks: { tempoEvents: 'bad' } }]) {
    const app = persistenceHarness()
    assert.throws(() => app.applyLoadedEditorState(malformed), /Project data is invalid/)
    assert.equal(app.tracks[0].id, 'demo-track')
    assert.equal(app.timelineState.bars, 32)
  }
})
