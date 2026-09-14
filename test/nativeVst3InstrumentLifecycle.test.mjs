import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
let source = await fs.readFile(new URL('../src/studio/instruments/NativeVst3Instrument.js', import.meta.url), 'utf8')
source = source.replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*/g, '').replace('export class NativeVst3Instrument', 'globalThis.Instrument = class NativeVst3Instrument')
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(setImmediate)
function setup({ path, creation } = {}) {
  const calls = []
  const context = vm.createContext({
    resolveNativeVst3RuntimePath: () => path || Promise.resolve('/fixture.vst3'),
    ensureNativeVst3Host: () => { calls.push('create'); return creation || Promise.resolve({ ready: true }) },
    disposeNativeVst3Host: async () => { calls.push('dispose') },
    nativeVst3NoteOn: async () => { calls.push('on') },
    nativeVst3NoteOff: async () => { calls.push('off') },
    console
  })
  vm.runInContext(source, context)
  return { instrument: new context.Instrument({ id: 'fixture' }), calls }
}
test('dispose during native create waits for it and suppresses a late note', async () => {
  const creation = deferred()
  const { instrument, calls } = setup({ creation: creation.promise })
  const note = instrument.noteOn(60)
  await tick()
  assert.deepEqual(calls, ['create'])
  const disposed = instrument.dispose()
  assert.equal(instrument.dispose(), disposed)
  assert.deepEqual(calls, ['create'])
  creation.resolve({ ready: true })
  await Promise.all([note, disposed])
  assert.deepEqual(calls, ['create', 'dispose'])
})
test('dispose before native path resolution prevents creation', async () => {
  const path = deferred()
  const { instrument, calls } = setup({ path: path.promise })
  const ready = instrument.ensureRunning()
  const disposed = instrument.dispose()
  path.resolve('/fixture.vst3')
  await assert.rejects(ready, /disposed/)
  await disposed
  assert.deepEqual(calls, ['dispose'])
})
test('note-off waits for creation and is suppressed after disposal', async () => {
  const creation = deferred()
  const { instrument, calls } = setup({ creation: creation.promise })
  const ready = instrument.ensureRunning()
  await tick()
  const off = instrument.noteOff(60)
  const disposed = instrument.dispose()
  creation.resolve({ ready: true })
  await Promise.all([ready, off, disposed])
  assert.deepEqual(calls, ['create', 'dispose'])
})
