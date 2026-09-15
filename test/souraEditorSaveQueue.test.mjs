import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorSaveQueue } from '../src/studio/model/editorSaveQueue.js'
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve } }
test('edits during a slow save are written after it, never concurrently or falsely saved', async () => {
  let value = 'first'; const writes = [], statuses = [], wait = deferred()
  const queue = createEditorSaveQueue({ delay: 100000, capture: () => value, onStatus: s => statuses.push(s), write: async snapshot => { writes.push(snapshot); if (writes.length === 1) await wait.promise } })
  queue.schedule(); const pending = queue.flush(); await Promise.resolve()
  value = 'latest'; queue.schedule(); const same = queue.flush()
  assert.equal(same, pending); assert.equal(queue.pending(), true); assert.deepEqual(writes, ['first'])
  wait.resolve(); await pending
  assert.deepEqual(writes, ['first', 'latest']); assert.equal(queue.pending(), false); assert.equal(statuses.at(-1), 'Saved')
})
test('flush cancels debounce and save errors retain dirty state for retry', async () => {
  let callback, cleared = false, fail = true
  const queue = createEditorSaveQueue({ capture: () => ({ id: 'p' }), write: async () => { if (fail) throw Error('offline') }, setTimer: fn => { callback = fn; return 1 }, clearTimer: () => cleared = true })
  queue.schedule(); assert.equal(typeof callback, 'function')
  await assert.rejects(queue.flush(), /offline/); assert.equal(cleared, true); assert.equal(queue.pending(), true)
  fail = false; await queue.flush(); assert.equal(queue.pending(), false)
})
