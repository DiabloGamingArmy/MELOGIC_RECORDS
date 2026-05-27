import { getDownloadURL, getStorage, ref } from 'firebase/storage'
import { app } from './firebaseConfig'

const storage = getStorage(app)
const urlCache = new Map()

export async function getPublicStorageUrl(path) {
  const key = String(path || '').trim()
  if (!key) return ''
  if (urlCache.has(key)) return urlCache.get(key)

  const promise = getDownloadURL(ref(storage, key)).catch((error) => {
    console.warn('[storageAssets] Could not load public asset', { path: key, code: error?.code })
    return ''
  })

  urlCache.set(key, promise)
  return promise
}

export const getStorageAssetUrl = getPublicStorageUrl
