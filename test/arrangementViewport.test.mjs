import assert from 'node:assert/strict'
import test from 'node:test'
import {
  arrangementViewportTransforms,
  beatForTimelineX,
  clampArrangementViewport,
  collectTimelineGeometryInvariantErrors,
  createTimelineGeometrySnapshot,
  normalizeWheelDeltaPixels,
  planTimelineScrollRefresh,
  planTimelineZoomViewport,
  timelineViewportXForBeat,
  timelineWidthForBeats,
  timelineXForBeat,
  timelineZoomFactorFromWheel
} from '../src/studio/timeline/arrangementViewport.js'

const closeTo = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
}

const zoomGeometry = ({ geometry, pointerViewportX, targetPixelsPerBeat, maxBeat = geometry.maxBeat }) => {
  const pointerBeat = beatForTimelineX({
    x: geometry.scrollLeft + pointerViewportX,
    originX: geometry.originX,
    pixelsPerBeat: geometry.pixelsPerBeat
  })
  const contentWidth = timelineXForBeat({ beat: maxBeat + 1, originX: geometry.originX, pixelsPerBeat: targetPixelsPerBeat })
  const plan = planTimelineZoomViewport({
    targetPixelsPerBeat,
    originX: geometry.originX,
    maxBeat,
    contentWidth,
    viewportWidth: geometry.viewportWidth,
    pointerViewportX,
    pointerBeat
  })
  return {
    pointerBeat,
    plan,
    geometry: createTimelineGeometrySnapshot({
      revision: geometry.revision + 1,
      originX: geometry.originX,
      pixelsPerBeat: targetPixelsPerBeat,
      maxBeat,
      contentWidth,
      viewportWidth: geometry.viewportWidth,
      scrollLeft: plan.scrollLeft
    })
  }
}

test('1. zoom at scrollLeft 0 preserves the pointer focal beat', () => {
  const oldGeometry = createTimelineGeometrySnapshot({ revision: 1, originX: 96, pixelsPerBeat: 24, maxBeat: 256, contentWidth: 6264, viewportWidth: 900, scrollLeft: 0 })
  const result = zoomGeometry({ geometry: oldGeometry, pointerViewportX: 420, targetPixelsPerBeat: 48 })
  closeTo(timelineViewportXForBeat({ beat: result.pointerBeat, geometry: result.geometry }), 420)
})

test('2. zoom after nonzero horizontal scroll preserves the pointer focal beat', () => {
  const oldGeometry = createTimelineGeometrySnapshot({ revision: 2, originX: 112, pixelsPerBeat: 36, maxBeat: 512, contentWidth: 18580, viewportWidth: 1024, scrollLeft: 4775.5 })
  const result = zoomGeometry({ geometry: oldGeometry, pointerViewportX: 713.25, targetPixelsPerBeat: 61.5 })
  closeTo(timelineViewportXForBeat({ beat: result.pointerBeat, geometry: result.geometry }), 713.25)
})

test('3. repeated zoom in and out does not accumulate coordinate drift', () => {
  let geometry = createTimelineGeometrySnapshot({ revision: 1, originX: 128, pixelsPerBeat: 40, maxBeat: 1024, contentWidth: 41128, viewportWidth: 1100, scrollLeft: 12000 })
  const pointerViewportX = 647.75
  const originalBeat = beatForTimelineX({ x: geometry.scrollLeft + pointerViewportX, originX: geometry.originX, pixelsPerBeat: geometry.pixelsPerBeat })
  for (let index = 0; index < 100; index += 1) {
    const factor = index % 2 === 0 ? 1.018 : 1 / 1.018
    geometry = zoomGeometry({ geometry, pointerViewportX, targetPixelsPerBeat: geometry.pixelsPerBeat * factor }).geometry
    closeTo(timelineViewportXForBeat({ beat: originalBeat, geometry }), pointerViewportX, 1e-7)
  }
  closeTo(geometry.pixelsPerBeat, 40, 1e-9)
  closeTo(geometry.scrollLeft, 12000, 1e-7)
})

test('4. deeply zoomed-out viewport clamps to both content boundaries', () => {
  const left = planTimelineZoomViewport({ targetPixelsPerBeat: 2, originX: 64, maxBeat: 32, viewportWidth: 800, pointerViewportX: 600, pointerBeat: 0 })
  assert.equal(left.scrollLeft, 0)
  assert.equal(left.maxScrollLeft, 0)
  const right = planTimelineZoomViewport({ targetPixelsPerBeat: 25, originX: 64, maxBeat: 32, viewportWidth: 300, pointerViewportX: 20, pointerBeat: 32 })
  assert.equal(right.scrollLeft, right.maxScrollLeft)
})

test('5. smallest supported region keeps its exact musical width', () => {
  closeTo(timelineWidthForBeats({ durationBeats: 0.05, pixelsPerBeat: 7.5 }), 0.375)
})

