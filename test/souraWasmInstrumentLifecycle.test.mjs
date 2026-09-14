import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const source = (await fs.readFile(new URL('../src/studio/instruments/SouraWasmInstrument.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export class SouraWasmInstrument', 'globalThis.Instrument = class SouraWasmInstrument')
const tick = () => new Promise(setImmediate)
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function setup({ packagePromise, modulePromise } = {}) {
  const nodes = [], timers = new Map(), warnings = []
  const context = vm.createContext({
    workletUrl: 'fixture-worklet', getPackageIdFromPluginType: () => 'fixture',
    getSouraPluginPackage: () => packagePromise || Promise.resolve({ manifest: { parameters: [] }, wasmBytes: new Uint8Array() }),
    console: { warn: (...args) => warnings.push(args) },
    setInterval: (fn) => { const id = timers.size + 1; timers.set(id, fn); return id },
    clearInterval: (id) => timers.delete(id),
    AudioWorkletNode: class {
      constructor() { this.sent = []; this.port = { postMessage: (data) => this.sent.push(data) }; this.connected = false; nodes.push(this) }
      connect() { this.connected = true }
      disconnect() { this.connected = false }
      receive(data) { this.port.onmessage({ data }) }
    }
  })
  vm.runInContext(source, context)
  const instrument = new context.Instrument({ id: 'test', type: 'fixture', audioContext: {
    state: 'running', currentTime: 1, destination: {}, audioWorklet: { addModule: () => modulePromise || Promise.resolve() }
  } })
  return { instrument, nodes, timers, warnings }
}
test('disposal during package or module loading cannot connect a late node', async () => {
  for (const atPackage of [true, false]) {
    const pending = deferred()
    const s = setup(atPackage ? { packagePromise: pending.promise } : { modulePromise: pending.promise })
    await tick()
    s.instrument.dispose()
    pending.resolve({ manifest: { parameters: [] }, wasmBytes: new Uint8Array() })
    await assert.rejects(s.instrument.readyPromise, /disposed/)
    assert.equal(s.nodes.length, 0)
    assert.equal(s.timers.size, 0)
  }
})
test('ready acknowledges the processor; failure diagnostics disconnect and stop polling', async () => {
  const s = setup()
  await tick()
  const node = s.nodes[0]
  assert.equal(s.timers.size, 0)
  node.receive({ type: 'ready' })
  await s.instrument.ensureRunning()
  assert.equal(s.timers.size, 1)
  s.timers.values().next().value()
  assert.equal(node.sent.at(-1).type, 'diagnostics')
  node.receive({ type: 'diagnostics', failure: 'processor-failed' })
  assert.equal(node.connected, false)
  assert.equal(node.sent.at(-1).type, 'dispose')
  assert.equal(s.timers.size, 0)
  await assert.rejects(s.instrument.ensureRunning(), /processor-failed/)
  s.instrument.dispose()
})
test('dispose while waiting for processor-ready settles initialization and releases node', async () => {
  const s = setup()
  await tick()
  const node = s.nodes[0]
  s.instrument.dispose()
  await assert.rejects(s.instrument.readyPromise, /disposed/)
  node.receive({ type: 'ready' })
  assert.equal(node.connected, false)
  assert.equal(s.timers.size, 0)
})
test('initialization failure is observable and does not leave a connected node', async () => {
  const s = setup()
  await tick()
  s.nodes[0].receive({ type: 'error', message: 'ABI mismatch' })
  await assert.rejects(s.instrument.readyPromise, /ABI mismatch/)
  assert.equal(s.nodes[0].connected, false)
  assert.equal(s.warnings.length, 1)
})
