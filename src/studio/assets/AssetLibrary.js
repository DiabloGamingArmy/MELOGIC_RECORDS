import { normalizeAssetList } from './assetModel.js'

export const ASSET_LIBRARY_ROOTS = Object.freeze([
  Object.freeze({ id: 'primitive', name: 'Primitives' }),
  Object.freeze({ id: 'marketplace', name: 'Marketplace' }),
  Object.freeze({ id: 'user', name: 'User' }),
  Object.freeze({ id: 'project', name: 'Projects' })
])

export function migrateLegacyAssetLibraryState(input = {}) {
  const state = input && typeof input === 'object' ? { ...input } : {}
  const panel = state.activePanel === 'loops' || state.activePanel === 'loop-browser' ? 'asset-library' : state.activePanel
  const selectedSourceId = state.selectedSourceId || (state.loopSource === 'marketplace' ? 'marketplace' : 'primitive')
  return { ...state, activePanel: panel, selectedSourceId, migratedFromLoopBrowser: panel !== state.activePanel }
}

export class AssetLibrary {
  constructor(providers = []) {
    this.providers = new Map()
    providers.forEach((provider) => this.registerProvider(provider))
    this.assets = new Map()
  }

  registerProvider(provider) {
    if (!provider?.id || typeof provider.listAssets !== 'function') throw new TypeError('Asset providers require an id and listAssets().')
    this.providers.set(provider.id, provider)
    return this
  }

  async refresh(context = {}) {
    const rows = await Promise.all([...this.providers.values()].map(async (provider) => {
      try { return await provider.listAssets(context) } catch (error) { return [{ id: `error:${provider.id}`, name: error?.message || `${provider.id} could not load`, kind: 'collection', sourceType: provider.sourceType || 'user', parentId: provider.sourceType || provider.id, metadata: { loadError: true } }] }
    }))
    this.assets = new Map(normalizeAssetList(rows.flat()).map((asset) => [asset.id, asset]))
    return this.listAll()
  }

  listAll() { return [...this.assets.values()] }
  getAsset(id) { return this.assets.get(String(id || '')) || null }
  listChildren(parentId, search = '') {
    const query = String(search || '').trim().toLowerCase()
    return this.listAll().filter((asset) => asset.parentId === parentId && (!query || asset.name.toLowerCase().includes(query) || String(asset.audio?.format || '').includes(query) || String(asset.metadata?.productTitle || '').toLowerCase().includes(query))).sort((a, b) => {
      const rank = { folder: 0, collection: 0, audio: 1 }
      return (rank[a.kind] - rank[b.kind]) || a.name.localeCompare(b.name)
    })
  }

  async resolveAsset(assetId, context = {}) {
    const asset = this.getAsset(assetId)
    if (!asset || asset.kind !== 'audio') throw new Error('Audio asset not found.')
    const provider = this.providers.get(asset.sourceType)
    if (!provider?.resolveAsset) throw new Error(`${asset.sourceType} assets cannot currently be resolved.`)
    return provider.resolveAsset(asset, context)
  }
}

