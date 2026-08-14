import { normalizeAsset, stableAssetId } from '../assetModel.js'

export class UserProvider {
  constructor({ storage, nativeStorage } = {}) { this.id = 'user'; this.sourceType = 'user'; this.storage = storage; this.nativeStorage = nativeStorage }
  async listAssets() {
    const rows = await (this.nativeStorage || this.storage)?.listMetadata?.() || []
    return rows.filter((row) => row.kind === 'audio' || row.sourceType === 'user').map((row) => normalizeAsset({
      ...row,
      sourceType: 'user',
      parentId: row.parentId || 'user',
      source: { ...(row.source || {}), storage: row.storage, opfsName: row.opfsName }
    }))
  }
  async resolveAsset(asset) {
    if (this.nativeStorage && asset.source?.localPath) {
      const bytes = await this.nativeStorage.readBytes(asset.id)
      const blob = new Blob([new Uint8Array(bytes)], { type: asset.source.contentType || 'audio/*' })
      return { asset, file: new File([blob], asset.name, { type: blob.type }), fileName: asset.name, contentType: blob.type }
    }
    if (this.storage?.getBlob) {
      const blob = await this.storage.getBlob({ id: asset.id, ...asset.source })
      if (blob) return { asset, file: new File([blob], asset.name, { type: asset.source.contentType || blob.type || 'audio/*' }), fileName: asset.name, contentType: asset.source.contentType || blob.type }
    }
    if (asset.source?.objectUrl) return { asset, url: asset.source.objectUrl, fileName: asset.name, contentType: asset.source.contentType || 'audio/*' }
    if (asset.source?.storagePath) return { asset, storagePath: asset.source.storagePath, fileName: asset.name, contentType: asset.source.contentType || 'audio/*' }
    if (asset.source?.localPath) return { asset, localPath: asset.source.localPath, fileName: asset.name, contentType: asset.source.contentType || 'audio/*' }
    throw new Error('This user asset is not currently available.')
  }
  async importFile(file) {
    const id = stableAssetId('user-audio', `${file.name}|${file.size}|${file.lastModified}`)
    const record = normalizeAsset({ id, name: file.name, kind: 'audio', sourceType: 'user', parentId: 'user', audio: { byteSize: file.size, format: file.name.split('.').pop() }, source: { contentType: file.type, lastModified: file.lastModified } })
    if (this.nativeStorage) {
      const stored = await this.nativeStorage.importBytes({ assetId: id, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
      return normalizeAsset({ ...record, source: { ...record.source, localPath: stored.localPath } })
    }
    await this.storage.importFile(record, file)
    return record
  }
}
