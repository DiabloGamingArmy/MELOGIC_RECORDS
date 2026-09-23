import { markDevPerformance } from './devPerformance.js'

function normalizedKey(value) {
  return String(value ?? '').trim()
}

function isExpired(entry, now) {
  return entry?.status !== 'pending' && Number(entry?.expiresAt || 0) <= now
}

export function createBoundedRequestCache({
  maxEntries = 300,
  ttlMs = 5 * 60_000,
  negativeTtlMs = 30_000,
  errorTtlMs = 750,
  now = () => Date.now(),
  name = 'public-read'
} = {}) {
  const entries = new Map()
  const limit = Math.max(10, Number(maxEntries) || 300)

  function touch(key, entry) {
    entries.delete(key)
    entry.lastAccessedAt = now()
    entries.set(key, entry)
  }

  function prune() {
    const currentTime = now()
    for (const [key, entry] of entries) {
      if (isExpired(entry, currentTime)) entries.delete(key)
    }
    if (entries.size <= limit) return
    for (const [key, entry] of entries) {
      if (entries.size <= limit) break
      if (entry.status !== 'pending') entries.delete(key)
    }
  }

  function peek(rawKey) {
    const key = normalizedKey(rawKey)
    if (!key) return null
    const entry = entries.get(key)
    if (!entry) return null
    if (isExpired(entry, now())) {
      entries.delete(key)
      return null
    }
    touch(key, entry)
    return entry
  }

  async function get(rawKey, loader, {
    force = false,
    isNegative = (value) => value == null,
    classifyError = () => 'transient',
    positiveTtlMs = ttlMs,
    missingTtlMs = negativeTtlMs,
    transientTtlMs = errorTtlMs
  } = {}) {
    const key = normalizedKey(rawKey)
    if (!key || typeof loader !== 'function') return undefined
    const cached = force ? null : peek(key)
    if (cached?.status === 'pending') {
      markDevPerformance('cache-deduplicated', { cache: name })
      return cached.promise
    }
    if (cached?.status === 'resolved' || cached?.status === 'negative') {
      markDevPerformance('cache-hit', { cache: name, negative: cached.status === 'negative' })
      return cached.value
    }
    if (cached?.status === 'error') throw cached.error
    markDevPerformance('cache-miss', { cache: name })

    const startedAt = now()
    const promise = Promise.resolve()
      .then(() => loader(key))
      .then((value) => {
        const negative = Boolean(isNegative(value))
        const entry = {
          status: negative ? 'negative' : 'resolved',
          value,
          createdAt: startedAt,
          expiresAt: now() + (negative ? missingTtlMs : positiveTtlMs)
        }
        entries.set(key, entry)
        prune()
        return value
      })
      .catch((error) => {
        const missing = classifyError(error) === 'missing'
        const entry = missing
          ? { status: 'negative', value: undefined, error, createdAt: startedAt, expiresAt: now() + missingTtlMs }
          : { status: 'error', error, createdAt: startedAt, expiresAt: now() + transientTtlMs }
        entries.set(key, entry)
        prune()
        throw error
      })

    entries.set(key, { status: 'pending', promise, createdAt: startedAt, expiresAt: Infinity })
    prune()
    return promise
  }

  function set(rawKey, value, { negative = false, customTtlMs } = {}) {
    const key = normalizedKey(rawKey)
    if (!key) return value
    entries.set(key, {
      status: negative ? 'negative' : 'resolved',
      value,
      createdAt: now(),
      expiresAt: now() + (customTtlMs ?? (negative ? negativeTtlMs : ttlMs))
    })
    prune()
    return value
  }

  function invalidate(rawKey) {
    const key = normalizedKey(rawKey)
    return key ? entries.delete(key) : false
  }

  function invalidateWhere(predicate) {
    if (typeof predicate !== 'function') return
    for (const [key, entry] of entries) {
      if (predicate(key, entry)) entries.delete(key)
    }
  }

  function snapshot() {
    prune()
    return [...entries.entries()].map(([key, entry]) => ({
      key,
      status: entry.status,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt
    }))
  }

  return { name, get, peek, set, invalidate, invalidateWhere, clear: () => entries.clear(), prune, snapshot }
}
