const DB_NAME = 'soura-asset-library-v1'
const STORE = 'assets'

export class WebAssetStorage {
  constructor({ indexedDB = globalThis.indexedDB, navigator = globalThis.navigator } = {}) {
    this.indexedDB = indexedDB
    this.navigator = navigator
    this.dbPromise = null
    this.memoryRows = new Map()
  }

  supportsOpfs() { return typeof this.navigator?.storage?.getDirectory === 'function' }
  open() {
    if (!this.indexedDB) return Promise.resolve(null)
    if (!this.dbPromise) this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.dbPromise
  }

  async listMetadata() {
    const db = await this.open()
    if (!db) return [...this.memoryRows.values()]
    return new Promise((resolve) => { const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => resolve([]) })
  }

  async putMetadata(record) {
    const db = await this.open()
    if (!db) { this.memoryRows.set(record.id, record); return true }
    return new Promise((resolve) => { const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record); request.onsuccess = () => resolve(true); request.onerror = () => resolve(false) })
  }

  async cacheBlob(assetId, blob) {
    if (!this.supportsOpfs()) return this.putMetadata({ id: assetId, blob, storage: 'indexeddb', updatedAt: new Date().toISOString() })
    const root = await this.navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle('soura-assets', { create: true })
    const file = await directory.getFileHandle(encodeURIComponent(assetId), { create: true })
    const writable = await file.createWritable()
    await writable.write(blob)
    await writable.close()
    return this.putMetadata({ id: assetId, opfsName: encodeURIComponent(assetId), storage: 'opfs', updatedAt: new Date().toISOString() })
  }

  async importFile(record, file) {
    let storage = 'indexeddb'
    let opfsName = ''
    let blob = file
    if (this.supportsOpfs()) {
      const root = await this.navigator.storage.getDirectory()
      const directory = await root.getDirectoryHandle('soura-assets', { create: true })
      opfsName = encodeURIComponent(record.id)
      const handle = await directory.getFileHandle(opfsName, { create: true })
      const writable = await handle.createWritable(); await writable.write(file); await writable.close()
      storage = 'opfs'; blob = undefined
    }
    await this.putMetadata({ ...record, storage, opfsName, blob, updatedAt: new Date().toISOString() })
    return { ...record, storage, opfsName }
  }

  async getBlob(record) {
    if (record?.storage === 'opfs' && record.opfsName && this.supportsOpfs()) {
      const root = await this.navigator.storage.getDirectory()
      const directory = await root.getDirectoryHandle('soura-assets')
      return (await directory.getFileHandle(record.opfsName)).getFile()
    }
    const db = await this.open()
    if (!db) return this.memoryRows.get(record.id)?.blob || null
    const row = await new Promise((resolve) => { const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(record.id); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null) })
    return row?.blob || null
  }
}
