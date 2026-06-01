const DEFAULT_SCOPE = 'page'
const cacheByScope = new Map()

function normalizedScope(scopeKey = DEFAULT_SCOPE) {
  return String(scopeKey || DEFAULT_SCOPE).trim() || DEFAULT_SCOPE
}

function normalizedKey(path = '') {
  return String(path || '').trim()
}

function scopeCache(scopeKey = DEFAULT_SCOPE) {
  const scope = normalizedScope(scopeKey)
  if (!cacheByScope.has(scope)) cacheByScope.set(scope, new Map())
  return cacheByScope.get(scope)
}

export function rememberMissingStoragePath(path = '', { scopeKey = DEFAULT_SCOPE, type = 'storage' } = {}) {
  const key = normalizedKey(path)
  if (!key) return
  scopeCache(scopeKey).set(key, {
    resolvedUrl: '',
    resolvedAt: Date.now(),
    type,
    status: 'missing'
  })
}

export const markMissingStoragePath = rememberMissingStoragePath

export async function getCachedStorageUrl(path = '', resolverFn, { scopeKey = DEFAULT_SCOPE, type = 'storage' } = {}) {
  const key = normalizedKey(path)
  if (!key || typeof resolverFn !== 'function') return ''
  const cache = scopeCache(scopeKey)
  const cached = cache.get(key)
  if (cached) {
    if (cached.status === 'resolved') return cached.resolvedUrl || ''
    if (cached.status === 'missing' || cached.status === 'failed') return ''
    if (cached.promise) return cached.promise
  }

  const promise = Promise.resolve()
    .then(() => resolverFn(key))
    .then((resolvedUrl) => {
      const value = String(resolvedUrl || '').trim()
      cache.set(key, {
        resolvedUrl: value,
        resolvedAt: Date.now(),
        type,
        status: value ? 'resolved' : 'missing'
      })
      return value
    })
    .catch((error) => {
      const code = String(error?.code || '')
      cache.set(key, {
        resolvedUrl: '',
        resolvedAt: Date.now(),
        type,
        status: code.includes('object-not-found') ? 'missing' : 'failed'
      })
      return ''
    })

  cache.set(key, {
    promise,
    resolvedUrl: '',
    resolvedAt: Date.now(),
    type,
    status: 'pending'
  })
  return promise
}

export function getPageMediaCacheSnapshot(scopeKey = DEFAULT_SCOPE) {
  const cache = scopeCache(scopeKey)
  return Array.from(cache.entries()).map(([path, entry]) => ({
    path,
    resolvedAt: entry.resolvedAt || 0,
    status: entry.status || 'unknown',
    type: entry.type || 'storage'
  }))
}

export function clearPageMediaCache(scopeKey = '') {
  if (scopeKey) {
    cacheByScope.delete(normalizedScope(scopeKey))
    return
  }
  cacheByScope.clear()
}

export function clearAllPageMediaCache() {
  clearPageMediaCache()
}

window.addEventListener?.('pagehide', () => clearPageMediaCache())
