import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { getRegionTimelineRange, getTimelineRegionGeometry, getTimelineRegionLaneGeometry } from '../src/studio/timeline/regionGeometry.js'
import { beatForTimelineX } from '../src/studio/timeline/arrangementViewport.js'

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
for (const type of ['audio', 'midi']) {
  test(`${type}: doubling scale doubles width without changing musical data`, () => {
    const region = Object.freeze({ type, startBeat: 4, endBeat: 12, durationBeats: 8 })
    const a = getTimelineRegionGeometry(region, { originX: 96, pixelsPerBeat: 25 })
    const b = getTimelineRegionGeometry(region, { originX: 96, pixelsPerBeat: 50 })
    assert.equal(a.width, 200)
    assert.equal(b.width, 400)
    assert.deepEqual(getRegionTimelineRange(region), { startBeat: 4, endBeat: 12, durationBeats: 8 })
  })
  test(`${type}: 250 zoom changes retain both endpoints with moving origin and scroll`, () => {
    const region = Object.freeze({ type, startBeat: 12, endBeat: 20, durationBeats: 8 })
    for (let revision = 0; revision < 250; revision++) {
      const geometry = { revision, originX: revision % 7 * 31, pixelsPerBeat: 5 + (revision * 17 % 250), scrollLeft: revision * 23 }
      const result = getTimelineRegionGeometry(region, geometry)
      close(result.width, 8 * geometry.pixelsPerBeat)
      close(beatForTimelineX({ ...geometry, x: result.left }), 12)
      close(beatForTimelineX({ ...geometry, x: result.right }), 20)
      close(result.left - geometry.scrollLeft, geometry.originX + 12 * geometry.pixelsPerBeat - geometry.scrollLeft)
      assert.deepEqual(region, { type, startBeat: 12, endBeat: 20, durationBeats: 8 })
    }
  })
}

test('divergent audio seconds and aliases cannot overwrite committed musical endpoints during rendering', () => {
  const region = Object.freeze({ type: 'audio', startBeat: 4, endBeat: 12, durationBeats: 99, timelineStartBeats: 900,
    visibleDurationSeconds: 90, sourceDurationSeconds: 80, stretch: Object.freeze({ targetDurationSeconds: 70 }) })
  assert.deepEqual(getRegionTimelineRange(region), { startBeat: 4, endBeat: 12, durationBeats: 8 })
  assert.equal(getTimelineRegionGeometry(region, { pixelsPerBeat: 25 }).width, 200)
})

test('missing legacy endpoints have a pure beat-domain fallback; subpixel widths are not clamped', () => {
  assert.deepEqual(getRegionTimelineRange({ timelineStartBeats: 0, durationBeats: 2 }), { startBeat: 0, endBeat: 2, durationBeats: 2 })
  close(getTimelineRegionGeometry({ startBeat: 0, endBeat: 0.01 }, { pixelsPerBeat: 5 }).width, 0.05)
})

// Execute the actual live DOM updater, rather than another copy of its formula.
// This catches the undefined trackTopAtIndex call that previously aborted zoom.
test('real live updater applies audio, MIDI and recording geometry with no missing lane dependency', () => {
  const source = fs.readFileSync(new URL('../src/studioProject.js', import.meta.url), 'utf8')
  const begin = source.indexOf('  const updateTimelineRegionGeometryDom = ')
  const end = source.indexOf('  const refreshVisibleAudioWaveformsDom', begin)
  const regions = [Object.freeze({ id: 'audio', type: 'audio', trackId: 'track', startBeat: 4, endBeat: 12 }),
    Object.freeze({ id: 'midi', type: 'midi', trackId: 'track', startBeat: 16, endBeat: 20, notes: [] })]
  const elements = [...regions.map(r => r.id), 'recording'].map(id => ({ dataset: { midiRegion: id },
    style: { setProperty(key, value) { this[key] = value } }, querySelectorAll: () => [] }))
  const context = vm.createContext({
    getRegionGeometrySnapshot: () => ({ pixelsPerBeat: 25, originX: 96, revision: 1 }),
    getTimelineRegionIndex: () => ({ byId: new Map(regions.map(r => [r.id, r])) }),
    app: { querySelectorAll: () => elements }, getTimelineRegionGeometry,
    getRegionLaneGeometry: () => getTimelineRegionLaneGeometry({ laneTop: 100, trackHeight: 96 }),
    activeRecording: { type: 'audio', startBeat: 4 }, timelineState: { playheadX: 12 }, xToBeat: x => x,
    beatWidth: () => 50, noteIsVisibleInRegion: () => true
  })
  vm.runInContext(source.slice(begin, end) + '\nupdateTimelineRegionGeometryDom({ pixelsPerBeat: 50, originX: 96, revision: 2 })', context)
  assert.equal(elements[0].style.left, '296px')
  assert.equal(elements[0].style.width, '400px')
  assert.equal(elements[1].style.left, '896px')
  assert.equal(elements[1].style.width, '200px')
  assert.equal(elements[2].style.width, '400px')
  for (const element of elements) {
    assert.equal(element.style.top, '101px')
    assert.equal(element.style.height, '94px')
    assert.equal(element.dataset.timelineGeometryRevision, '2')
  }
})
