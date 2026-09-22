function cleanUid(value = '') {
  return String(value || '').trim()
}

export function createPublicIdentityCache({
  positiveTtlMs = 5 * 60_000,
  missingTtlMs = 60_000,
  errorRetryMs = 5_000,
  now = () => Date.now(),
  onKnown = null,
  schedule = (callback, delay) => {
    const timer = globalThis.setTimeout?.(callback, delay)
    timer?.unref?.()
    return timer
  }
} = {}) {
  const entries = new Map()

  const snapshot = (entry) => entry
    ? { status: entry.status, identity: entry.identity || null, error: entry.error || null }
    : { status: 'unknown', identity: null, error: null }

  function peek(uid = '') {
    const key = cleanUid(uid)
    if (!key) return snapshot(null)
    const entry = entries.get(key)
    if (!entry) return snapshot(null)
    if ((entry.status === 'known' || entry.status === 'missing') && entry.expiresAt <= now()) {
      entries.delete(key)
      return snapshot(null)
    }
    return snapshot(entry)
  }

  function publish(uid = '', identity = null) {
    const key = cleanUid(uid)
    if (!key) return snapshot(null)
    const entry = identity
      ? { status: 'known', identity, error: null, expiresAt: now() + positiveTtlMs }
      : { status: 'missing', identity: null, error: null, expiresAt: now() + missingTtlMs }
    entries.set(key, entry)
    if (identity && typeof onKnown === 'function') onKnown(key, identity)
    return snapshot(entry)
  }

  async function load(uid = '', loader, { force = false } = {}) {
    const key = cleanUid(uid)
    if (!key || typeof loader !== 'function') return snapshot(null)
    const existing = entries.get(key)
    const currentTime = now()
    if (!force && existing) {
      if (existing.status === 'loading') return existing.promise
      if ((existing.status === 'known' || existing.status === 'missing') && existing.expiresAt > currentTime) return snapshot(existing)
      if (existing.status === 'error' && existing.retryAt > currentTime) return snapshot(existing)
    }

    const promise = Promise.resolve()
      .then(() => loader(key))
      .then((identity) => publish(key, identity || null))
      .catch((error) => {
        const entry = { status: 'error', identity: null, error, retryAt: now() + errorRetryMs }
        entries.set(key, entry)
        schedule?.(() => {
          if (entries.get(key) !== entry) return
          return load(key, loader, { force: true })
        }, errorRetryMs)
        return snapshot(entry)
      })
    entries.set(key, { status: 'loading', identity: existing?.identity || null, error: null, promise })
    return promise
  }

  return { peek, publish, load, clear: () => entries.clear() }
}
