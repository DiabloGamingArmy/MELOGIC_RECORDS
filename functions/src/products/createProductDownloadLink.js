const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const archiver = require('archiver')
const crypto = require('node:crypto')
const { __test: downloadHelpers } = require('./createProductDownloadUrl')

const db = admin.firestore()
const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000
const MAX_PACKAGE_SOURCE_BYTES = 1024 * 1024 * 1024
const MAX_PACKAGE_FILES = 500

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

function safePathSegment(value = '', fallback = 'download') {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
  return (cleaned || fallback).slice(0, 120)
}

function safeArchivePath(value = '', fallback = 'download') {
  const segments = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => safePathSegment(segment, 'file'))
  return (segments.length ? segments : [safePathSegment(fallback)]).join('/')
}

function licenseMarkdown({
  productId = '',
  product = {},
  user = {},
  acquisition = {},
  rows = [],
  packageFolder = ''
} = {}) {
  const title = cleanText(product.title || 'Untitled product', 180)
  const creator = cleanText(product.artistName || product.artistDisplayName || product.artistId || 'Creator', 180)
  const buyer = cleanText(user.displayName || user.email || user.uid || 'Melogic member', 180)
  const overview = cleanText(product.shortDescription || product.description || product.productType || 'Digital marketplace content.', 1400)
  const license = cleanText(product.usageLicense || '', 4000)
  const source = cleanText(acquisition.source || 'owner', 80)
  const giftLine = acquisition.giftedBy ? `\nGifted by UID: ${acquisition.giftedBy}` : ''
  const contents = rows.length
    ? rows.map((row) => `- ${packageFolder}/${safeArchivePath(row.archivePath, row.fileName)}`).join('\n')
    : '- No downloadable files were listed.'
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

## Package Contents
${contents}

## Important
This file is generated automatically by Melogic Records and should remain with the downloaded content.
`
}

function selectDownloadRows(rows = [], product = {}, maxRows = MAX_PACKAGE_FILES) {
  if (rows.length > maxRows) return []
  return rows.slice(0, maxRows)
}

async function resolvePackageRows(productId = '', product = {}) {
  const rows = await downloadHelpers.collectAllowedDownloadRows(productId, product)
  if (!rows.length) throw new HttpsError('failed-precondition', 'This product does not have a downloadable package.')
  const selectedRows = selectDownloadRows(rows, product)
  if (!selectedRows.length) {
    throw new HttpsError('resource-exhausted', 'This product contains too many files to package.')
  }
  const resolved = await Promise.all(selectedRows.map(async (row) => {
    const file = admin.storage().bucket().file(row.storagePath)
    try {
      const [metadata] = await file.getMetadata()
      return {
        ...row,
        fileName: row.fileName || downloadHelpers.fileNameFromPath(row.storagePath),
        sizeBytes: Number(metadata?.size || 0)
      }
    } catch (error) {
      const failure = downloadHelpers.classifyDownloadStorageError(error)
      logger.error('[product-download] secure link preparation failed', {
        productId,
        storagePath: row.storagePath,
        failure,
        errorCode: String(error?.code || ''),
        errorMessage: String(error?.message || '').slice(0, 500)
      })
      if (failure === 'not-found') {
        throw new HttpsError('not-found', 'A product file required for this package could not be found.')
      }
      throw new HttpsError('unavailable', 'Product files are temporarily unavailable.')
    }
  }))
  const files = resolved.filter(Boolean)
  if (!files.length) throw new HttpsError('not-found', 'The product download files could not be found.')
  const sizeBytes = files.reduce((total, file) => total + Number(file.sizeBytes || 0), 0)
  if (sizeBytes > MAX_PACKAGE_SOURCE_BYTES) {
    throw new HttpsError('resource-exhausted', 'This product is too large to package automatically.')
  }
  return { files, sizeBytes }
}

async function createZipPackage({
  productId = '',
  product = {},
  uid = '',
  user = {},
  acquisition = {},
  files = []
} = {}) {
  const bucket = admin.storage().bucket()
  const downloadId = crypto.randomUUID()
  const productFolder = safePathSegment(product.title || product.slug || 'Melogic Product', 'Melogic Product')
  const zipFileName = `${safePathSegment(product.title || product.slug || 'melogic-product', 'melogic-product')}-Melogic-Download.zip`
  const generatedPath = `generatedDownloads/${uid}/${productId}/${downloadId}/${zipFileName}`
  const generatedFile = bucket.file(generatedPath)
  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_MS)
  const markdown = licenseMarkdown({
    productId,
    product,
    user,
    acquisition,
    rows: files,
    packageFolder: productFolder
  })

  await new Promise((resolve, reject) => {
    const output = generatedFile.createWriteStream({
      resumable: false,
      metadata: {
        contentType: 'application/zip',
        contentDisposition: `attachment; filename="${zipFileName}"`,
        metadata: {
          generatedAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
          productId,
          uid,
          source: 'createProductDownloadLink'
        }
      }
    })
    const archive = archiver('zip', { zlib: { level: 6 } })
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    output.once('finish', () => finish())
    output.once('error', finish)
    archive.once('error', finish)
    archive.on('warning', (error) => {
      if (error?.code !== 'ENOENT') logger.warn('[product-download] archive warning', { productId, code: error?.code })
      else finish(error)
    })
    archive.pipe(output)
    archive.append(markdown, { name: 'MELOGIC_LICENSE_AND_OVERVIEW.md' })
    files.forEach((row) => {
      const archivePath = `${productFolder}/${safeArchivePath(row.archivePath, row.fileName)}`
      const source = bucket.file(row.storagePath).createReadStream()
      source.once('error', finish)
      archive.append(source, { name: archivePath })
    })
    archive.finalize().catch(finish)
  }).catch(async (error) => {
    await generatedFile.delete({ ignoreNotFound: true }).catch(() => {})
    throw error
  })

  try {
    const [metadata] = await generatedFile.getMetadata()
    const [downloadUrl] = await generatedFile.getSignedUrl({
      action: 'read',
      expires: expiresAt,
      responseDisposition: `attachment; filename="${zipFileName}"`
    })
    return {
      downloadUrl,
      expiresAt,
      fileName: zipFileName,
      generatedPath,
      generatedSizeBytes: Number(metadata?.size || 0)
    }
  } catch (error) {
    await generatedFile.delete({ ignoreNotFound: true }).catch(() => {})
    const failure = downloadHelpers.classifyDownloadStorageError(error)
    logger.error('[product-download] generated ZIP signing failed', {
      productId,
      generatedPath,
      failure,
      errorCode: String(error?.code || ''),
      errorMessage: String(error?.message || '').slice(0, 500)
    })
    if (failure === 'signing-permission') {
      throw new HttpsError(
        'failed-precondition',
        'Secure download signing is not configured. Contact support and try again later.'
      )
    }
    throw new HttpsError('unavailable', 'The product package was created, but its secure link is unavailable.')
  }
}

const createProductDownloadLink = onCall(
  { timeoutSeconds: 540, memory: '512MiB', cors: true },
  async (request) => {
    try {
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

      const ownerUid = cleanText(downloadHelpers.productOwnerUid(product), 180)
      const acquisition = ownerUid === uid
        ? { allowed: true, source: 'owner', giftedBy: '', giftId: '' }
        : await acquisitionDetails(uid, productId)
      if (!acquisition.allowed && !isAdmin(request)) {
        throw new HttpsError('permission-denied', 'You do not have access to download this product.')
      }
      if (!acquisition.allowed && isAdmin(request)) acquisition.source = 'admin'

      const { files, sizeBytes } = await resolvePackageRows(productId, product)
      let user
      try {
        user = await admin.auth().getUser(uid)
      } catch {
        user = { uid, displayName: '', email: '' }
      }
      const packageResult = await createZipPackage({
        productId,
        product,
        uid,
        user,
        acquisition,
        files
      })

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
        generatedZipBytes: packageResult.generatedSizeBytes,
        fileCount: files.length,
        licenseIncluded: true,
        generatedZipPath: packageResult.generatedPath,
        acquisitionSource: acquisition.source || 'library',
        giftId: acquisition.giftId || ''
      })
      batch.set(productRef, {
        downloadCount: admin.firestore.FieldValue.increment(1)
      }, { merge: true })
      try {
        await batch.commit()
      } catch (error) {
        logger.warn('[product-download] download prepared but analytics write failed', {
          productId,
          uid,
          errorCode: String(error?.code || ''),
          errorMessage: String(error?.message || '').slice(0, 500)
        })
      }

      return {
        downloadUrl: packageResult.downloadUrl,
        expiresAt: packageResult.expiresAt.toISOString(),
        fileName: packageResult.fileName,
        sizeBytes,
        packageSizeBytes: packageResult.generatedSizeBytes,
        fileCount: files.length,
        licenseFileIncluded: true
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      logger.error('[product-download] unexpected download preparation failure', {
        productId: cleanText(request.data?.productId || '', 180),
        uid: request.auth?.uid || '',
        errorCode: String(error?.code || ''),
        errorMessage: String(error?.message || '').slice(0, 500)
      })
      throw new HttpsError('unavailable', 'Could not create a secure download link. Please try again.')
    }
  }
)

module.exports = {
  createProductDownloadLink,
  __test: {
    licenseMarkdown,
    selectDownloadRows,
    safePathSegment,
    safeArchivePath,
    resolvePackageRows
  }
}
