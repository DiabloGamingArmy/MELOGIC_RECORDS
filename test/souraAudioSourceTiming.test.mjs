import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

// Execute the production source factory shared by live playback and export.
// WebAudio nodes record the schedule; no DOM/application boot is required.
const source = await fs.readFile(new URL('../src/studioProject.js', import.meta.url), 'utf8')
const factorySource = source.slice(source.indexOf('function scheduleProjectAudioSource('), source.indexOf('function updateAudioClipPlayback('))
function schedule({ rate = 1, deviceRate = 48000, sourceRate = 44100, elapsed = 0, delay = 0, fadeIn = 0, fadeOut = 2, rendered = false } = {}) {
  const events = []
  const buffer = { duration: 8, sampleRate: sourceRate, length: 8 * sourceRate }
  const node = { playbackRate: {}, connect() {}, start(...args) { this.started = args } }
  const gain = { connect() {}, gain: {
    setValueAtTime(value, at) { events.push({ type: 'value', value, at }) },
    setValueCurveAtTime(curve, at, duration) { events.push({ type: 'curve', curve, at, duration }) }
  } }
  const context = vm.createContext({
    getAudioRegionPlaybackRate: () => rate,
    getAudioTrimStartSeconds: () => 0,
    getAudioTrimEndSeconds: () => 8,
    dbToGain: () => 1,
    fadeGainValue: (p) => p,
    makeFadeGainCurve: (params) => params,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    logStretchDebug() {}
  })
  vm.runInContext(factorySource, context)
  const playbackRate = rendered ? 1 : rate
  context.scheduleProjectAudioSource({
    ctx: { sampleRate: deviceRate, createBufferSource: () => node, createGain: () => gain },
    region: {}, runtime: { audioBuffer: buffer },
    edit: { gainDb: 0, delayMs: delay * 1000, fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut },
    stretch: {}, playbackChoice: { mode: rendered ? 'pitchShift' : 'original' },
    channel: { input: {} }, scheduleTime: 10, elapsedVisibleSeconds: elapsed, visibleDurationSeconds: 8 / playbackRate
  })
  return { node, events, playbackRate }
}

test('source duration and envelope duration stay in their own time domains', () => {
  for (const rate of [.5, 1, 2, 4]) {
    for (const deviceRate of [44100, 48000, 88200, 96000]) {
      for (const sourceRate of [44100, 48000, 88200, 96000]) {
        const { node, events } = schedule({ rate, deviceRate, sourceRate, delay: .25 })
        assert.deepEqual(node.started, [10.25, 0, 8])
        const fade = events.find((event) => event.type === 'curve' && event.curve.direction === 'out')
        assert.ok(fade, 'fade-out must be scheduled even when it covers the entire clip')
        assert.equal(fade.at + fade.duration, 10.25 + 8 / rate)
        assert.ok(events.every((event) => event.at >= 10.25), 'envelope must not precede delayed audio')
      }
    }
  }
})

test('seeking inside a fade preserves its original project position and progress', () => {
  for (const rate of [.5, 1, 2]) {
    const elapsed = 8 / rate - 1
    const { node, events } = schedule({ rate, elapsed, fadeOut: 2 })
    assert.equal(node.started[1], elapsed * rate)
    assert.equal(node.started[2] / rate, 1)
    const fade = events.find((event) => event.type === 'curve')
    assert.equal(fade.curve.fromProgress, .5)
    assert.equal(fade.at, 10)
    assert.equal(fade.duration, 1)
  }
})

test('seek during fade-in retains authored length instead of shrinking to remaining source', () => {
  const { events } = schedule({ rate: .5, elapsed: 5, fadeIn: 6, fadeOut: 0 })
  const fade = events.find((event) => event.type === 'curve')
  assert.equal(fade.curve.fromProgress, 5 / 6)
  assert.ok(Math.abs(fade.duration - 1) < 1e-9)
})

test('rendered media keeps unit playback rate and the same envelope semantics', () => {
  const { node, events } = schedule({ rate: 2, rendered: true, fadeOut: 2 })
  assert.equal(node.playbackRate.value, 1)
  assert.deepEqual(node.started, [10, 0, 8])
  const fade = events.find((event) => event.type === 'curve')
  assert.equal(fade.at, 16)
  assert.equal(fade.duration, 2)
})
