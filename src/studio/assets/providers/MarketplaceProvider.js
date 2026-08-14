import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../firebase/firestore.js'
import { getStorageAssetUrl } from '../../../firebase/storageAssets.js'
import { buildArchiveHierarchy } from '../assetModel.js'

export class MarketplaceProvider {
  constructor({ database = db } = {}) { this.id = 'marketplace'; this.sourceType = 'marketplace'; this.database = database }
  async listAssets({ uid = '' } = {}) {
    if (!uid || !this.database) return []
    const [installs, assets] = await Promise.all([
      getDocs(collection(this.database, 'users', uid, 'souraMarketplaceInstalls')),
      getDocs(collection(this.database, 'users', uid, 'souraAssets'))
    ])
    const assetsByInstall = new Map()
    assets.docs.forEach((snapshot) => {
      const asset = { id: snapshot.id, ...snapshot.data() }
      const rows = assetsByInstall.get(asset.sourcePackId) || []
      rows.push({ ...asset, archivePath: asset.metadata?.archivePath, storagePath: asset.storageObjectId, byteSize: asset.fileSize, sourceFileId: asset.sourceFileId })
      assetsByInstall.set(asset.sourcePackId, rows)
    })
    return installs.docs.flatMap((snapshot) => {
      const install = { installId: snapshot.id, ...snapshot.data() }
      if (!['installed', 'partial'].includes(install.status)) return []
      return buildArchiveHierarchy({ sourceType: 'marketplace', rootId: install.folderId, rootName: install.productTitle, productId: install.productId, publisherId: install.publisherId, version: install.version, entries: assetsByInstall.get(install.installId) || [] })
    })
  }
  async resolveAsset(asset) {
    const storagePath = asset.source.storagePath
    if (!storagePath) throw new Error('Marketplace asset storage is unavailable.')
    const url = await getStorageAssetUrl(storagePath, { scopeKey: `soura-marketplace:${asset.source.productId}`, type: 'soura-marketplace-audio', warnOnFail: true })
    if (!url) throw new Error('Marketplace audio could not be resolved.')
    return { asset, url, storagePath, fileName: asset.name, contentType: `audio/${asset.audio?.format || '*'}` }
  }
}
