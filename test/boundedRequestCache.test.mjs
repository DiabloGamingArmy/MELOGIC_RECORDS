import assert from 'node:assert/strict'
import test from 'node:test'

import { createBoundedRequestCache } from '../src/services/boundedRequestCache.js'

test('deduplicates concurrent work and reuses the resolved value', async () => {
  let calls = 0
  const cache = createBoundedRequestCache()
  const reads = Array.from({ length: 10 }, () => cache.get('profile-1', async () => {
    calls += 1
    await Promise.resolve()
    return { uid: 'profile-1' }
  }))
  const values = await Promise.all(reads)
  assert.equal(calls, 1)
  assert.equal(values[9].uid, 'profile-1')
  assert.equal((await cache.get('profile-1', () => null)).uid, 'profile-1')
})

test('expires transient failures quickly and missing values on their own TTL', async () => {
  let time = 0
  const cache = createBoundedRequestCache({ now: () => time, errorTtlMs: 10, negativeTtlMs: 100 })
  await assert.rejects(cache.get('avatar', async () => { throw new Error('offline') }))
  await assert.rejects(cache.get('avatar', async () => 'unused'))
  time = 11
  assert.equal(await cache.get('avatar', async () => null), null)
  time = 50
  assert.equal(await cache.get('avatar', async () => 'unused'), null)
  time = 112
  assert.equal(await cache.get('avatar', async () => 'recovered'), 'recovered')
})

test('bounds resolved entries and supports explicit invalidation', async () => {
  const cache = createBoundedRequestCache({ maxEntries: 10 })
  for (let index = 0; index < 20; index += 1) await cache.get(`key-${index}`, async () => index)
  assert.ok(cache.snapshot().length <= 10)
  cache.invalidate('key-19')
  assert.equal(cache.peek('key-19'), null)
})
