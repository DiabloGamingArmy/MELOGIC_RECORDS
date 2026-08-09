'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { centralDirectoryEntries, eligibleVertixFile, extractEntry, inspectVertixArchive, validateGlb } = require('./vertixAssetArchives')

const db = admin.firestore()
const { FieldValue } = admin.firestore
const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 400)
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

async function hasEntitlement(uid, productId, product) {
  if (product.artistId === uid) return true
  const [entitlement, library] = await Promise.all([
    db.collection('users').doc(uid).collection('entitlements').doc(productId).get(),
    db.collection('users').doc(uid).collection('libraryItems').doc(productId).get()
  ])
  return [entitlement, library].some((snapshot) => snapshot.exists && (snapshot.data()?.status || 'active') === 'active')
}

const installMarketplaceVertixPack = onCall({ timeoutSeconds: 300, memory: '1GiB', cors: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const productId = String(request.data?.productId || '').trim()
  if (!productId || productId.includes('/')) throw new HttpsError('invalid-argument', 'productId is invalid.')
  const productRef = db.collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
  const product = productSnap.data() || {}
  if (!await hasEntitlement(uid, productId, product)) throw new HttpsError('permission-denied', 'A current product entitlement is required.')
  const files = (Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []).filter((file) => eligibleVertixFile(file)
    && String(file.storagePath || '').startsWith(`products/${productId}/`)
    && !String(file.storagePath || '').includes('..'))
  if (!files.length) throw new HttpsError('failed-precondition', 'This product has no verified creator-approved Vertix assets.')
  const versionKey = String(product.version || product.updatedAt?.toMillis?.() || product.updatedAt || '1')
  const installId = safeId(`${productId}:${hash(versionKey).slice(0, 16)}`)
  const installRef = db.collection('users').doc(uid).collection('vertixMarketplaceInstalls').doc(installId)
  const prior = await installRef.get()
  if (prior.exists && prior.data()?.status === 'installed') return { ok: true, alreadyInstalled: true, install: prior.data() }

  const bucket = admin.storage().bucket()
  const assets = []
  const failures = []
  for (const file of files) {
    try {
      const archiveFile = bucket.file(file.storagePath)
      const [metadata] = await archiveFile.getMetadata()
      if (Number(metadata.size || 0) > 512 * 1024 * 1024) throw new Error('ZIP exceeds the supported archive size.')
      const [archive] = await archiveFile.download()
      const validation = inspectVertixArchive(archive)
      if (!validation.compatible) throw new Error(validation.errors?.[0] || 'Archive is no longer compatible.')
      const directory = centralDirectoryEntries(archive)
      for (const entry of directory.entries.filter((candidate) => !candidate.isDirectory && validation.assetPaths.includes(candidate.name))) {
        try {
          const bytes = extractEntry(archive, entry)
          if (!validateGlb(bytes)) throw new Error('GLB validation failed during installation.')
          const contentHash = hash(bytes)
          const assetId = `marketplace:${hash(`${productId}|${file.id}|${entry.name}`).slice(0, 32)}`
          const versionId = `${assetId}:sha256:${contentHash}`
          const fileName = path.posix.basename(entry.name).replace(/[^a-zA-Z0-9._-]/g, '-') || 'asset.glb'
          const storageObjectId = `users/${uid}/vertix/assets/${safeId(assetId)}/${contentHash}/${fileName}`
          await bucket.file(storageObjectId).save(bytes, { resumable: false, contentType: 'model/gltf-binary', metadata: { metadata: { assetId, versionId, contentHash, sourceProductId: productId } } })
          assets.push({ assetId, versionId, contentHash, storageObjectId, fileName, archivePath: entry.name, sourceFileId: file.id, fileSize: bytes.length })
        } catch (error) { failures.push({ fileId: file.id, path: entry.name, reason: error.message || 'Asset import failed.' }) }
      }
    } catch (error) { failures.push({ fileId: file.id, path: '', reason: error.message || 'Pack import failed.' }) }
  }
  if (!assets.length) throw new HttpsError('failed-precondition', 'No Vertix assets could be installed.', { failures })

  const userRef = db.collection('users').doc(uid)
  const packFolderId = `vertix-marketplace:${productId}:${installId}`
  const folders = new Map([[packFolderId, { folderId: packFolderId, ownerId: uid, parentFolderId: 'vertix-marketplace', name: String(product.title || 'Marketplace Pack').slice(0, 160), kind: 'marketplace', sourceId: productId, readOnly: true }]])
  const folderForArchivePath = (archivePath) => {
    let parentFolderId = packFolderId
    let logicalPath = ''
    for (const segment of path.posix.dirname(archivePath).split('/').filter((value) => value && value !== '.')) {
      logicalPath = logicalPath ? `${logicalPath}/${segment}` : segment
      const folderId = `vertix-marketplace-folder:${hash(`${packFolderId}|${logicalPath}`).slice(0, 32)}`
      if (!folders.has(folderId)) folders.set(folderId, { folderId, ownerId: uid, parentFolderId, name: segment.slice(0, 160), kind: 'marketplace-directory', sourceId: productId, readOnly: true, archivePath: logicalPath })
      parentFolderId = folderId
    }
    return parentFolderId
  }
  const entryFolders = new Map(assets.map((asset) => [asset.assetId, folderForArchivePath(asset.archivePath)]))
  const writer = db.bulkWriter()
  for (const folder of folders.values()) writer.set(userRef.collection('vertixFolders').doc(safeId(folder.folderId)), { ...folder, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  for (const asset of assets) {
    writer.set(userRef.collection('vertixAssets').doc(safeId(asset.assetId)), {
      assetId: asset.assetId, ownerId: uid, displayName: asset.fileName.replace(/\.glb$/i, ''), fileName: asset.fileName, format: 'glb', mimeType: 'model/gltf-binary', sourceType: 'marketplace', sourceId: productId, sourceProductId: productId, sourcePackId: installId, sourcePackVersion: versionKey, publisherId: product.artistId || '', currentVersionId: asset.versionId, contentHash: asset.contentHash, storageObjectId: asset.storageObjectId, metadata: { archivePath: asset.archivePath, license: product.usageLicense || '', productTitle: product.title || '' }, technicalMetadata: {}, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    })
    writer.set(userRef.collection('vertixAssetVersions').doc(safeId(asset.versionId)), { versionId: asset.versionId, assetId: asset.assetId, storageObjectId: asset.storageObjectId, contentHash: asset.contentHash, fileSize: asset.fileSize, mimeType: 'model/gltf-binary', technicalMetadata: {}, createdAt: FieldValue.serverTimestamp() })
    const entryId = `entry:${hash(`${packFolderId}|${asset.assetId}`).slice(0, 32)}`
    writer.set(userRef.collection('vertixFolderEntries').doc(safeId(entryId)), { entryId, folderId: entryFolders.get(asset.assetId), assetId: asset.assetId, sourcePath: asset.archivePath, createdAt: FieldValue.serverTimestamp() })
  }
  const install = { installId, productId, productTitle: product.title || '', version: versionKey, publisherId: product.artistId || '', status: failures.length ? 'partial' : 'installed', folderId: packFolderId, assetIds: assets.map((asset) => asset.assetId), installedAssetCount: assets.length, failedAssetCount: failures.length, failures, updatedAt: FieldValue.serverTimestamp(), installedAt: FieldValue.serverTimestamp() }
  await writer.close()
  await installRef.set(install)
  return { ok: true, alreadyInstalled: false, install: { ...install, installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
})

module.exports = { installMarketplaceVertixPack }
