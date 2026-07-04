const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const db = admin.firestore()
const { FieldValue } = admin.firestore
const { normalizeProductFulfillment } = require('./productFulfillment')

const FILE_ROLES = new Set(['cover', 'thumbnail', 'gallery', 'previewAudio', 'previewVideo', 'deliverable', 'license'])
const MAX_FILE_ROWS = 500

function cleanString(value = '', max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function cleanLongString(value = '', max = 10000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function normalizeDocId(value = '') {
  const id = cleanString(value, 180)
  if (!id || id === '.' || id === '..' || id.includes('/')) {
    throw new HttpsError('invalid-argument', 'productId is required.')
  }
  return id
}

function normalizeFileId(value = '', fallback = '') {
  const id = cleanString(value || fallback, 160)
  if (!id || id === '.' || id === '..' || id.includes('/')) {
    throw new HttpsError('invalid-argument', 'File metadata contains an invalid file id.')
  }
  return id
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.round(parsed))
}

function normalizeKey(value = '') {
  return cleanString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeArray(value, limit = 50, maxItemLength = 160) {
  const rows = Array.isArray(value) ? value : String(value || '').split(',')
  return Array.from(new Set(rows.map((item) => cleanString(item, maxItemLength)).filter(Boolean))).slice(0, limit)
}

function normalizeKeyArray(value, limit = 50) {
  return normalizeArray(value, limit, 120).map(normalizeKey).filter(Boolean)
}

function normalizeProductPath(productId = '', value = '', { required = false, field = 'path' } = {}) {
  const raw = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim()
  if (!raw) {
    if (required) throw new HttpsError('invalid-argument', `${field} is required.`)
    return ''
  }
  if (raw.includes('../') || raw.includes('..\\') || raw.startsWith('users/') || /^https?:\/\//i.test(raw) || /^gs:\/\//i.test(raw)) {
    throw new HttpsError('invalid-argument', `${field} must be a product-scoped storage path.`)
  }
  if (!raw.startsWith(`products/${productId}/`)) {
    throw new HttpsError('invalid-argument', `${field} must start with products/${productId}/.`)
  }
  return raw.slice(0, 900)
}

function normalizeProductPathArray(productId = '', value, limit = 24, field = 'paths') {
  const rows = Array.isArray(value) ? value : String(value || '').split(',')
  return rows
    .map((item) => normalizeProductPath(productId, item, { field }))
    .filter(Boolean)
    .slice(0, limit)
}

function normalizePreviewAssignment(productId = '', value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    hoverEnabled: input.hoverEnabled !== false,
    hoverDelayMs: normalizeNumber(input.hoverDelayMs, 500),
    hoverVideoPath: normalizeProductPath(productId, input.hoverVideoPath || '', { field: 'previewAssignment.hoverVideoPath' }),
    hoverVideoURL: cleanString(input.hoverVideoURL || '', 1200),
    hoverAudioPath: normalizeProductPath(productId, input.hoverAudioPath || '', { field: 'previewAssignment.hoverAudioPath' }),
    hoverAudioURL: cleanString(input.hoverAudioURL || '', 1200),
    cardPreviewMode: ['none', 'audio', 'video', 'video-audio'].includes(input.cardPreviewMode) ? input.cardPreviewMode : 'audio',
    detailHeroPreviewPath: normalizeProductPath(productId, input.detailHeroPreviewPath || '', { field: 'previewAssignment.detailHeroPreviewPath' }),
    detailHeroPreviewType: ['audio', 'video', 'image', ''].includes(input.detailHeroPreviewType) ? input.detailHeroPreviewType : '',
    demoReelPath: normalizeProductPath(productId, input.demoReelPath || '', { field: 'previewAssignment.demoReelPath' }),
    demoReelType: ['audio', 'video', ''].includes(input.demoReelType) ? input.demoReelType : '',
    updatedAt: cleanString(input.updatedAt || new Date().toISOString(), 80)
  }
}

function roleCategory(role = '') {
  if (role === 'deliverable') return 'Deliverables'
  if (role === 'cover' || role === 'thumbnail' || role === 'gallery') return 'Listing Media'
  if (role === 'license') return 'License'
  return 'Preview Media'
}

function normalizeFileRow(productId = '', row = {}, index = 0) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new HttpsError('invalid-argument', 'File metadata rows must be objects.')
  }
  const role = FILE_ROLES.has(row.role) ? row.role : 'deliverable'
  const id = normalizeFileId(row.id, `file-${index}`)
  const storagePath = normalizeProductPath(productId, row.storagePath || row.path || row.filePath || '', {
    required: true,
    field: `files.${id}.storagePath`
  })
  const name = cleanString(row.name || row.displayPath || storagePath.split('/').pop() || id, 180)
  const contentType = cleanString(row.contentType || row.mimeType || 'application/octet-stream', 120)
  return {
    id,
    productId,
    name,
    displayPath: cleanString(row.displayPath || name, 260),
    parentPath: cleanString(row.parentPath || '', 260),
    storagePath,
    role,
    category: cleanString(row.category || roleCategory(role), 120),
    sizeBytes: normalizeNumber(row.sizeBytes, 0),
    contentType,
    extension: cleanString(row.extension || name.split('.').pop() || '', 24),
    type: cleanString(row.type || row.kind || contentType || 'file', 120),
    description: cleanString(row.description || '', 150),
    isDownloadable: row.isDownloadable !== false && role === 'deliverable',
    canPreview: row.canPreview === true || (role === 'deliverable' && contentType.startsWith('audio/')),
    isDeliverable: row.isDeliverable !== false && role === 'deliverable',
    isPublicPreview: row.isPublicPreview === true || ['previewAudio', 'previewVideo', 'gallery', 'cover', 'thumbnail'].includes(role),
    sortIndex: normalizeNumber(row.sortIndex, index)
  }
}

