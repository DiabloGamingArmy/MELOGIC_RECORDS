import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getTimelineViewportBeatRange,
  timelineBeatRangesOverlap,
  timelineViewportNeedsRefresh
} from '../src/studio/timeline/timelineViewport.js'

test('timeline viewport converts a buffered pixel window to clamped beats', () => {
  assert.deepEqual(getTimelineViewportBeatRange({
    scrollLeft: 600,
    viewportWidth: 900,
    originX: 120,
    pixelsPerBeat: 30,
    minBeat: 0,
    maxBeat: 80,
    bufferViewports: 1
  }), { startBeat: 0, endBeat: 76 })
})

test('timeline range overlap includes clips crossing either viewport edge', () => {
  const viewport = { startBeat: 20, endBeat: 40 }
  assert.equal(timelineBeatRangesOverlap(5, 21, viewport), true)
  assert.equal(timelineBeatRangesOverlap(39, 60, viewport), true)
  assert.equal(timelineBeatRangesOverlap(5, 19.99, viewport), false)
  assert.equal(timelineBeatRangesOverlap(40.01, 60, viewport), false)
})

test('viewport refresh is requested only after the visible range leaves its buffer', () => {
  const rendered = { startBeat: 10, endBeat: 50 }
  assert.equal(timelineViewportNeedsRefresh(rendered, { startBeat: 20, endBeat: 40 }), false)
  assert.equal(timelineViewportNeedsRefresh(rendered, { startBeat: 9, endBeat: 40 }), true)
  assert.equal(timelineViewportNeedsRefresh(rendered, { startBeat: 20, endBeat: 51 }), true)
})
