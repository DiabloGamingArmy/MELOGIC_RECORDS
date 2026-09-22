import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicIdentityCache } from '../src/data/publicIdentityCache.js'

test('transient identity failure retries and recovers verified state', async () => {
  let clock = 1_000
  let attempts = 0
  const scheduled = []
  const published = []
  const cache = createPublicIdentityCache({
    now: () => clock,
    errorRetryMs: 50,
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
    onKnown: (uid, identity) => published.push({ uid, identity })
  })
  const loader = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('temporary outage')
    return { uid: 'creator-1', badges: ['verified'] }
  }

  assert.equal((await cache.load('creator-1', loader)).status, 'error')
  assert.equal((await cache.load('creator-1', loader)).status, 'error')
  assert.equal(attempts, 1)

  clock += 51
  assert.equal(scheduled[0].delay, 50)
  await scheduled[0].callback()
  const recovered = cache.peek('creator-1')
  assert.equal(recovered.status, 'known')
  assert.deepEqual(recovered.identity.badges, ['verified'])
  assert.equal(attempts, 2)
  assert.equal(published.length, 1)
})

test('known, missing, loading, and error are distinct cache states', async () => {
  let resolveLoad
  const cache = createPublicIdentityCache()
  const pending = cache.load('creator-2', () => new Promise((resolve) => { resolveLoad = resolve }))
  assert.equal(cache.peek('creator-2').status, 'loading')
  await Promise.resolve()
  resolveLoad(null)
  assert.equal((await pending).status, 'missing')
  assert.equal(cache.peek('creator-2').status, 'missing')
  cache.publish('creator-2', { uid: 'creator-2', badges: [] })
  assert.equal(cache.peek('creator-2').status, 'known')
})
