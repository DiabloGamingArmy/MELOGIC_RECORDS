// Bounded mobile SPA view-state cache.
// melogic-mobile-spa-cache-v7b
//
// This cache is opt-in infrastructure for explicitly safe, serializable view
// snapshots. It does not automatically persist Firebase documents, auth state,
// messages, checkout data, media, credentials, or arbitrary application state.

const DB_NAME = 'melogic-mobile-spa'
const DB_VERSION = 1
const STORE_NAME = 'view-cache'
const MAX_AGE_MS = 15 * 60 * 1000
const MAX_ENTRIES = 24

function openDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'))
  }).catch(() => null)
}

function cacheKey(routeId, scope) {
  return `${String(scope || 'anon')}:${String(routeId || 'unknown')}`
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
  })
}

export async function readMobileSpaViewCache(routeId, { scope = 'anon', maxAgeMs = MAX_AGE_MS } = {}) {
  const db = await openDb()
  if (!db) return null
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(cacheKey(routeId, scope))
    const record = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
    if (!record) return null
    if (Date.now() - Number(record.updatedAt || 0) > maxAgeMs) return null
    return record.value ?? null
  } catch {
    return null
  } finally {
    db.close()
  }
}

export async function writeMobileSpaViewCache(routeId, value, { scope = 'anon' } = {}) {
  const db = await openDb()
  if (!db) return false
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.put({
      key: cacheKey(routeId, scope),
      routeId: String(routeId || ''),
      scope: String(scope || 'anon'),
      value,
      updatedAt: Date.now()
    })

    const allRequest = store.getAll()
    const records = await new Promise((resolve, reject) => {
      allRequest.onsuccess = () => resolve(Array.isArray(allRequest.result) ? allRequest.result : [])
      allRequest.onerror = () => reject(allRequest.error)
    })
    records
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(MAX_ENTRIES)
      .forEach(record => store.delete(record.key))

    await transactionDone(transaction)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

export async function clearMobileSpaViewCache({ scope } = {}) {
  const db = await openDb()
  if (!db) return false
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    if (!scope) {
      store.clear()
    } else {
      const request = store.getAllKeys()
      const keys = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
      })
      const prefix = `${String(scope)}:`
      keys.filter(key => String(key).startsWith(prefix)).forEach(key => store.delete(key))
    }
    await transactionDone(transaction)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}
