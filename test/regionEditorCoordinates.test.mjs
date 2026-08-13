import assert from 'node:assert/strict'
import test from 'node:test'
import {
  musicalDurationToRegionWidth,
  musicalPositionToRegionX,
  regionWidthToMusicalDuration,
  regionXToMusicalPosition,
  snapMusicalPosition
} from '../src/studio/regionEditorCoordinates.js'

const beatsPerBar = 4
const regionStartBeat = 6 * beatsPerBar
const pixelsPerBeat = 96
const positions = [
  regionStartBeat,
  regionStartBeat + 1,
  regionStartBeat + 2,
  regionStartBeat + 3,
  regionStartBeat + 4,
  regionStartBeat + 5,
  regionStartBeat + 8
]

test('Region Editor musical X mapping is invertible with a non-zero region start', () => {
  for (const projectBeat of positions) {
    const x = musicalPositionToRegionX(projectBeat, { regionStartBeat, pixelsPerBeat })
    const restored = regionXToMusicalPosition(x, { regionStartBeat, pixelsPerBeat })
    assert.ok(Math.abs(restored - projectBeat) < 1e-9)
  }
})

test('Region Editor mapping preserves bar and beat offsets after moving a region', () => {
  const movedStart = 10 * beatsPerBar
  for (const localBeat of [0, 1, 2, 3, 4, 5, 8]) {
    const projectBeat = movedStart + localBeat
    assert.equal(musicalPositionToRegionX(projectBeat, { regionStartBeat: movedStart, pixelsPerBeat }), localBeat * pixelsPerBeat)
  }
})

test('Region Editor duration conversion and musical snapping share beat units', () => {
  for (const duration of [0.125, 0.25, 1, 4, 8.5]) {
    const width = musicalDurationToRegionWidth(duration, pixelsPerBeat)
    assert.ok(Math.abs(regionWidthToMusicalDuration(width, pixelsPerBeat) - duration) < 1e-9)
  }
  assert.equal(snapMusicalPosition(regionStartBeat + 1.13, 0.25), regionStartBeat + 1.25)
})
