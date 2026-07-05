import { getStorageAssetUrl } from './storageAssets'

const siteAssetCache = new Map()

export async function getSiteAssetURL(path = '', options = {}) {
  const key = String(path || '').trim().replace(/^\/+/, '')
  if (!key) return ''
  const storagePath = key.startsWith('assets/site/') ? key : `assets/site/${key}`
  const cacheKey = `${options.scopeKey || 'site'}:${storagePath}`
  if (siteAssetCache.has(cacheKey)) return siteAssetCache.get(cacheKey)

  const promise = getStorageAssetUrl(storagePath, {
    scopeKey: options.scopeKey || 'site-assets',
    type: options.type || 'asset',
    warnOnFail: options.warnOnFail === true
  })
  siteAssetCache.set(cacheKey, promise)
  return promise
}
