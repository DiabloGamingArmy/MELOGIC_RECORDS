import { getDownloadURL, getStorage, ref } from 'firebase/storage'
import { app } from './firebaseConfig'
import { getCachedStorageUrl } from '../services/pageMediaCache'

const storage = getStorage(app)
const urlCache = new Map()

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
  if (urlCache.has(key)) return urlCache.get(key)
  const warnOnFail = options.warnOnFail !== false

  const promise = getCachedStorageUrl(key, async (storagePath) => {
    try {
      return await getDownloadURL(ref(storage, storagePath))
    } catch (error) {
      if (warnOnFail) devWarn('[storageAssets] Could not load public asset', { path: storagePath, code: error?.code })
      return ''
    }
  }, { scopeKey: options.scopeKey || 'global-storage-assets', type: options.type || 'asset' })

  urlCache.set(key, promise)
  return promise
}

export async function getStorageAssetCandidates(path, options = {}) {
  const key = String(path || '').trim()
  if (!key) return []
  const candidates = []
  const storageUrl = await getPublicStorageUrl(key, { warnOnFail: options.warnOnFail })
  if (storageUrl) candidates.push(storageUrl)
  if (options.localFallback !== false) {
    const local = options.localFallbackUrl || localAssetFallbackUrl(key)
    if (local) candidates.push(local)
  }
  return Array.from(new Set(candidates.filter(Boolean)))
}

export const getStorageAssetUrl = getPublicStorageUrl