test('6. very long region keeps its exact musical width', () => {
  closeTo(timelineWidthForBeats({ durationBeats: 4096, pixelsPerBeat: 63.25 }), 259072)
})

test('7. audio waveform bounds remain inside their owning region', () => {
  const valid = collectTimelineGeometryInvariantErrors({ bounds: [{ surface: 'waveform', containerLeft: 500, containerWidth: 320, left: 500, width: 320 }] })
  assert.deepEqual(valid, [])
  const invalid = collectTimelineGeometryInvariantErrors({ bounds: [{ surface: 'waveform', containerLeft: 500, containerWidth: 320, left: 499, width: 322 }] })
  assert.equal(invalid[0].kind, 'container-bounds')
})

test('8. follow-playhead zoom centers the transport beat during playback', () => {
  const plan = planTimelineZoomViewport({ targetPixelsPerBeat: 80, originX: 120, maxBeat: 128, viewportWidth: 1000, pointerViewportX: 850, pointerBeat: 24, playheadBeat: 42.5, followPlayhead: true, playing: true })
  assert.equal(plan.anchorMode, 'playhead')
  assert.equal(plan.anchorBeat, 42.5)
  closeTo(timelineXForBeat({ beat: 42.5, originX: 120, pixelsPerBeat: 80 }) - plan.scrollLeft, 500)
})

test('9. ruler, grid, and region share the same viewport X after a large scroll and zoom', () => {
  const geometry = createTimelineGeometrySnapshot({ revision: 44, originX: 144, pixelsPerBeat: 72.25, maxBeat: 2048, contentWidth: 148200, viewportWidth: 1280, scrollLeft: 98765.5 })
  const beat = 1375.75
  const x = timelineViewportXForBeat({ beat, geometry })
  const errors = collectTimelineGeometryInvariantErrors({
    originX: geometry.originX,
    pixelsPerBeat: geometry.pixelsPerBeat,
    viewportPositions: ['ruler', 'grid', 'region'].map((surface) => ({ surface, beat, scrollLeft: geometry.scrollLeft, x }))
  })
  assert.deepEqual(errors, [])
})

test('10. zoom-owned scroll acknowledgement suppresses only its duplicate refresh', () => {
  const zoom = planTimelineScrollRefresh({ scrollLeft: 812.25, geometryRevision: 19, plannedScroll: { owner: 'zoom', revision: 19, scrollLeft: 812.25 } })
  assert.deepEqual(zoom, { programmatic: true, zoomOwnsViewport: true, shouldMarkUserInteraction: false, shouldRefreshViewport: false, shouldRefreshWaveforms: false })
  const follow = planTimelineScrollRefresh({ scrollLeft: 900, geometryRevision: 19, plannedScroll: { owner: 'follow', revision: 19, scrollLeft: 900 } })
  assert.equal(follow.programmatic, true)
  assert.equal(follow.shouldMarkUserInteraction, false)
  assert.equal(follow.shouldRefreshViewport, true)
  const stale = planTimelineScrollRefresh({ scrollLeft: 812.25, geometryRevision: 20, plannedScroll: { owner: 'zoom', revision: 19, scrollLeft: 812.25 } })
  assert.equal(stale.programmatic, false)
  assert.equal(stale.shouldRefreshViewport, true)
})

test('11. all horizontal surfaces use one absolute scroll transform and geometry revision', () => {
  const transform = arrangementViewportTransforms({ scrollLeft: 487.5, scrollTop: 128 })
  assert.equal(transform.horizontal, 'translate3d(-487.5px,0,0)')
  const errors = collectTimelineGeometryInvariantErrors({
    expectedContentWidth: 2512,
    expectedRevision: 7,
    surfaces: ['ruler', 'global', 'grid', 'extension'].map((name) => ({ name, width: 2512, revision: 7 }))
  })
  assert.deepEqual(errors, [])
})

test('12. high-resolution wheel deltas produce continuous reciprocal zoom factors', () => {
  const tiny = timelineZoomFactorFromWheel({ deltaY: -0.25 })
  const medium = timelineZoomFactorFromWheel({ deltaY: -12 })
  assert.ok(tiny > 1 && tiny < 1.002)
  assert.ok(medium > tiny)
  closeTo(tiny * timelineZoomFactorFromWheel({ deltaY: 0.25 }), 1, 1e-12)
  assert.equal(normalizeWheelDeltaPixels({ delta: 2, deltaMode: 1 }), 32)
  assert.equal(normalizeWheelDeltaPixels({ delta: 1, deltaMode: 2, pageSize: 720 }), 720)
})

test('viewport clamps negative and over-max scroll without changing vertical behavior', () => {
  assert.deepEqual(clampArrangementViewport({ scrollLeft: -50, scrollTop: -2, maxScrollLeft: 400, maxScrollTop: 200 }), { scrollLeft: 0, scrollTop: 0 })
  assert.deepEqual(clampArrangementViewport({ scrollLeft: 900, scrollTop: 800, maxScrollLeft: 400, maxScrollTop: 200 }), { scrollLeft: 400, scrollTop: 200 })
})

