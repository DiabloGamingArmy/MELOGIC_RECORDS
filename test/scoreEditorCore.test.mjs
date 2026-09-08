import test from 'node:test'
import assert from 'node:assert/strict'

import { collectScoreEvents, normalizeScoreSettings } from '../src/studio/score/scoreModel.js'
import { quantizeForDisplay, decomposeDuration } from '../src/studio/score/scoreTheory.js'
import { tabCandidates, assignTab } from '../src/studio/score/scoreTab.js'
import { moveScoreNotes } from '../src/studio/score/scoreCommands.js'

// soura-score-editor-hardening-v1

test('score adapter preserves an intentional zero velocity', () => {
  const region = {
    id: 'r1', type: 'midi', startBeat: 0, endBeat: 4,
    notes: [{ id: 'n1', note: 60, startBeat: 0, durationBeats: 1, velocity: 0 }]
  }
  const [event] = collectScoreEvents([region])
  assert.equal(event.velocity, 0)
  assert.equal(event.id, 'r1:n1')
})

test('display quantization never mutates authoritative MIDI timing', () => {
  const event = { startBeat: 1.03, durationBeats: 0.49 }
  const displayed = quantizeForDisplay(event, 0.25)
  assert.deepEqual(event, { startBeat: 1.03, durationBeats: 0.49 })
  assert.equal(displayed.startBeat, 1)
  assert.equal(displayed.durationBeats, 0.5)
  assert.deepEqual(quantizeForDisplay(event, 0), event)
})

test('dotted duration decomposition remains non-triplet', () => {
  const pieces = decomposeDuration(1.5)
  assert.equal(pieces.reduce((sum, item) => sum + item.beats, 0), 1.5)
  assert.equal(pieces.some(item => item.triplet), false)
})

test('TAB candidates respect alternate tuning, capo and manual string', () => {
  const settings = { tuning: [64, 59, 55, 50, 45, 40], capo: 2, maxFret: 24 }
  const all = tabCandidates(66, settings)
  assert.ok(all.some(candidate => candidate.string === 1 && candidate.fret === 0))
  const manual = tabCandidates(66, settings, 1)
  assert.deepEqual(manual, [{ string: 1, fret: 0 }])
})

test('TAB assignment never assigns two simultaneous notes to one string', () => {
  const events = [
    { id: 'a', pitch: 64, startBeat: 0, durationBeats: 1, notation: {} },
    { id: 'b', pitch: 67, startBeat: 0, durationBeats: 1, notation: {} },
  ]
  const result = assignTab(events, { tuning: [64,59,55,50,45,40], capo: 0, maxFret: 24 })
  const picks = events.map(event => result.get(event.id)).filter(Boolean)
  assert.equal(new Set(picks.map(pick => pick.string)).size, picks.length)
})

test('group score movement preserves intervals and relative timing while clamping', () => {
  const region = {
    id: 'r', type: 'midi', startBeat: 2, endBeat: 8, durationBeats: 6,
    notes: [
      { note: 60, startBeat: 2.5, durationBeats: 1, velocity: 0.8 },
      { note: 67, startBeat: 3, durationBeats: 1, velocity: 0.8 },
    ]
  }
  moveScoreNotes(region, [0,1], -10, 100)
  assert.equal(region.notes[1].startBeat - region.notes[0].startBeat, 0.5)
  assert.equal(region.notes[1].note - region.notes[0].note, 7)
  assert.equal(region.notes[0].startBeat, 2)
  assert.equal(region.notes[1].note, 127)
})

test('score settings sanitize invalid tuning without destroying defaults', () => {
  const settings = normalizeScoreSettings({ tuning: [999], zoom: 100 })
  assert.deepEqual(settings.tuning, [64,59,55,50,45,40])
  assert.equal(settings.zoom, 2)
})
