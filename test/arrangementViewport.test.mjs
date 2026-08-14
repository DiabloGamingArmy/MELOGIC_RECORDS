import assert from 'node:assert/strict'
import test from 'node:test'
import { arrangementViewportTransforms, clampArrangementViewport } from '../src/studio/timeline/arrangementViewport.js'

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
