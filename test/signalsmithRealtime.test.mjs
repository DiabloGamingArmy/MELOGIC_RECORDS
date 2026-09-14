import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'

const source = (await fs.readFile(new URL('../src/studio/audio/dsp/wasm/vendor/SignalsmithStretch.mjs', import.meta.url), 'utf8')).replace('export default _export;', '')
async function setup(rate = 48000) {
  let Processor, ready, allocations = 0, tracking = false
  const prepared = new Promise((resolve) => { ready = resolve })
  const messages = []
  const context = vm.createContext({
    sampleRate: rate, currentTime: 0, WebAssembly, crypto: webcrypto, atob, TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (data) => { messages.push(data); if (data[0] === 'ready') ready() } } } },
    registerProcessor: (_name, ctor) => { Processor = ctor },
    Float32Array: new Proxy(Float32Array, { construct(target, args) { if (tracking) allocations++; return Reflect.construct(target, args) } })
  })
  vm.runInContext(source, context)
  const p = new Processor({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
  await prepared
  p.port.onmessage({ data: [1, 'schedule', { active: true, outputTime: 0, output: 0, input: 0, semitones: 0, rate: 1 }] })
  const input = [new Float32Array(128), new Float32Array(128)]
  const output = [new Float32Array(128), new Float32Array(128)]
  return { p, input, output, context, messages, track: () => { tracking = true }, allocations: () => allocations }
}

test('actual embedded Signalsmith WASM reuses views after warmup at all project rates', async () => {
  for (const rate of [44100, 48000, 88200, 96000]) {
    const s = await setup(rate)
    let energy = 0
    for (let block = 0; block < 300; block++) {
      for (let frame = 0; frame < 128; frame++) {
        const value = Math.sin((block * 128 + frame) * 440 * Math.PI * 2 / rate) * .2
        s.input[0][frame] = value
        s.input[1][frame] = value
      }
      if (block === 10) s.track()
      s.context.currentTime = block * 128 / rate
      assert.equal(s.p.process([s.input], [s.output], {}), true)
      for (const value of s.output[0]) { assert.ok(Number.isFinite(value)); energy += value * value }
    }
    assert.ok(energy > 1, 'real WASM must produce audio after latency warmup')
    assert.equal(s.allocations(), 0, 'no per-block typed-array view allocation or WASM growth')
  }
})

test('automation selection does not shift or rebuild the callback graph', async () => {
  const s = await setup()
  const base = s.p.timeMap[0]
  s.p.timeMap = Array.from({ length: 2048 }, (_, i) => ({ ...base, output: i / 48000, semitones: 0 }))
  s.p.timeMap.shift = () => { throw new Error('shift reached callback') }
  s.context.currentTime = 1
  s.track()
  s.p.process([s.input], [s.output], {})
  assert.equal(s.p.timeMapIndex, 2047)
  assert.equal(s.p.timeMap.length, 2048)
  assert.equal(s.allocations(), 0)
  delete s.p.timeMap.shift
  s.p.port.onmessage({ data: [2, 'schedule', { active: true, outputTime: 2, output: 2 }] })
  assert.equal(s.p.timeMapIndex, 0)
})

test('unexpected output geometry fails explicitly instead of allocating a new DSP graph', async () => {
  const s = await setup()
  s.track()
  assert.throws(() => s.p.process([s.input], [[s.output[0]]], {}), /channels changed/)
  assert.equal(s.allocations(), 0)
})
