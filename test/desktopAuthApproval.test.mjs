import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = (await readFile(new URL('../src/desktopAuth.js', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
async function fixture() {
  const elements = Object.fromEntries(['status', 'approve', 'cancel', 'identity', 'verification'].map(name => [name, { disabled: true, textContent: '', addEventListener(type, callback) { this.click = callback } }]))
  let resolve, reject, calls = 0
  const pending = new Promise((a, b) => { resolve = a; reject = b })
  const context = vm.createContext({ document: { querySelector: selector => elements[selector.slice(1)] }, location: { search: '?request=' + 'a'.repeat(64) }, URLSearchParams, functions: {}, waitForInitialAuthState: async () => ({ displayName: 'Synthetic fixture' }), httpsCallable: (_, name) => { assert.equal(name, 'approveDesktopLogin'); return data => { calls++; assert.equal(data.requestId, 'a'.repeat(64)); return pending } } })
  await vm.runInContext(`(async()=>{${source}\n})()`, context)
  return { elements, resolve, reject, calls: () => calls }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
test('approval waits for backend confirmation and duplicate click submits once', async () => {
  const f = await fixture(); f.elements.approve.click(); f.elements.approve.click()
  assert.match(f.elements.status.textContent, /Approving/); assert.equal(f.calls(), 1)
  assert.equal(f.elements.approve.disabled, true); assert.equal(f.elements.cancel.disabled, true)
  f.resolve({ data: { ok: true } }); await tick(); assert.match(f.elements.status.textContent, /^Approved/)
})
test('malformed approval never reports success', async () => {
  const f = await fixture(); f.elements.approve.click(); f.resolve({ data: {} }); await tick()
  assert.match(f.elements.status.textContent, /not confirmed/)
})
test('expired approval identifies a new login is required', async () => {
  const f = await fixture(); f.elements.approve.click(); f.reject({ code: 'functions/deadline-exceeded' }); await tick()
  assert.match(f.elements.status.textContent, /expired/)
})
test('cancellation waits for backend confirmation', async () => {
  const f = await fixture(); f.elements.cancel.click(); assert.match(f.elements.status.textContent, /Cancelling/)
  f.resolve({ data: { ok: true } }); await tick(); assert.match(f.elements.status.textContent, /Request cancelled/)
})
