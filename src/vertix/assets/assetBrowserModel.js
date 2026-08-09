const text = (value) => String(value ?? '').trim()
const lower = (value) => text(value).toLocaleLowerCase()
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))

export const DEFAULT_ASSET_BROWSER_QUERY = Object.freeze({
  search: '',
  category: 'all',
  type: 'all',
  source: 'all',
  publisher: 'all',
  tag: 'all'
})

export function normalizeAssetBrowserQuery(query = {}) {
  return {
    ...DEFAULT_ASSET_BROWSER_QUERY,
    ...query,
    search: text(query.search),
    category: text(query.category || 'all'),
    type: text(query.type || 'all'),
    source: text(query.source || 'all'),
    publisher: text(query.publisher || 'all'),
    tag: text(query.tag || 'all')
  }
}

export function assetBrowserSource(asset) {
  const provenance = asset?.provenance && typeof asset.provenance === 'object' ? asset.provenance : {}
  const packageId = text(provenance.packageId)
  const packageVersion = text(provenance.packageVersion)
  const isBuiltIn = provenance.source === 'built-in' || packageId.includes('.builtin-')
  return Object.freeze({
    key: isBuiltIn ? 'built-in' : `${packageId || 'local'}@${packageVersion || 'unversioned'}`,
    label: isBuiltIn ? 'Built-In' : packageId || 'Local provider',
    packageId,
    packageVersion,
    publisherId: text(provenance.publisherId),
    source: text(provenance.source) || (isBuiltIn ? 'built-in' : 'provider')
  })
}

function normalizedAsset(asset) {
  const source = assetBrowserSource(asset)
  const tags = Array.isArray(asset.tags) ? asset.tags.map(text).filter(Boolean) : []
  const searchable = [asset.label, asset.name, asset.type, asset.category, asset.layer, source.label, source.packageId, source.publisherId, ...tags]
    .map(lower)
    .filter(Boolean)
    .join(' ')
  return Object.freeze({ ...asset, tags: Object.freeze(tags), source, searchable })
}

/** Returns a small declarative catalogue; providers remain the source of truth. */
export function createAssetBrowserCatalog(registry) {
  if (!registry || typeof registry.listAssets !== 'function') throw new TypeError('An asset registry with listAssets() is required.')
  const assets = registry.listAssets().map(normalizedAsset)
  const sourceValues = new Map()
  assets.forEach((asset) => sourceValues.set(asset.source.key, asset.source))
  return Object.freeze({
    assets: Object.freeze(assets),
    categories: Object.freeze(uniqueSorted(assets.map((asset) => text(asset.category)))),
    types: Object.freeze(uniqueSorted(assets.map((asset) => text(asset.type)))),
    tags: Object.freeze(uniqueSorted(assets.flatMap((asset) => asset.tags))),
    publishers: Object.freeze(uniqueSorted(assets.map((asset) => asset.source.publisherId))),
    sources: Object.freeze([...sourceValues.values()].sort((a, b) => a.label.localeCompare(b.label) || a.packageVersion.localeCompare(b.packageVersion)))
  })
}

export function filterAssetBrowserAssets(catalog, query = {}) {
  const normalized = normalizeAssetBrowserQuery(query)
  const terms = lower(normalized.search).split(/\s+/).filter(Boolean)
  return catalog.assets.filter((asset) => {
    if (normalized.category !== 'all' && asset.category !== normalized.category) return false
    if (normalized.type !== 'all' && asset.type !== normalized.type) return false
    if (normalized.source !== 'all' && asset.source.key !== normalized.source) return false
    if (normalized.publisher !== 'all' && asset.source.publisherId !== normalized.publisher) return false
    if (normalized.tag !== 'all' && !asset.tags.includes(normalized.tag)) return false
    return terms.every((term) => asset.searchable.includes(term))
  })
}

export function selectedAssetBrowserAsset(catalog, assetId) {
  return catalog.assets.find((asset) => asset.id === assetId) || null
}