test('content-space beat conversion remains exactly reversible', () => {
  const originX = 112
  const pixelsPerBeat = 37.5
  const positions = [0, 0.25, 7, 63].map((beat) => ({ surface: 'grid', beat, x: timelineXForBeat({ beat, originX, pixelsPerBeat }) }))
  const errors = collectTimelineGeometryInvariantErrors({ originX, pixelsPerBeat, positions, roundTripBeats: [0, 0.25, 7, 63] })
  assert.deepEqual(errors, [])
})

test('required regression 1-3: every zoom keeps beat round trips, surface X, and four-beat width identical', () => {
  for (const pixelsPerBeat of [12, 30, 131.3949202906776, 512, 4096]) {
    const originX = 206.7062805701781
    const scrollLeft = 1789.375
    const beat = 17.25
    const contentX = timelineXForBeat({ beat, originX, pixelsPerBeat })
    closeTo(beatForTimelineX({ x: contentX, originX, pixelsPerBeat }), beat)
    const errors = collectTimelineGeometryInvariantErrors({
      originX,
      pixelsPerBeat,
      positions: ['ruler', 'grid', 'region', 'playhead'].map((surface) => ({ surface, beat, x: contentX })),
      viewportPositions: ['ruler', 'grid', 'region', 'playhead'].map((surface) => ({ surface, beat, scrollLeft, x: contentX - scrollLeft })),
      durations: [{ surface: 'region', durationBeats: 4, width: timelineWidthForBeats({ durationBeats: 4, pixelsPerBeat }) }],
      roundTripBeats: [0, 0.05, beat, 2048]
    })
    assert.deepEqual(errors, [])
    closeTo(timelineWidthForBeats({ durationBeats: 4, pixelsPerBeat }), 4 * pixelsPerBeat)
  }
})

test('required regression 6: scroll, zoom, scroll, and zoom again never double-applies scrollLeft', () => {
  let geometry = createTimelineGeometrySnapshot({ revision: 1, originX: 96, pixelsPerBeat: 42, maxBeat: 2048, contentWidth: 86154, viewportWidth: 1000, scrollLeft: 6000 })
  const pointerViewportX = 375
  geometry = zoomGeometry({ geometry, pointerViewportX, targetPixelsPerBeat: 67 }).geometry
  geometry = createTimelineGeometrySnapshot({ ...geometry, revision: geometry.revision + 1, scrollLeft: geometry.scrollLeft + 2400 })
  geometry = zoomGeometry({ geometry, pointerViewportX, targetPixelsPerBeat: 31.5 }).geometry
  const beat = beatForTimelineX({ x: geometry.scrollLeft + pointerViewportX, originX: geometry.originX, pixelsPerBeat: geometry.pixelsPerBeat })
  const expectedViewportX = timelineXForBeat({ beat, originX: geometry.originX, pixelsPerBeat: geometry.pixelsPerBeat }) - geometry.scrollLeft
  closeTo(expectedViewportX, pointerViewportX)
  assert.equal(arrangementViewportTransforms({ scrollLeft: geometry.scrollLeft }).horizontal, `translate3d(${-geometry.scrollLeft}px,0,0)`)
})

test('required regression 8: end-of-project clamp keeps every surface in the same coordinate space', () => {
  const plan = planTimelineZoomViewport({ targetPixelsPerBeat: 96, originX: 120, maxBeat: 64, viewportWidth: 900, pointerViewportX: 0, pointerBeat: 64 })
  assert.equal(plan.scrollLeft, plan.maxScrollLeft)
  const beat = 64
  const x = timelineXForBeat({ beat, originX: 120, pixelsPerBeat: 96 }) - plan.scrollLeft
  const errors = collectTimelineGeometryInvariantErrors({
    originX: 120,
    pixelsPerBeat: 96,
    viewportPositions: ['ruler', 'grid', 'region', 'playhead'].map((surface) => ({ surface, beat, scrollLeft: plan.scrollLeft, x }))
  })
  assert.deepEqual(errors, [])
})

test('required regression 9: representative high-resolution deltas remain proportional', () => {
  const positiveDeltas = [0.5, 1, 2, 5, 12]
  const zoomOut = positiveDeltas.map((deltaY) => timelineZoomFactorFromWheel({ deltaY }))
  const zoomIn = positiveDeltas.map((deltaY) => timelineZoomFactorFromWheel({ deltaY: -deltaY }))
  for (let index = 1; index < positiveDeltas.length; index += 1) {
    assert.ok(zoomOut[index] < zoomOut[index - 1])
    assert.ok(zoomIn[index] > zoomIn[index - 1])
  }
  positiveDeltas.forEach((deltaY, index) => closeTo(zoomOut[index] * zoomIn[index], 1, 1e-12))
  assert.equal(new Set(zoomOut).size, positiveDeltas.length)
})
