import test from 'node:test'
import assert from 'node:assert/strict'
import { collectMetronomeBeatIndices } from '../src/studio/transport/metronomeSchedule.js'
import { VIEWPORT_PLAYHEAD_UPDATE_OPTIONS } from '../src/studio/transport/timelineTransportInvariant.js'

test('viewport geometry cannot restart or synchronize transport', () => {
  assert.deepEqual(VIEWPORT_PLAYHEAD_UPDATE_OPTIONS, {
    restartTransport: false,
    syncAudioEngine: false
  })
  assert.equal(Object.isFrozen(VIEWPORT_PLAYHEAD_UPDATE_OPTIONS), true)
})

test('repeated viewport work does not make a consumed metronome beat schedulable again', () => {
  let lastScheduledBeat = 31
  const scheduled = []
  for (let zoomGesture = 0; zoomGesture < 250; zoomGesture += 1) {
    const beats = collectMetronomeBeatIndices({ lastScheduledBeat, currentBeat: 32, lookaheadBeat: 32 })
    scheduled.push(...beats)
    if (beats.length) lastScheduledBeat = beats.at(-1)
  }
  assert.deepEqual(scheduled, [32])
  assert.deepEqual(collectMetronomeBeatIndices({ lastScheduledBeat: 32, currentBeat: 32, lookaheadBeat: 33 }), [33])
})

