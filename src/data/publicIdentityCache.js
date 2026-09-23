import { createBoundedRequestCache } from '../services/boundedRequestCache.js'

function cleanUid(value = '') {
  return String(value || '').trim()
}

export function createPublicIdentityCache({
  positiveTtlMs = 5 * 60_000,
  missingTtlMs = 30_000,
  errorRetryMs = 1_000,
  maxEntries = 500,
  now = () => Date.now(),
  onKnown = null,
  schedule = (callback, delay) => {
    const timer = globalThis.setTimeout?.(callback, delay)
    timer?.unref?.()
    return timer
  }
} = {}) {
  const cache = createBoundedRequestCache({
    name: 'public-identity',
    maxEntries,
    ttlMs: positiveTtlMs,
    negativeTtlMs: missingTtlMs,
    errorTtlMs: errorRetryMs,
    now
  })

  function snapshot(entry) {
    if (!entry) return { status: 'unknown', identity: null, error: null }
    if (entry.status === 'resolved') return { status: 'known', identity: entry.value || null, error: null }
    if (entry.status === 'negative') return { status: 'missing', identity: null, error: null }
    if (entry.status === 'pending') return { status: 'loading', identity: null, error: null }
    return { status: 'error', identity: null, error: entry.error || null }
  }

  function peek(uid = '') {
    const key = cleanUid(uid)
    return key ? snapshot(cache.peek(key)) : snapshot(null)
  }

  function publish(uid = '', identity = null) {
    const key = cleanUid(uid)
    if (!key) return snapshot(null)
    cache.set(key, identity || null, { negative: !identity })
    if (identity && typeof onKnown === 'function') onKnown(key, identity)
    return identity
      ? { status: 'known', identity, error: null }
      : { status: 'missing', identity: null, error: null }
  }

  async function load(uid = '', loader, { force = false } = {}) {
    const key = cleanUid(uid)
    if (!key || typeof loader !== 'function') return snapshot(null)
    try {
      const identity = await cache.get(key, async (requestedUid) => {
        const loaded = await loader(requestedUid)
        if (loaded && typeof onKnown === 'function') onKnown(key, loaded)
        return loaded
      }, { force, isNegative: (value) => !value })
      return identity
        ? { status: 'known', identity, error: null }
        : { status: 'missing', identity: null, error: null }
    } catch (error) {
      schedule?.(() => {
        const current = cache.peek(key)
        if (!current || current.status === 'error') return load(key, loader, { force: true })
        return snapshot(current)
      }, errorRetryMs)
      return { status: 'error', identity: null, error }
    }
  }

  return {
    peek,
    publish,
    load,
    invalidate: (uid = '') => cache.invalidate(cleanUid(uid)),
    clear: () => cache.clear()
  }
}
