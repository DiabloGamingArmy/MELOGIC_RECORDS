const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { __test: downloadHelpers } = require('./createProductDownloadUrl')

const db = admin.firestore()
const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000

function cleanText(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function isAdmin(request = {}) {
  const token = request.auth?.token || {}
  return token.admin === true || token.adminRole === 'owner' || token.adminRole === 'admin'
}

async function acquisitionDetails(uid = '', productId = '') {
  const [entitlementSnap, librarySnap] = await Promise.all([
    db.doc(`users/${uid}/entitlements/${productId}`).get(),
    db.doc(`users/${uid}/libraryItems/${productId}`).get()
  ])
  const entitlement = entitlementSnap.exists ? entitlementSnap.data() || {} : null
  const library = librarySnap.exists ? librarySnap.data() || {} : null
  const row = [entitlement, library].find((item) => item && (item.status || 'active') === 'active') || null
  return {
    allowed: Boolean(row),
    source: cleanText(row?.source || row?.acquisitionType || 'library', 80),
    giftedBy: cleanText(row?.giftedBy || '', 180),
    giftId: cleanText(row?.giftId || '', 180)
  }
}

function licenseMarkdown({ productId = '', product = {}, user = {}, acquisition = {} } = {}) {
  const title = cleanText(product.title || 'Untitled product', 180)
  const creator = cleanText(product.artistName || product.artistDisplayName || product.artistId || 'Creator', 180)
  const buyer = cleanText(user.displayName || user.email || user.uid || 'Melogic member', 180)
  const overview = cleanText(product.shortDescription || product.description || product.productType || 'Digital marketplace content.', 1400)
  const license = cleanText(product.usageLicense || '', 4000)
  const source = cleanText(acquisition.source || 'owner', 80)
  const giftLine = acquisition.giftedBy ? `\nGifted by UID: ${acquisition.giftedBy}` : ''
  return `# Melogic Records Download License / Overview

Product: ${title}
Product ID: ${productId}
Creator / Seller: ${creator}
Downloaded by: ${buyer}
Buyer UID: ${user.uid}
Download date: ${new Date().toISOString()}
Acquisition source: ${source}${giftLine}

## Overview
${overview}

## License / Usage
${license || 'No creator-specific license was supplied. Usage is limited to the permissions granted by the creator listing and the Melogic marketplace terms.'}

## Important
This file is generated automatically by Melogic Records and should remain with the downloaded content.
`
}

async function signedRows(productId = '', product = {}) {
  const rows = await downloadHelpers.collectAllowedDownloadRows(productId, product)
  if (!rows.length) throw new HttpsError('failed-precondition', 'This product does not have a downloadable package.')
  const preferredPaths = [product.downloadPath]
    .map(downloadHelpers.normalizeStoragePath)
    .filter(Boolean)
  const preferredRows = rows.filter((row) => preferredPaths.includes(row.storagePath))
  const selectedRows = preferredRows.length ? preferredRows : rows.slice(0, 50)
  if (!preferredRows.length && rows.length > 50) {
    throw new HttpsError('failed-precondition', 'This product needs a packaged download before it can be downloaded.')
  }
  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_MS)
  const resolved = await Promise.all(selectedRows.map(async (row) => {
    const file = admin.storage().bucket().file(row.storagePath)
    try {
      const [metadata] = await file.getMetadata()
      const [downloadUrl] = await file.getSignedUrl({ action: 'read', expires: expiresAt })
      return {
        downloadUrl,
        fileName: row.fileName || downloadHelpers.fileNameFromPath(row.storagePath),
        sizeBytes: Number(metadata?.size || 0)
      }
    } catch (error) {
      if (error?.code === 404) return null
      throw new HttpsError('internal', 'Could not create the secure product download.')
    }
  }))
  const files = resolved.filter(Boolean)
  if (!files.length) throw new HttpsError('not-found', 'The product download files could not be found.')
  return { files, expiresAt }
}

const createProductDownloadLink = onCall(
  { timeoutSeconds: 60, memory: '512MiB', cors: true },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to download this product.')
    const productId = cleanText(request.data?.productId || '', 180)
    const source = cleanText(request.data?.source || 'product-detail', 40)
    if (!productId || productId.includes('/')) throw new HttpsError('invalid-argument', 'A valid productId is required.')

    const productRef = db.collection('products').doc(productId)
    const productSnap = await productRef.get()
    if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
    const product = productSnap.data() || {}
    if (['removed', 'deleted'].includes(product.status) || product.removedAt) {
      throw new HttpsError('failed-precondition', 'This product is no longer available for download.')
    }

    const ownerUid = cleanText(product.artistId || product.ownerUid || product.creatorUid || product.sellerUid || '', 180)
    const acquisition = ownerUid === uid
      ? { allowed: true, source: 'owner', giftedBy: '', giftId: '' }
      : await acquisitionDetails(uid, productId)
    if (!acquisition.allowed && !isAdmin(request)) {
      throw new HttpsError('permission-denied', 'You do not have access to download this product.')
    }
    if (!acquisition.allowed && isAdmin(request)) acquisition.source = 'admin'

    const { files, expiresAt } = await signedRows(productId, product)
    const sizeBytes = files.reduce((total, file) => total + Number(file.sizeBytes || 0), 0)
    let user
    try {
      user = await admin.auth().getUser(uid)
    } catch {
      user = { uid, displayName: '', email: '' }
    }
    const markdown = licenseMarkdown({ productId, product, user, acquisition })
    const eventRef = productRef.collection('downloads').doc()
    const batch = db.batch()
    batch.set(eventRef, {
      id: eventRef.id,
      productId,
      productTitle: cleanText(product.title || '', 180),
      userUid: uid,
      creatorUid: ownerUid,
      downloadedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: ['product-detail', 'library'].includes(source) ? source : 'product-detail',
      sizeBytes,
      fileCount: files.length,
      licenseIncluded: false,
      licenseProvidedSeparately: true,
      acquisitionSource: acquisition.source || 'library',
      giftId: acquisition.giftId || ''
    })
    batch.set(productRef, {
      downloadCount: admin.firestore.FieldValue.increment(1)
    }, { merge: true })
    await batch.commit()

    return {
      downloadUrl: files[0].downloadUrl,
      expiresAt: expiresAt.toISOString(),
      fileName: files.length === 1 ? files[0].fileName : `${cleanText(product.slug || product.title || 'melogic-product', 120)}-files`,
      sizeBytes,
      files,
      licenseFileIncluded: false,
      licenseFileProvidedSeparately: true,
      licenseFile: {
        fileName: 'MELOGIC_LICENSE_AND_OVERVIEW.md',
        content: markdown,
        contentType: 'text/markdown;charset=utf-8'
      }
    }
  }
)

module.exports = {
  createProductDownloadLink,
  __test: { licenseMarkdown }
}
