'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { centralDirectoryEntries, extractEntry } = require('./vertixAssetArchives')
const { inspectSouraArchive, validateAudioContainer, MIME_BY_FORMAT, souraEntitlementAllows } = require('./souraAssetArchives')
const { normalizeMarketplaceProductId, inspectSouraDeliverables, sanitizedFailureReason, buildSouraInstallIdentity, classifySouraInstallState } = require('./souraMarketplaceInstall')

const db = admin.firestore()
const { FieldValue } = admin.firestore
const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 400)
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

function logRejection(operation, productId, code, details = {}) {
  console.warn('[installMarketplaceSouraPack] rejected', { operation, productId, code, ...details })
}

async function hasSouraEntitlement(uid, productId, product) {
  if (product.artistId === uid) return true
  const [entitlement, library] = await Promise.all([
    db.collection('users').doc(uid).collection('entitlements').doc(productId).get(),
    db.collection('users').doc(uid).collection('libraryItems').doc(productId).get()
  ])
  return souraEntitlementAllows({ uid, artistId: product.artistId, entitlementExists: entitlement.exists, entitlementStatus: entitlement.data()?.status, libraryExists: library.exists, libraryStatus: library.data()?.status })
}

async function installMarketplaceSouraPackHandler(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const productId = normalizeMarketplaceProductId(request.data?.productId)
  if (!productId) {
    const details = { operation: 'validate-request', expectedPayload: { productId: 'string' } }
    logRejection(details.operation, '', 'invalid-argument', details)
    throw new HttpsError('invalid-argument', 'productId is invalid.', details)
  }
  const productRef = db.collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) {
    const details = { operation: 'read-product', productId }
    logRejection(details.operation, productId, 'not-found')
    throw new HttpsError('not-found', 'Product not found.', details)
  }
  const product = productSnap.data() || {}
  if (!await hasSouraEntitlement(uid, productId, product)) {
    const details = { operation: 'verify-entitlement', productId }
    logRejection(details.operation, productId, 'permission-denied')
    throw new HttpsError('permission-denied', 'A current product entitlement is required.', details)
  }
  const deliverables = inspectSouraDeliverables(productId, product)
  const files = deliverables.files
  if (!files.length) {
    const details = {
      operation: 'validate-soura-capability',
      productId,
      productHasSouraAssets: product.hasSouraAssets === true,
      expectedProductPrefix: deliverables.expectedProductPrefix,
      deliverableCount: deliverables.diagnostics.length,
      deliverables: deliverables.diagnostics
    }
    logRejection(details.operation, productId, 'failed-precondition', details)
    throw new HttpsError('failed-precondition', 'This product has no verified creator-approved Soura assets.', details)
  }
  const identity = buildSouraInstallIdentity(productId, product, files)
  const { installId, declaredVersion: versionKey, sourceFingerprint } = identity
  const installCollection = db.collection('users').doc(uid).collection('souraMarketplaceInstalls')
  const installHistory = await installCollection.where('productId', '==', productId).get()
  const existingInstalls = installHistory.docs.map((snapshot) => ({ installId: snapshot.id, ...snapshot.data() }))
  const installState = classifySouraInstallState(existingInstalls, installId)
  const installRef = installCollection.doc(safeId(installId))
  const prior = installHistory.docs.find((snapshot) => snapshot.id === safeId(installId))
  if (installState === 'already-installed' && prior) return { ok: true, alreadyInstalled: true, installState, install: prior.data() }
  const bucket = admin.storage().bucket()
  const assets = []
  const failures = []
  for (const file of files) {
    try {
      const archiveFile = bucket.file(file.storagePath)
      const [metadata] = await archiveFile.getMetadata()
      if (Number(metadata.size || 0) > 512 * 1024 * 1024) throw new Error('ZIP exceeds the supported archive size.')
      const [archive] = await archiveFile.download()
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
        } catch (error) { failures.push({ fileId: file.id, path: entry.name, reason: sanitizedFailureReason(error, 'Audio import failed.') }) }
      }
    } catch (error) { failures.push({ fileId: file.id, path: '', reason: sanitizedFailureReason(error, 'Pack import failed.') }) }
  }
  if (!assets.length) {
    const details = { operation: 'extract-soura-assets', productId, attemptedFileIds: files.map((file) => String(file.id || '')), failures }
    logRejection(details.operation, productId, 'failed-precondition', { attemptedFileIds: details.attemptedFileIds, failures })
    throw new HttpsError('failed-precondition', 'No Soura assets could be installed.', details)
  }
  const userRef = db.collection('users').doc(uid)
  const packFolderId = `soura-marketplace:${productId}:${installId}`
  const writer = db.bulkWriter()
  for (const asset of assets) writer.set(userRef.collection('souraAssets').doc(safeId(asset.assetId)), {
    assetId: asset.assetId, ownerId: uid, displayName: asset.fileName.replace(/\.[^.]+$/, ''), fileName: asset.fileName, format: asset.format, mimeType: MIME_BY_FORMAT[asset.format] || 'application/octet-stream', fileSize: asset.fileSize, sourceType: 'marketplace', sourceProductId: productId, sourceFileId: asset.sourceFileId, sourcePackId: installId, sourcePackVersion: versionKey, publisherId: product.artistId || '', contentHash: asset.contentHash, storageObjectId: asset.storageObjectId, metadata: { archivePath: asset.archivePath, license: product.usageLicense || '', productTitle: product.title || '' }, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  })
  const install = { installId, productId, productTitle: product.title || '', version: versionKey, sourceFingerprint, publisherId: product.artistId || '', status: failures.length ? 'partial' : 'installed', folderId: packFolderId, assetIds: assets.map((asset) => asset.assetId), manifest: assets.map((asset) => ({ assetId: asset.assetId, archivePath: asset.archivePath, fileName: asset.fileName, format: asset.format, byteSize: asset.fileSize, contentHash: asset.contentHash, storagePath: asset.storageObjectId, sourceFileId: asset.sourceFileId })), installedAssetCount: assets.length, failedAssetCount: failures.length, failures, updatedAt: FieldValue.serverTimestamp(), installedAt: FieldValue.serverTimestamp() }
  for (const snapshot of installHistory.docs.filter((snapshot) => snapshot.id !== safeId(installId) && ['installed', 'partial'].includes(snapshot.data()?.status))) {
    writer.update(snapshot.ref, { status: 'superseded', supersededBy: safeId(installId), updatedAt: FieldValue.serverTimestamp() })
  }
  writer.set(installRef, install)
  await writer.close()
  return { ok: true, alreadyInstalled: false, installState, install: { ...install, installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
}

const installMarketplaceSouraPack = onCall({ timeoutSeconds: 300, memory: '1GiB', cors: true }, async (request) => {
  try {
    return await installMarketplaceSouraPackHandler(request)
  } catch (error) {
    if (error instanceof HttpsError) throw error
    const productId = normalizeMarketplaceProductId(request.data?.productId)
    console.error('[installMarketplaceSouraPack] unexpected failure', {
      operation: 'install-soura-pack',
      productId,
      code: String(error?.code || 'internal'),
      reason: sanitizedFailureReason(error, 'Unexpected Soura installation failure.')
    })
    throw new HttpsError('internal', 'The Soura pack could not be installed.', { operation: 'install-soura-pack', productId })
  }
})

module.exports = { installMarketplaceSouraPack, hasSouraEntitlement, installMarketplaceSouraPackHandler }
