import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { section } from './helpers/souraPersistenceHarness.mjs'
test('unset persisted trim end means full source, not a nearly empty clip', () => {
  const app = vm.createContext({ minAudioRegionSeconds: .01, clamp: (v,a,b) => Math.min(b,Math.max(a,v)), beatsToSeconds: b => b / 2 })
  vm.runInContext(section('function getAudioFileDurationSeconds(', 'function getAudioStretchRatio('), app)
  for (const trimEndSeconds of [undefined, null]) {
    const region = JSON.parse(JSON.stringify({ type: 'audio', fileDurationSeconds: 12, trimStartSeconds: 2, trimEndSeconds }))
    assert.equal(app.getAudioTrimEndSeconds(region), 12)
    assert.equal(app.getAudioSourceDurationSeconds(region), 10)
  }
  assert.equal(app.getAudioTrimEndSeconds({ fileDurationSeconds: 12, trimStartSeconds: 2, trimEndSeconds: 8 }), 8)
})