function normalizeDeliverableRow(productId = '', row = {}, index = 0) {
  const normalized = normalizeFileRow(productId, { ...row, role: 'deliverable' }, index)
  return {
    id: normalized.id,
    productId,
    name: normalized.name,
    displayPath: normalized.displayPath,
    storagePath: normalized.storagePath,
    sizeBytes: normalized.sizeBytes,
    contentType: normalized.contentType,
    extension: normalized.extension,
    type: normalized.type,
    category: 'Deliverables',
    role: 'deliverable',
    isDeliverable: true,
    isDownloadable: true,
    canPreview: normalized.canPreview,
    description: normalized.description,
    updatedAt: new Date().toISOString()
  }
}

function normalizeFileRows(productId = '', manifest = {}) {
  const source = Array.isArray(manifest.files)
    ? manifest.files
    : Array.isArray(manifest.fileMetadata)
      ? manifest.fileMetadata
      : Array.isArray(manifest.uploadedFiles)
        ? manifest.uploadedFiles
        : []
  return source.slice(0, MAX_FILE_ROWS).map((row, index) => normalizeFileRow(productId, row, index))
}

function normalizeDeliverableRows(productId = '', manifest = {}, fileRows = []) {
  const source = Array.isArray(manifest.deliverableFiles) && manifest.deliverableFiles.length
    ? manifest.deliverableFiles
    : fileRows.filter((row) => row.role === 'deliverable')
  return source.slice(0, MAX_FILE_ROWS).map((row, index) => normalizeDeliverableRow(productId, row, index))
}

function normalizeAssetSummary(manifest = {}, fileRows = [], deliverableRows = []) {
  const input = manifest.assetSummary && typeof manifest.assetSummary === 'object' && !Array.isArray(manifest.assetSummary)
    ? manifest.assetSummary
    : {}
  const totalBytesFromRows = fileRows.reduce((sum, row) => sum + normalizeNumber(row.sizeBytes, 0), 0)
  const downloadableCount = fileRows.length
    ? fileRows.filter((row) => row.isDownloadable).length
    : deliverableRows.length
  const previewableCount = fileRows.length ? fileRows.filter((row) => row.canPreview).length : 0
  return {
    totalFiles: fileRows.length || normalizeNumber(input.totalFiles, deliverableRows.length),
    totalBytes: totalBytesFromRows || normalizeNumber(input.totalBytes, 0),
    previewableCount: previewableCount || normalizeNumber(input.previewableCount, 0),
    downloadableCount: downloadableCount || normalizeNumber(input.downloadableCount, deliverableRows.length)
  }
}

