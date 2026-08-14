import assert from 'node:assert/strict'
import test from 'node:test'
import { amplitudeToDb, measureTimeDomainSamples, updateMeterBallistics } from '../src/studio/audio/audioMetering.js'

test('silence settles to the meter floor and active samples produce RMS/peak', () => {
  assert.equal(amplitudeToDb(0), -60)
  const measured = measureTimeDomainSamples(new Float32Array([0, 0.5, -0.5, 0]))
  assert.equal(measured.peak, 0.5)
  assert.ok(measured.rms > 0.35)
  let state = updateMeterBallistics({}, measured, 0)
  assert.ok(state.level > 0)
  for (let index = 0; index < 100; index += 1) state = updateMeterBallistics(state, { peak: 0, rms: 0 }, 1000 + index * 16)
  assert.equal(state.level, 0)
})

test('meter attack is faster than release and clipping latches', () => {
  const hot = updateMeterBallistics({}, { peak: 1, rms: 0.7 }, 0)
  const release = updateMeterBallistics(hot, { peak: 0, rms: 0 }, 16)
  assert.ok(hot.level > 0.5)
  assert.ok(release.level > 0.5)
  assert.equal(hot.clipped, true)
  assert.equal(release.clipped, true)
})

