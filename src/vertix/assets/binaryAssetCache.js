const DB_NAME = 'vertix-binary-cache'
const STORE_NAME = 'asset-versions'

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('INDEXEDDB_UNAVAILABLE')); return }
    const request = globalThis.indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('INDEXEDDB_OPEN_FAILED'))
  })
}

function transaction(mode, operation) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    let result
    try { result = operation(store) } catch (error) { db.close(); reject(error); return }
    tx.oncomplete = () => { db.close(); resolve(result?.result) }
    tx.onerror = () => { db.close(); reject(tx.error || new Error('INDEXEDDB_TRANSACTION_FAILED')) }
  }))
}

/** Disposable performance cache. Account/cloud storage remains authoritative. */
export function createVertixBinaryAssetCache() {
  return Object.freeze({
    get: async (assetId, versionId, contentHash = '') => {
      const key = `${assetId}@${versionId}`
      const record = await transaction('readonly', (store) => store.get(key)).catch(() => null)
      if (!record || (contentHash && record.contentHash !== contentHash)) return null
      return record.bytes || null
    },
    put: async (assetId, versionId, contentHash, bytes) => transaction('readwrite', (store) => store.put({ key: `${assetId}@${versionId}`, assetId, versionId, contentHash, bytes, cachedAt: Date.now() })),
    delete: async (assetId, versionId) => transaction('readwrite', (store) => store.delete(`${assetId}@${versionId}`)),
    clear: async () => transaction('readwrite', (store) => store.clear()),
    estimate: async () => globalThis.navigator?.storage?.estimate?.() || { usage: 0, quota: 0 }
  })
}
