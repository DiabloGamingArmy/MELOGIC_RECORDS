import { getDownloadURL, getStorage, ref } from 'firebase/storage'
import { app } from './firebaseConfig'
import { getCachedStorageUrl, invalidateCachedStoragePath } from '../services/pageMediaCache'

const storage = getStorage(app)

function devWarn(...args) {
  if (typeof import.meta !== 'undefined' && import.meta?.env?.DEV) console.warn(...args)
}

export function localAssetFallbackUrl(path = '') {
  const key = String(path || '').trim().replace(/^\/+/, '')
  if (!key) return ''
  if (key.startsWith('assets/site/prod-icons/stage/')) return '/assets/site/prod-icons/stage/fallback.svg'
  return `/${key}`
}

export async function getPublicStorageUrl(path, options = {}) {
  const key = String(path || '').trim()
  if (!key) return ''
  const scopeKey = options.scopeKey || 'global-storage-assets'
  const warnOnFail = options.warnOnFail !== false

  return getCachedStorageUrl(key, async (storagePath) => {
    try {
      return await getDownloadURL(ref(storage, storagePath))
    } catch (error) {
      if (warnOnFail) devWarn('[storageAssets] Could not load public asset', { path: storagePath, code: error?.code })
      throw error
    }
  }, { scopeKey, type: options.type || 'asset' })
}

export function invalidateStorageAssetUrl(path = '', options = {}) {
  invalidateCachedStoragePath(path, { scopeKey: options.scopeKey || '' })
}

export async function getStorageAssetCandidates(path, options = {}) {
  const key = String(path || '').trim()
  if (!key) return []
  const candidates = []
  const storageUrl = await getPublicStorageUrl(key, { warnOnFail: options.warnOnFail, scopeKey: options.scopeKey, type: options.type })
  if (storageUrl) candidates.push(storageUrl)
  if (options.localFallback !== false) {
    const local = options.localFallbackUrl || localAssetFallbackUrl(key)
    if (local) candidates.push(local)
  }
  return Array.from(new Set(candidates.filter(Boolean)))
}

export const getStorageAssetUrl = getPublicStorageUrl
