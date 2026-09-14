import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

const source = await fs.readFile(new URL('../src/studio/instruments/SouraWasmInstrumentProcessor.js', import.meta.url), 'utf8')
async function processor({ rate = 48000, delayed = false } = {}) {
  const events = [], messages = []
  let destroyed = 0, processed = 0, allocations = 0, tracking = false
  const memory = new WebAssembly.Memory({ initial: 1 })
  const exports = {
    memory,
    soura_create: (sampleRate, frames) => { assert.equal(sampleRate, rate); assert.equal(frames, 128) },
    soura_destroy: () => { destroyed += 1 },
    soura_note_on: (note, velocity) => { events.push(['on', note, velocity]) },
    soura_note_off: (note) => { events.push(['off', note]) },
    soura_set_parameter() {},
    soura_get_output_left_ptr: () => 0,
    soura_get_output_right_ptr: () => 512,
    soura_process: (frames) => {
      processed += 1
      const floats = new Float32Array(memory.buffer)
      for (let i = 0; i < frames; i++) { floats[i] = .25; floats[i + 128] = -.5 }
    }
  }
  let finishInstantiation
  const instantiation = new Promise((resolve) => { finishInstantiation = () => resolve({ instance: { exports } }) })
  let Processor
  const context = vm.createContext({
    sampleRate: rate, currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (message) => messages.push(message) } } },
    registerProcessor: (_name, ctor) => { Processor = ctor },
    WebAssembly: { instantiate: () => instantiation },
    Float32Array: new Proxy(Float32Array, { construct(target, args) { if (tracking) allocations++; return Reflect.construct(target, args) } })
  })
  vm.runInContext(source, context)
  const instance = new Processor({ processorOptions: { wasmBytes: new Uint8Array([0]) } })
  if (!delayed) { finishInstantiation(); await instance.ready }
  return { instance, exports, context, events, messages, memory, finishInstantiation,
    stats: () => ({ destroyed, processed, allocations }),
    track: () => { tracking = true } }
}
function render(p, frames = 128) {
  const output = [new Float32Array(frames), new Float32Array(frames)]
  const live = p.instance.process([], [output])
  return { output, live }
}

test('steady render reuses views and preserves stereo across device rates', async () => {
  for (const rate of [44100, 48000, 88200, 96000]) {
    const p = await processor({ rate })
    const left = p.instance.left
    p.track()
    for (let i = 0; i < 20; i++) {
      const { output } = render(p, i % 2 ? 64 : 128)
      assert.ok(output[0].every((v) => v === .25))
      assert.ok(output[1].every((v) => v === -.5))
    }
    assert.equal(p.instance.left, left)
    assert.equal(p.stats().allocations, 0)
  }
})

test('MIDI heap maintains timestamp and equal-time order with bounded draining', async () => {
  const p = await processor()
  // Descending input catches heap corruption; duplicate timestamps exercise stable order.
  for (let i = 2000; i >= 1; i--) p.instance.handleMessage({ type: i % 2 ? 'noteOn' : 'noteOff', note: i % 128, time: i / 1e9, velocity: .5 })
  p.track()
  render(p)
  assert.equal(p.events.length, 1024)
  assert.equal(p.instance.eventCount, 976)
  render(p)
  assert.equal(p.events.length, 2000)
  for (let i = 1; i <= 2000; i++) assert.equal(p.events[i-1][1], i % 128)
  p.instance.handleMessage({ type: 'noteOn', note: 60, time: 5 })
  p.instance.handleMessage({ type: 'noteOff', note: 60, time: 5 })
  render(p)
  assert.equal(p.instance.eventCount, 2)
  p.context.currentTime = 5
  render(p)
  assert.deepEqual(p.events.slice(-2).map((e) => e[0]), ['on', 'off'])
  assert.equal(p.stats().allocations, 0)
})

test('full MIDI queue stops observably instead of silently losing note-offs', async () => {
  const p = await processor()
  for (let i = 0; i < 4096; i++) p.instance.handleMessage({ type: 'noteOn', note: 60, time: 0 })
  p.instance.handleMessage({ type: 'noteOff', note: 60, time: 0 })
  assert.equal(p.instance.eventCount, 4096)
  assert.equal(p.instance.midiOverruns, 1)
  assert.equal(p.messages.at(-1).code, 'midi-overflow')
  assert.ok(render(p).output[0].every((v) => v === 0))
  assert.equal(p.stats().processed, 0)
})

test('dispose is terminal before or after initialization', async () => {
  for (const delayed of [false, true]) {
    const p = await processor({ delayed })
    p.instance.handleMessage({ type: 'dispose' })
    p.instance.handleMessage({ type: 'dispose' })
    if (delayed) { p.finishInstantiation(); await p.instance.ready }
    assert.equal(render(p).live, false)
    assert.equal(p.stats().processed, 0)
    assert.equal(p.stats().destroyed, delayed ? 0 : 1)
  }
})

test('WASM growth, oversized blocks and processing traps fail silent with diagnostics', async () => {
  for (const failure of ['grow', 'oversize', 'trap']) {
    const p = await processor()
    if (failure === 'grow') p.exports.soura_process = () => p.memory.grow(1)
    if (failure === 'trap') p.exports.soura_process = () => { throw new Error('fixture trap') }
    const { output } = render(p, failure === 'oversize' ? 256 : 128)
    assert.ok(output.every((channel) => channel.every((v) => v === 0)))
    p.instance.handleMessage({ type: 'diagnostics' })
    assert.ok(p.messages.at(-1).failure)
    assert.equal(p.messages.at(-1).processFailures, 1)
    render(p)
    assert.equal(p.instance.processFailures, 1)
  }
})

test('invalid output pointer fails during initialization instead of emitting NaN audio', async () => {
  const p = await processor({ delayed: true })
  p.exports.soura_get_output_left_ptr = () => NaN
  p.finishInstantiation()
  await p.instance.ready
  assert.equal(p.messages.at(-1).type, 'error')
  assert.match(p.messages.at(-1).message, /invalid output memory or pointers/)
  assert.ok(render(p).output[0].every((value) => value === 0))
  p.instance.handleMessage({ type: 'dispose' })
  assert.equal(p.stats().destroyed, 1)
})
