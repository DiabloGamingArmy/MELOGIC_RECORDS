import assert from 'node:assert/strict'
import test from 'node:test'
import {
  arrangementViewportTransforms,
  beatForTimelineX,
  clampArrangementViewport,
  collectTimelineGeometryInvariantErrors,
  normalizeWheelDeltaPixels,
  planTimelineZoomViewport,
  timelineXForBeat,
  timelineZoomFactorFromWheel
} from '../src/studio/timeline/arrangementViewport.js'

test('all horizontal surfaces derive the same absolute transform without accumulated drift', () => {
  const first = arrangementViewportTransforms({ scrollLeft: 487.5, scrollTop: 128 })
  const repeated = Array.from({ length: 100 }, () => arrangementViewportTransforms({ scrollLeft: 487.5, scrollTop: 128 }))
  assert.equal(first.horizontal, 'translate3d(-487.5px,0,0)')
  assert.ok(repeated.every((value) => value.horizontal === first.horizontal && value.vertical === first.vertical))
})

test('viewport clamps min and max scroll boundaries', () => {
  assert.deepEqual(clampArrangementViewport({ scrollLeft: -50, scrollTop: -2, maxScrollLeft: 400, maxScrollTop: 200 }), { scrollLeft: 0, scrollTop: 0 })
  assert.deepEqual(clampArrangementViewport({ scrollLeft: 900, scrollTop: 800, maxScrollLeft: 400, maxScrollTop: 200 }), { scrollLeft: 400, scrollTop: 200 })
})

test('wheel zoom is proportional to normalized delta instead of event count', () => {
  const tiny = timelineZoomFactorFromWheel({ deltaY: -1 })
  const larger = timelineZoomFactorFromWheel({ deltaY: -40 })
  assert.ok(tiny > 1 && tiny < 1.01)
  assert.ok(larger > tiny)
  assert.ok(Math.abs(tiny * timelineZoomFactorFromWheel({ deltaY: 1 }) - 1) < 1e-12)
  assert.equal(normalizeWheelDeltaPixels({ delta: 2, deltaMode: 1 }), 32)
  assert.equal(normalizeWheelDeltaPixels({ delta: 1, deltaMode: 2, pageSize: 720 }), 720)
})

test('continued small pinch deltas progress smoothly across the zoom range', () => {
  const one = timelineZoomFactorFromWheel({ deltaY: -1 })
  const accumulated = Array.from({ length: 100 }, () => one).reduce((value, factor) => value * factor, 1)
  assert.ok(accumulated > 1.2 && accumulated < 1.23)
})

test('follow-playhead zoom centers the authoritative beat without mutating it', () => {
  const plan = planTimelineZoomViewport({
    targetPixelsPerBeat: 80,
    originX: 120,
    maxBeat: 64,
    viewportWidth: 1000,
    pointerViewportX: 850,
    pointerBeat: 24,
    playheadBeat: 12.5,
    followPlayhead: true,
    playing: true
  })
  assert.equal(plan.anchorMode, 'playhead')
  assert.equal(plan.anchorBeat, 12.5)
  assert.equal(timelineXForBeat({ beat: 12.5, originX: 120, pixelsPerBeat: 80 }) - plan.scrollLeft, 500)
})

test('pointer-anchored zoom preserves the focal pixel when follow is off', () => {
  const plan = planTimelineZoomViewport({
    targetPixelsPerBeat: 54,
    originX: 96,
    maxBeat: 80,
    viewportWidth: 900,
    pointerViewportX: 315,
    pointerBeat: 20,
    playheadBeat: 5,
    followPlayhead: false,
    playing: true
  })
  assert.equal(plan.anchorMode, 'pointer')
  assert.equal(timelineXForBeat({ beat: 20, originX: 96, pixelsPerBeat: 54 }) - plan.scrollLeft, 315)
})

test('timeline coordinate invariants share one beat-to-pixel authority', () => {
  const originX = 112
  const pixelsPerBeat = 37.5
  const positions = [0, 1, 3.5, 16].flatMap((beat) => {
    const x = timelineXForBeat({ beat, originX, pixelsPerBeat })
    assert.equal(beatForTimelineX({ x, originX, pixelsPerBeat }), beat)
    return ['ruler', 'grid', 'region'].map((surface) => ({ surface, beat, x }))
  })
  const errors = collectTimelineGeometryInvariantErrors({
    originX,
    pixelsPerBeat,
    expectedContentWidth: 2512,
    surfaces: ['ruler', 'grid', 'extension'].map((name) => ({ name, width: 2512 })),
    positions,
    roundTripBeats: [0, 0.25, 7, 63]
  })
  assert.deepEqual(errors, [])
})