function parentDiagnostics(productId = '', uid = '', product = null) {
  return {
    productId,
    uid,
    parentExists: Boolean(product),
    parentArtistId: product?.artistId || null,
    parentStatus: product?.status || null,
    parentVisibility: product?.visibility || null
  }
}

function logOperation(operationName = '', path = '', productId = '', uid = '', product = null, keys = []) {
  console.info('[saveProductManifest] operation start', {
    operationName,
    path,
    keys,
    ...parentDiagnostics(productId, uid, product)
  })
}

function wrapError(error, fallbackOperation = '', fallbackPath = '', productId = '', uid = '', product = null) {
  if (error instanceof HttpsError) {
    return new HttpsError(error.code, error.message, {
      operationName: fallbackOperation,
      path: fallbackPath,
      ...(error.details && typeof error.details === 'object' ? error.details : {}),
      ...parentDiagnostics(productId, uid, product)
    })
  }
  return new HttpsError('internal', 'Product manifest could not be saved.', {
    operationName: fallbackOperation,
    path: fallbackPath,
    code: error?.code || 'internal',
    message: error?.message || 'Unknown manifest save failure.',
    ...parentDiagnostics(productId, uid, product)
  })
}

exports.saveProductManifest = onCall(
  {
    timeoutSeconds: 60,
    memory: '256MiB',
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

    const productId = normalizeDocId(request.data?.productId || '')
    const manifest = request.data?.manifest && typeof request.data.manifest === 'object' && !Array.isArray(request.data.manifest)
      ? request.data.manifest
      : null
    if (!manifest) throw new HttpsError('invalid-argument', 'manifest is required.')

    const productRef = db.collection('products').doc(productId)
    let product = null
    let currentOperation = 'read-parent-product'
    let currentPath = `products/${productId}`

    try {
      logOperation(currentOperation, currentPath, productId, uid, product, [])
      const productSnap = await productRef.get()
      if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
      product = productSnap.data() || {}
      if (product.artistId !== uid) {
        throw new HttpsError('permission-denied', 'This product does not belong to the signed-in account.', {
          operationName: currentOperation,
          path: currentPath,
          ...parentDiagnostics(productId, uid, product)
        })
      }

      const fileRows = normalizeFileRows(productId, manifest)
      const deliverableRows = normalizeDeliverableRows(productId, manifest, fileRows)
      const deliverable = deliverableRows[0] || null
      const assetSummary = normalizeAssetSummary(manifest, fileRows, deliverableRows)
      const fulfillment = normalizeProductFulfillment({
        ...(product || {}),
        ...(manifest || {})
      })
      const productUpdate = {
        coverPath: normalizeProductPath(productId, manifest.coverPath || '', { field: 'coverPath' }),
        thumbnailPath: normalizeProductPath(productId, manifest.thumbnailPath || '', { field: 'thumbnailPath' }),
        galleryPaths: normalizeProductPathArray(productId, manifest.galleryPaths, 24, 'galleryPaths'),
        previewAudioPaths: normalizeProductPathArray(productId, manifest.previewAudioPaths, 12, 'previewAudioPaths'),
        previewVideoPaths: normalizeProductPathArray(productId, manifest.previewVideoPaths, 8, 'previewVideoPaths'),
        downloadPath: normalizeProductPath(productId, manifest.downloadPath || deliverable?.storagePath || '', { field: 'downloadPath' }),
        deliverableFiles: deliverableRows,
        licensePath: normalizeProductPath(productId, manifest.licensePath || '', { field: 'licensePath' }),
        usageLicense: cleanString(manifest.usageLicense || product.usageLicense || '', 120),
        usageLicenseVersion: normalizeNumber(manifest.usageLicenseVersion, product.usageLicenseVersion || 0),
        usageLicensePath: cleanString(manifest.usageLicensePath || product.usageLicensePath || '', 900),
        usageLicenseKey: cleanString(manifest.usageLicenseKey || product.usageLicenseKey || '', 80),
        assetSummary,
        primaryPreviewPath: normalizeProductPath(productId, manifest.primaryPreviewPath || '', { field: 'primaryPreviewPath' }),
        primaryPreviewType: cleanString(manifest.primaryPreviewType || '', 40),
        primaryPreviewDuration: normalizeNumber(manifest.primaryPreviewDuration, 0),
        primaryDownloadPath: normalizeProductPath(productId, manifest.primaryDownloadPath || manifest.downloadPath || deliverable?.storagePath || '', { field: 'primaryDownloadPath' }),
        primaryDownloadBytes: normalizeNumber(manifest.primaryDownloadBytes, deliverable?.sizeBytes || 0),
        previewAssignment: normalizePreviewAssignment(productId, manifest.previewAssignment || {}),
        marketplaceProductType: fulfillment.type,
        fulfillmentType: fulfillment.type,
        fulfillment,
        digital: fulfillment.digital,
        physical: fulfillment.physical,
        productKind: cleanString(manifest.productKind || product.productKind || '', 80),
        previewMode: cleanString(manifest.previewMode || product.previewMode || '', 80),
        distributionMode: cleanString(manifest.distributionMode || product.distributionMode || '', 80),
        formatKeys: normalizeKeyArray(manifest.formatKeys, 40),
        dawCompatibility: normalizeKeyArray(manifest.dawCompatibility, 40),
        compatibilityNotes: cleanLongString(manifest.compatibilityNotes || '', 5000),
        formatNotes: cleanLongString(manifest.formatNotes || '', 5000),
        includedFiles: cleanLongString(manifest.includedFiles || '', 10000),
        updatedAt: FieldValue.serverTimestamp()
      }

      if (product.status === 'published') {
        productUpdate.status = 'review_pending'
        productUpdate.visibility = product.visibility === 'public' ? 'unlisted' : (product.visibility || 'private')
        productUpdate.publishedAt = null
      }
      if (product.visibility === 'public') productUpdate.visibility = 'unlisted'
      if (productUpdate.visibility === 'public') productUpdate.visibility = 'unlisted'
      if (productUpdate.status === 'published') productUpdate.status = 'review_pending'

      const batch = db.batch()
      currentOperation = 'update-product-manifest'
      currentPath = `products/${productId}`
      logOperation(currentOperation, currentPath, productId, uid, product, Object.keys(productUpdate).sort())
      batch.set(productRef, productUpdate, { merge: true })

      fileRows.forEach((row) => {
        const fileRef = productRef.collection('files').doc(row.id)
        const filePayload = {
          ...row,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp()
        }
        logOperation('set-product-file-metadata', `products/${productId}/files/${row.id}`, productId, uid, product, Object.keys(filePayload).sort())
        batch.set(fileRef, filePayload, { merge: true })
      })

      currentOperation = 'commit-product-manifest-batch'
      currentPath = `products/${productId}`
      logOperation(currentOperation, currentPath, productId, uid, product, ['productUpdate', 'fileRows'])
      await batch.commit()

      return {
        ok: true,
        productId,
        manifestSaved: true,
        productUpdated: true,
        fileMetadataWritten: fileRows.length,
        updatedPaths: [
          `products/${productId}`,
          ...fileRows.map((row) => `products/${productId}/files/${row.id}`)
        ],
        manifest: {
          ...productUpdate,
          updatedAt: new Date().toISOString()
        }
      }
    } catch (error) {
      const wrapped = wrapError(error, currentOperation, currentPath, productId, uid, product)
      console.error('[saveProductManifest] operation failed', {
        operationName: wrapped.details?.operationName || currentOperation,
        path: wrapped.details?.path || currentPath,
        code: wrapped.code || error?.code || 'internal',
        message: wrapped.message,
        ...parentDiagnostics(productId, uid, product)
      })
      throw wrapped
    }
  }
)

exports.__test = {
  normalizeAssetSummary,
  normalizeProductPath,
  normalizeFileRow,
  normalizeDeliverableRow
}
