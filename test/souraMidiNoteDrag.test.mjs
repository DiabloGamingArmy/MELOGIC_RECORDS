import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('../src/studioProject.js', import.meta.url), 'utf8')
const handlers = source.slice(source.indexOf('function applyMidiNoteDrag('), source.indexOf('function beginPitchTraceNoteDrag('))
function gesture({ mode = 'move', zoom = 100, snap = false, start = 0, notes = [{ startBeat: 3, durationBeats: 1, note: 60 }] } = {}) {
  const region = { id: 'midi', startBeat: start, endBeat: start + 4, durationBeats: 4, notes: structuredClone(notes) }
  const before = structuredClone(region)
  const history = []
  let saves = 0
  const grid = zoom >= 512 ? 1 / 32 : zoom >= 320 ? 1 / 16 : zoom >= 180 ? 1 / 8 : 1 / 4
  const context = vm.createContext({
    midiRegions: [region], midiRollBeatWidth: zoom, midiRollRowHeight: 12, isSnapEnabled: snap,
    midiNoteDrag: { regionId: 'midi', noteIndex: 0, mode, originalRegionEndBeat: region.endBeat, before, startX: 0, startY: 0,
      noteSnapshots: notes.map((note, index) => ({ ...note, index, lastAuditionNote: note.note })), hasMoved: false },
    getMidiRollEditSnapValue: () => grid,
    regionWidthToMusicalDuration: (x, width) => x / width,
    snapBeat: (beat, step) => Math.round(beat / step) * step,
    snapBeatToRegionEditorGrid: beat => Math.round(beat / grid) * grid,
    midiRollPitchRows: () => Array.from({ length: 128 }, (_, i) => 127 - i),
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    auditionMidiRollNote() {}, refreshMidiRegionDom() {}, updateMidiRollNoteDom() {}, renderEditor() {},
    document: { body: { classList: { remove() {} } } },
    captureDawSnapshot: () => structuredClone(region),
    pushHistory: (label, before, after) => history.push({ label, before, after }),
    scheduleEditorSave: () => saves++
  })
  vm.runInContext(handlers, context)
  return { region, history, move: beats => context.applyMidiNoteDrag({ clientX: beats * zoom, clientY: 0 }),
    finish: () => context.finishMidiNoteDrag(), saves: () => saves }
}

test('moving and resizing beyond region end extends at all editor zoom levels', () => {
  for (const zoom of [64, 180, 320, 512]) for (const snap of [false, true]) for (const mode of ['move', 'right']) {
    const drag = gesture({ zoom, snap, mode })
    drag.move(2)
    assert.equal(drag.region.endBeat, 6)
    assert.equal(drag.region.durationBeats, 6)
    assert.equal(drag.region.notes[0].startBeat + drag.region.notes[0].durationBeats, 6)
  }
})

test('multi-note movement preserves spacing and extends to latest selected note', () => {
  const drag = gesture({ start: 8, notes: [{ startBeat: 9, durationBeats: .5, note: 60 }, { startBeat: 11, durationBeats: 1, note: 64 }] })
  drag.move(3)
  assert.deepEqual(drag.region.notes.map(n => n.startBeat), [12, 14])
  assert.equal(drag.region.endBeat, 15)
  assert.equal(drag.region.durationBeats, 7)
})

test('dragging back removes only growth from this gesture', () => {
  const drag = gesture()
  drag.move(3)
  drag.move(-1)
  assert.equal(drag.region.endBeat, 4)
  assert.equal(drag.region.notes[0].startBeat, 2)
})

test('left edge stays inside non-grid region start and resize keeps minimum length', () => {
  const drag = gesture({ snap: true, start: .1, notes: [{ startBeat: .1, durationBeats: 1, note: 60 }] })
  drag.move(-4)
  assert.equal(drag.region.notes[0].startBeat, .1)
  for (const mode of ['left', 'right']) {
    const resize = gesture({ mode })
    resize.move(mode === 'left' ? 10 : -10)
    assert.ok(resize.region.notes[0].durationBeats >= .05)
    assert.equal(resize.region.endBeat, 4)
  }
})

test('one history entry includes note and region growth for undo and redo', () => {
  const drag = gesture()
  drag.move(1)
  drag.move(2)
  drag.finish()
  assert.equal(drag.history.length, 1)
  assert.equal(drag.saves(), 1)
  const { before, after } = drag.history[0]
  Object.assign(drag.region, structuredClone(before))
  assert.equal(drag.region.endBeat, 4)
  assert.equal(drag.region.notes[0].startBeat, 3)
  Object.assign(drag.region, structuredClone(after))
  assert.equal(drag.region.endBeat, 6)
  assert.equal(drag.region.notes[0].startBeat, 5)
})

test('click without dragging creates no edit or save', () => {
  const drag = gesture()
  drag.move(.01)
  drag.finish()
  assert.equal(drag.history.length, 0)
  assert.equal(drag.saves(), 0)
  assert.equal(drag.region.endBeat, 4)
})
