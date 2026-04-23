import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from './storage.js'

const resolvedAssetCache = new Map()
const pendingAssetCache = new Map()
let hasWarnedNoStorage = false

export async function getStorageAssetUrl(path) {
  if (!path || !storage) {
    if (!hasWarnedNoStorage) {
      hasWarnedNoStorage = true
      console.warn('[storageAssets] Storage unavailable; asset URLs cannot be resolved.')
    }
    return null
  }

  if (resolvedAssetCache.has(path)) {
    return resolvedAssetCache.get(path)
  }

  if (pendingAssetCache.has(path)) {
    return pendingAssetCache.get(path)
  }

  const pending = getDownloadURL(ref(storage, path))
    .then((url) => {
      resolvedAssetCache.set(path, url)
      pendingAssetCache.delete(path)
      return url
    })
    .catch((error) => {
      pendingAssetCache.delete(path)
      console.warn(`[storageAssets] Failed to resolve asset: ${path}`, error?.message || error)
      return null
    })

  pendingAssetCache.set(path, pending)
  return pending
}
