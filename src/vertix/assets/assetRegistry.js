function asArray(value) {
  return Array.isArray(value) ? value : []
}

function assetMatches(asset, filters = {}) {
  return Object.entries(filters).every(([key, expected]) => {
    if (expected === undefined || expected === null || expected === '' || (Array.isArray(expected) && expected.length === 0)) return true
    const actual = asset[key]
    if (key === 'tags') {
      const requiredTags = asArray(expected)
      return requiredTags.every((tag) => asArray(actual).includes(tag))
    }
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected
  })
}

function validateProvider(provider) {
  if (!provider?.id || typeof provider.listAssets !== 'function') {
    throw new TypeError('A Vertix asset provider needs an id and listAssets().')
  }
}

/**
 * Small, provider-neutral boundary for Vertix asset definitions. Providers are
 * local for now; a future package source only needs to implement this shape.
 */
export function createVertixAssetRegistry(initialProviders = []) {
  const providers = []
  const providerIds = new Set()

  function registerProvider(provider) {
    validateProvider(provider)
    if (providerIds.has(provider.id)) throw new Error(`Duplicate Vertix asset provider: ${provider.id}`)
    providers.push(provider)
    providerIds.add(provider.id)
    return provider
  }

  function allAssets() {
    const seenIds = new Set()
    return providers.flatMap((provider) => asArray(provider.listAssets()).map((asset) => {
      if (!asset?.id) throw new TypeError(`Vertix asset provider ${provider.id} returned an asset without an id.`)
      if (seenIds.has(asset.id)) throw new Error(`Duplicate Vertix asset id: ${asset.id}`)
      seenIds.add(asset.id)
      return asset
    }))
  }

  initialProviders.forEach(registerProvider)

  return Object.freeze({
    registerProvider,
    listProviders: () => [...providers],
    listAssets: (filters = {}) => allAssets().filter((asset) => assetMatches(asset, filters)),
    getAsset: (assetId) => allAssets().find((asset) => asset.id === assetId),
    listAssetGroups: () => {
      const knownAssetIds = new Set(allAssets().map((asset) => asset.id))
      return providers.flatMap((provider) => asArray(provider.listAssetGroups?.()).map((group) => ({
        ...group,
        providerId: provider.id,
        assetIds: asArray(group.assetIds).filter((assetId) => knownAssetIds.has(assetId))
      })))
    }
  })
}
