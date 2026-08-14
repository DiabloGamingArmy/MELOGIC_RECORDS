'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { centralDirectoryEntries, extractEntry } = require('./vertixAssetArchives')
const { eligibleSouraFile, inspectSouraArchive, validateAudioContainer, MIME_BY_FORMAT, souraEntitlementAllows } = require('./souraAssetArchives')

const db = admin.firestore()
const { FieldValue } = admin.firestore
const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 400)
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

async function hasSouraEntitlement(uid, productId, product) {
  const [entitlement, library] = await Promise.all([
    db.collection('users').doc(uid).collection('entitlements').doc(productId).get(),
    db.collection('users').doc(uid).collection('libraryItems').doc(productId).get()
  ])
  return souraEntitlementAllows({ uid, artistId: product.artistId, entitlementExists: entitlement.exists, entitlementStatus: entitlement.data()?.status, libraryExists: library.exists, libraryStatus: library.data()?.status })
}

const installMarketplaceSouraPack = onCall({ timeoutSeconds: 300, memory: '1GiB', cors: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const productId = String(request.data?.productId || '').trim()
  if (!productId || productId.includes('/')) throw new HttpsError('invalid-argument', 'productId is invalid.')
  const productRef = db.collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
  const product = productSnap.data() || {}
  if (!await hasSouraEntitlement(uid, productId, product)) throw new HttpsError('permission-denied', 'A current product entitlement is required.')
  const files = (Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []).filter((file) => eligibleSouraFile(file) && String(file.storagePath || '').startsWith(`products/${productId}/`) && !String(file.storagePath || '').includes('..'))
  if (!files.length) throw new HttpsError('failed-precondition', 'This product has no verified creator-approved Soura assets.')
  const versionKey = String(product.version || product.updatedAt?.toMillis?.() || product.updatedAt || '1')
  const installId = safeId(`${productId}:${hash(versionKey).slice(0, 16)}`)
  const installRef = db.collection('users').doc(uid).collection('souraMarketplaceInstalls').doc(installId)
  const prior = await installRef.get()
  if (prior.exists && ['installed', 'partial'].includes(prior.data()?.status)) return { ok: true, alreadyInstalled: true, install: prior.data() }
  const bucket = admin.storage().bucket()
  const assets = []
  const failures = []
  for (const file of files) {
    try {
      const [archive] = await bucket.file(file.storagePath).download()
      const validation = inspectSouraArchive(archive)
      if (!validation.compatible) throw new Error(validation.errors?.[0] || 'Archive is no longer compatible.')
      const directory = centralDirectoryEntries(archive, { maxArchiveBytes: 512 * 1024 * 1024, maxUncompressedBytes: 2 * 1024 * 1024 * 1024, maxEntries: 7500, maxEntryBytes: 512 * 1024 * 1024, maxCompressionRatio: 250 })
      for (const entry of directory.entries.filter((candidate) => !candidate.isDirectory && validation.assetPaths.includes(candidate.name))) {
        try {
          const bytes = extractEntry(archive, entry)
          const format = path.posix.extname(entry.name).slice(1).toLowerCase()
          if (!validateAudioContainer(bytes, format)) throw new Error('Audio validation failed during installation.')
          const contentHash = hash(bytes)
          const assetId = `marketplace:${hash(`${productId}|${file.id}|${entry.name}`).slice(0, 32)}`
          const fileName = path.posix.basename(entry.name).replace(/[^a-zA-Z0-9._-]/g, '-') || `audio.${format}`
          const storageObjectId = `users/${uid}/soura/assets/${safeId(assetId)}/${contentHash}/${fileName}`
          await bucket.file(storageObjectId).save(bytes, { resumable: false, contentType: MIME_BY_FORMAT[format] || 'application/octet-stream', metadata: { metadata: { assetId, contentHash, sourceProductId: productId } } })
          assets.push({ assetId, contentHash, storageObjectId, fileName, format, archivePath: entry.name, sourceFileId: file.id, fileSize: bytes.length })
        } catch (error) { failures.push({ fileId: file.id, path: entry.name, reason: error.message || 'Audio import failed.' }) }
      }
    } catch (error) { failures.push({ fileId: file.id, path: '', reason: error.message || 'Pack import failed.' }) }
  }
  if (!assets.length) throw new HttpsError('failed-precondition', 'No Soura assets could be installed.', { failures })
  const userRef = db.collection('users').doc(uid)
  const packFolderId = `soura-marketplace:${productId}:${installId}`
  const writer = db.bulkWriter()
  for (const asset of assets) writer.set(userRef.collection('souraAssets').doc(safeId(asset.assetId)), {
    assetId: asset.assetId, ownerId: uid, displayName: asset.fileName.replace(/\.[^.]+$/, ''), fileName: asset.fileName, format: asset.format, mimeType: MIME_BY_FORMAT[asset.format] || 'application/octet-stream', fileSize: asset.fileSize, sourceType: 'marketplace', sourceProductId: productId, sourceFileId: asset.sourceFileId, sourcePackId: installId, sourcePackVersion: versionKey, publisherId: product.artistId || '', contentHash: asset.contentHash, storageObjectId: asset.storageObjectId, metadata: { archivePath: asset.archivePath, license: product.usageLicense || '', productTitle: product.title || '' }, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  })
  const install = { installId, productId, productTitle: product.title || '', version: versionKey, publisherId: product.artistId || '', status: failures.length ? 'partial' : 'installed', folderId: packFolderId, assetIds: assets.map((asset) => asset.assetId), manifest: assets.map((asset) => ({ assetId: asset.assetId, archivePath: asset.archivePath, fileName: asset.fileName, format: asset.format, byteSize: asset.fileSize, contentHash: asset.contentHash, storagePath: asset.storageObjectId, sourceFileId: asset.sourceFileId })), installedAssetCount: assets.length, failedAssetCount: failures.length, failures, updatedAt: FieldValue.serverTimestamp(), installedAt: FieldValue.serverTimestamp() }
  await writer.close()
  await installRef.set(install)
  return { ok: true, alreadyInstalled: false, install: { ...install, installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
})

module.exports = { installMarketplaceSouraPack, hasSouraEntitlement }
