import { createBoundedRequestCache } from './boundedRequestCache.js'

const DEFAULT_SCOPE = 'page'
const SUCCESS_TTL_MS = 45 * 60_000
const MISSING_TTL_MS = 45_000
const TRANSIENT_TTL_MS = 750
const cache = createBoundedRequestCache({
  name: 'storage-url',
  maxEntries: 600,
  ttlMs: SUCCESS_TTL_MS,
  negativeTtlMs: MISSING_TTL_MS,
  errorTtlMs: TRANSIENT_TTL_MS
})

function normalizedScope(scopeKey = DEFAULT_SCOPE) {
  return String(scopeKey || DEFAULT_SCOPE).trim() || DEFAULT_SCOPE
}

function normalizedKey(path = '') {
  return String(path || '').trim()
}

function cacheKey(path, scopeKey = DEFAULT_SCOPE) {
  return `${normalizedScope(scopeKey)}:${normalizedKey(path)}`
}

function isMissingStorageError(error) {
  return String(error?.code || '').includes('storage/object-not-found')
}

export function rememberMissingStoragePath(path = '', { scopeKey = DEFAULT_SCOPE, type = 'storage' } = {}) {
  const key = normalizedKey(path)
  if (!key) return
  cache.set(cacheKey(key, scopeKey), '', { negative: true })
}

export const markMissingStoragePath = rememberMissingStoragePath

export async function getCachedStorageUrl(path = '', resolverFn, { scopeKey = DEFAULT_SCOPE, type = 'storage' } = {}) {
  const key = normalizedKey(path)
  if (!key || typeof resolverFn !== 'function') return ''
  try {
    const value = await cache.get(cacheKey(key, scopeKey), async () => {
      const resolvedUrl = await resolverFn(key)
      return String(resolvedUrl || '').trim()
    }, {
      isNegative: (value) => !value,
      classifyError: (error) => isMissingStorageError(error) ? 'missing' : 'transient'
    })
    return String(value || '')
  } catch {
    return ''
  }
}

export function getPageMediaCacheSnapshot(scopeKey = DEFAULT_SCOPE) {
  const prefix = `${normalizedScope(scopeKey)}:`
  return cache.snapshot()
    .filter((entry) => entry.key.startsWith(prefix))
    .map((entry) => ({
      path: entry.key.slice(prefix.length),
      resolvedAt: entry.createdAt || 0,
      status: entry.status === 'negative' ? 'missing' : entry.status,
      type: 'storage'
    }))
}

export function clearPageMediaCache(scopeKey = '') {
  if (scopeKey) {
    const prefix = `${normalizedScope(scopeKey)}:`
    cache.invalidateWhere((key) => key.startsWith(prefix))
    return
  }
  cache.clear()
}

export function clearAllPageMediaCache() {
  clearPageMediaCache()
}

export function invalidateCachedStoragePath(path = '', { scopeKey = '' } = {}) {
  const key = normalizedKey(path)
  if (!key) return
  if (scopeKey) {
    cache.invalidate(cacheKey(key, scopeKey))
    return
  }
  cache.invalidateWhere((candidate) => candidate.endsWith(`:${key}`))
}

globalThis.addEventListener?.('pagehide', () => cache.prune())
