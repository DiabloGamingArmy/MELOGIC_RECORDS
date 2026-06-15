const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const db = admin.firestore()

const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000

function normalizeStoragePath(value = '') {
  const raw = String(value || '').trim()
  if (!raw || /^https?:\/\//i.test(raw) || /^gs:\/\//i.test(raw)) return ''
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
  if (!normalized || normalized.includes('..')) return ''
  return normalized
}

function isAllowedProductDownloadPath(productId = '', storagePath = '') {
  const path = normalizeStoragePath(storagePath)
  if (!productId || !path) return false
  return path.startsWith(`products/${productId}/downloads/`)
    || path.startsWith(`products/${productId}/files/`)
}

function fileNameFromPath(storagePath = '') {
  return normalizeStoragePath(storagePath).split('/').pop() || 'download'
}

function productOwnerUid(product = {}) {
  return String(
    product.artistId
      || product.ownerUid
      || product.creatorUid
      || product.sellerUid
      || product.createdBy
      || product.userId
      || product.authorUid
      || product.creator?.id
      || ''
  ).trim()
}

function classifyDownloadStorageError(error = {}) {
  const code = String(error?.code || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()
  if (code === '404' || code.includes('not-found') || message.includes('no such object')) return 'not-found'
  if (
    code === '403'
    || code.includes('permission')
    || message.includes('signblob')
    || message.includes('service account token creator')
    || message.includes('permission denied')
  ) return 'signing-permission'
  return 'storage-error'
}

function rowIsDownloadable(row = {}) {
  const roleText = [row.role, row.category, row.type, row.kind, row.purpose].join(' ').toLowerCase()
  return row.isDownloadable !== false
    && (
      row.isDeliverable === true
      || row.role === 'deliverable'
      || /\b(deliverable|deliverables|download|package)\b/.test(roleText)
    )
}

function addAllowedRow(rows, row = {}) {
  const storagePath = normalizeStoragePath(row.storagePath || row.path || row.filePath || '')
  if (!storagePath) return
  rows.push({
    id: String(row.id || ''),
    storagePath,
    fileName: String(row.name || row.displayPath || fileNameFromPath(storagePath)),
    role: String(row.role || ''),
    isPackage: row.isPackage === true || /\b(package|archive|bundle)\b/i.test([row.role, row.category, row.type, row.kind].join(' '))
  })
}

async function collectAllowedDownloadRows(productId = '', product = {}) {
  const rows = []
  ;[product.downloadPath, product.primaryDownloadPath].forEach((path) => {
    addAllowedRow(rows, { id: path, storagePath: path, name: fileNameFromPath(path) })
  })
  ;(Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []).forEach((row) => {
    if (rowIsDownloadable(row)) addAllowedRow(rows, row)
  })

  const filesSnap = await db.collection('products').doc(productId).collection('files').limit(500).get()
  filesSnap.docs.forEach((docSnap) => {
    const row = { id: docSnap.id, ...(docSnap.data() || {}) }
    if (rowIsDownloadable(row)) addAllowedRow(rows, row)
  })

  const seen = new Set()
  return rows.filter((row) => {
    if (!isAllowedProductDownloadPath(productId, row.storagePath)) return false
    const key = row.storagePath
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function selectAllowedDownload(rows = [], input = {}) {
  const fileId = String(input.fileId || '').trim()
  const requestedPath = normalizeStoragePath(input.filePath || input.storagePath || input.path || '')
  if (fileId) {
    const byId = rows.find((row) => row.id === fileId)
    if (byId) return byId
  }
  if (requestedPath) {
    const byPath = rows.find((row) => row.storagePath === requestedPath)
    if (byPath) return byPath
  }
  return rows.length === 1 ? rows[0] : null
}

async function userCanDownloadProduct(uid = '', productId = '', product = {}) {
  if (!uid || !productId) return false
  if (productOwnerUid(product) === uid) return true
  if (product.status !== 'published' || product.visibility !== 'public') return false
  const [entitlementSnap, librarySnap] = await Promise.all([
    db.doc(`users/${uid}/entitlements/${productId}`).get(),
    db.doc(`users/${uid}/libraryItems/${productId}`).get()
  ])
  const entitlement = entitlementSnap.exists ? entitlementSnap.data() || {} : null
  const library = librarySnap.exists ? librarySnap.data() || {} : null
  return [entitlement, library].some((row) => row && (row.status || 'active') === 'active')
}

exports.createProductDownloadUrl = onCall(
  {
    timeoutSeconds: 30,
    memory: '256MiB',
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to download this product.')

    const productId = String(request.data?.productId || '').trim()
    if (!productId) throw new HttpsError('invalid-argument', 'productId is required.')

    const productSnap = await db.collection('products').doc(productId).get()
    if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')

    const product = productSnap.data() || {}
    const canDownload = await userCanDownloadProduct(uid, productId, product)
    if (!canDownload) {
      throw new HttpsError('permission-denied', 'You do not have access to download this file.')
    }

    const allowedRows = await collectAllowedDownloadRows(productId, product)
    const selected = selectAllowedDownload(allowedRows, request.data || {})
    if (!selected) {
      throw new HttpsError('permission-denied', 'Requested file is not available for download.')
    }

    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_MS)
    const file = admin.storage().bucket().file(selected.storagePath)
    try {
      await file.getMetadata()
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: expiresAt,
        responseDisposition: `attachment; filename="${fileNameFromPath(selected.storagePath).replaceAll('"', '')}"`
      })
      return {
        url,
        expiresAt: expiresAt.toISOString(),
        fileName: selected.fileName || fileNameFromPath(selected.storagePath),
        storagePath: selected.storagePath
      }
    } catch (error) {
      const failure = classifyDownloadStorageError(error)
      if (failure === 'not-found') throw new HttpsError('not-found', 'Download file was not found.')
      if (failure === 'signing-permission') {
        throw new HttpsError('failed-precondition', 'Secure download signing is not configured for this service.')
      }
      throw new HttpsError('unavailable', 'Secure download links are temporarily unavailable.')
    }
  }
)

exports.__test = {
  normalizeStoragePath,
  isAllowedProductDownloadPath,
  rowIsDownloadable,
  selectAllowedDownload,
  collectAllowedDownloadRows,
  userCanDownloadProduct,
  fileNameFromPath,
  productOwnerUid,
  classifyDownloadStorageError
}
