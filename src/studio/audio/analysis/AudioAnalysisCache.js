import {
  ANALYSIS_DOMAIN_VERSIONS,
  AUDIO_ANALYSIS_CACHE_DB,
  AUDIO_ANALYSIS_CACHE_STORE,
  AUDIO_ANALYSIS_VERSION
} from './audioAnalysisConstants.js'

function safePart(value) {
  return encodeURIComponent(String(value ?? ''))
}

export function createAnalysisCacheKey(source = {}, profile = 'standard', versions = ANALYSIS_DOMAIN_VERSIONS) {
  const fingerprint = Object.entries(versions).map(([key, value]) => `${key}:${value}`).join('|')
  return [
    AUDIO_ANALYSIS_VERSION,
    safePart(source.id),
    safePart(source.revision || 'unknown'),
    Number(source.sampleRate) || 0,
    Number(source.channelCount) || 0,
    safePart(profile),
    safePart(fingerprint)
  ].join('::')
}

class IndexedDbAnalysisStore {
  constructor({ dbName = AUDIO_ANALYSIS_CACHE_DB, storeName = AUDIO_ANALYSIS_CACHE_STORE } = {}) {
    this.dbName = dbName
    this.storeName = storeName
    this.dbPromise = null
  }

  open() {
    if (this.dbPromise) return this.dbPromise
    if (!globalThis.indexedDB) return Promise.resolve(null)
    this.dbPromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(this.dbName, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('IndexedDB analysis cache could not be opened.'))
    }).catch(() => null)
    return this.dbPromise
  }

  async get(key) {
    const db = await this.open()
    if (!db) return null
    return new Promise((resolve) => {
      const request = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => resolve(null)
    })
  }

  async put(record) {
    const db = await this.open()
    if (!db) return false
    return new Promise((resolve) => {
      const request = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put(record)
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  }

  async delete(key) {
    const db = await this.open()
    if (!db) return false
    return new Promise((resolve) => {
      const request = db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).delete(key)
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    })
  }
}

export class MemoryAnalysisStore {
  constructor() { this.records = new Map() }
  async get(key) { return this.records.get(key) || null }
  async put(record) { this.records.set(record.key, record); return true }
  async delete(key) { return this.records.delete(key) }
}

export class AudioAnalysisCache {
  constructor({ store = new IndexedDbAnalysisStore(), memoryLimit = 12 } = {}) {
    this.store = store
    this.memoryLimit = memoryLimit
    this.memory = new Map()
  }

  keyFor(source, profile, versions = ANALYSIS_DOMAIN_VERSIONS) {
    return createAnalysisCacheKey(source, profile, versions)
  }

  remember(key, result) {
    this.memory.delete(key)
    this.memory.set(key, result)
    while (this.memory.size > this.memoryLimit) this.memory.delete(this.memory.keys().next().value)
  }

  async get(source, profile, versions = ANALYSIS_DOMAIN_VERSIONS) {
    const key = this.keyFor(source, profile, versions)
    const domainFingerprint = Object.entries(versions).map(([name, version]) => `${name}:${version}`).join('|')
    const memoryResult = this.memory.get(key)
    if (memoryResult) {
      this.remember(key, memoryResult)
      return { ...memoryResult, metadata: { ...memoryResult.metadata, cache: 'hit', analysisMs: 0 } }
    }
    const record = await this.store.get(key)
    if (!record || record.analysisVersion !== AUDIO_ANALYSIS_VERSION || record.domainFingerprint !== domainFingerprint) return null
    this.remember(key, record.result)
    return { ...record.result, metadata: { ...record.result.metadata, cache: 'hit', analysisMs: 0 } }
  }

  async put(source, profile, result, versions = ANALYSIS_DOMAIN_VERSIONS) {
    const key = this.keyFor(source, profile, versions)
    this.remember(key, result)
    return this.store.put({
      key,
      analysisVersion: AUDIO_ANALYSIS_VERSION,
      domainVersions: { ...versions },
      domainFingerprint: Object.entries(versions).map(([name, version]) => `${name}:${version}`).join('|'),
      source: { ...source },
      profile,
      storedAt: new Date().toISOString(),
      result
    })
  }

  async invalidate(source, profile = 'standard') {
    const key = this.keyFor(source, profile)
    this.memory.delete(key)
    return this.store.delete(key)
  }
}

export default AudioAnalysisCache
