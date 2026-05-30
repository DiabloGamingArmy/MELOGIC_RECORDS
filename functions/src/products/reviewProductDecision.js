const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const STAFF_ROLES = new Set(['admin', 'staff', 'moderator', 'marketplace_admin', 'marketplace_reviewer'])
const DECISIONS = new Set(['approve', 'request_changes', 'reject', 'keep_pending'])
const REVIEW_STATUSES = new Set(['review_pending', 'pending_ai_review'])
const REVIEW_JOB_STATUSES = new Set(['pending_manual_review', 'ai_failed', 'failed_ai_auth'])
const REVIEW_MODERATION_STATUSES = new Set(['pending', 'ai_error'])

function db() {
  return admin.firestore()
}

function cleanString(value = '', max = 1200) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function normalizeProductId(value = '') {
  const productId = cleanString(value, 180)
  if (!productId || productId === '.' || productId === '..' || productId.includes('/')) {
    throw new HttpsError('invalid-argument', 'productId is required.')
  }
  return productId
}

function normalizeDecision(value = '') {
  const decision = cleanString(value, 40)
  if (!DECISIONS.has(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be approve, request_changes, reject, or keep_pending.')
  }
  return decision
}

function toMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function serializeDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function tokenHasStaffRole(token = {}) {
  if (token.admin === true || token.staff === true || token.moderator === true || token.marketplaceAdmin === true || token.marketplaceReviewer === true) {
    return true
  }
  const scalarRoles = [token.role, token.accountType, token.userRole]
  if (scalarRoles.some((role) => STAFF_ROLES.has(cleanString(role, 80).toLowerCase()))) return true
  const arrayRoles = [
    ...(Array.isArray(token.roles) ? token.roles : []),
    ...(Array.isArray(token.permissions) ? token.permissions : [])
  ]
  return arrayRoles.some((role) => STAFF_ROLES.has(cleanString(role, 80).toLowerCase()))
}

async function serverStaffDocExists(uid = '') {
  if (!uid) return false
  const [adminSnap, staffSnap] = await Promise.all([
    db().collection('adminUsers').doc(uid).get(),
    db().collection('staffUsers').doc(uid).get()
  ])
  return (adminSnap.exists && adminSnap.data()?.active !== false) ||
    (staffSnap.exists && staffSnap.data()?.active !== false)
}

async function requireStaff(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const token = request.auth?.token || {}
  if (tokenHasStaffRole(token) || await serverStaffDocExists(uid)) {
    return {
      uid,
      email: cleanString(token.email || '', 320),
      role: token.admin ? 'admin' : token.staff ? 'staff' : token.marketplaceReviewer ? 'marketplace_reviewer' : 'staff'
    }
  }
  throw new HttpsError('permission-denied', 'Marketplace review requires an admin or staff account.')
}

function productIsInReviewQueue(product = {}) {
  return REVIEW_STATUSES.has(cleanString(product.status, 80)) ||
    REVIEW_JOB_STATUSES.has(cleanString(product.reviewJobStatus, 80)) ||
    REVIEW_MODERATION_STATUSES.has(cleanString(product.moderationStatus, 80))
}

function sanitizeProductForQueue(id = '', product = {}) {
  const assetSummary = product.assetSummary && typeof product.assetSummary === 'object' && !Array.isArray(product.assetSummary)
    ? product.assetSummary
    : {}
  const previewAssignment = product.previewAssignment && typeof product.previewAssignment === 'object' && !Array.isArray(product.previewAssignment)
    ? product.previewAssignment
    : {}
  const deliverableFiles = Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []
  return {
    id,
    slug: cleanString(product.slug || '', 180),
    title: cleanString(product.title || 'Untitled product', 180),
    artistId: cleanString(product.artistId || '', 180),
    artistName: cleanString(product.artistDisplayName || product.artistName || 'Creator', 180),
    productType: cleanString(product.productType || 'Product', 120),
    productKind: cleanString(product.productKind || '', 120),
    priceCents: Math.max(0, Math.round(Number(product.priceCents || 0))),
    payoutTargetCents: Math.max(0, Math.round(Number(product.payoutTargetCents || 0))),
    currency: cleanString(product.currency || 'USD', 12),
    isFree: Boolean(product.isFree),
    status: cleanString(product.status || '', 80),
    visibility: cleanString(product.visibility || '', 80),
    moderationAIModel: cleanString(product.moderationAIModel || '', 120),
    moderationAISucceeded: Boolean(product.moderationAISucceeded),
    moderationStatus: cleanString(product.moderationStatus || '', 80),
    moderationRiskLevel: cleanString(product.moderationRiskLevel || '', 80),
    moderationSummary: cleanString(product.moderationSummary || '', 1200),
    moderationReasons: Array.isArray(product.moderationReasons) ? product.moderationReasons.map((item) => cleanString(item, 220)).filter(Boolean).slice(0, 20) : [],
    reviewJobStatus: cleanString(product.reviewJobStatus || '', 120),
    reviewRequestedAt: serializeDate(product.reviewRequestedAt),
    createdAt: serializeDate(product.createdAt),
    updatedAt: serializeDate(product.updatedAt),
    coverPath: cleanString(product.coverPath || '', 900),
    thumbnailPath: cleanString(product.thumbnailPath || '', 900),
    downloadPath: cleanString(product.downloadPath || '', 900),
    primaryDownloadPath: cleanString(product.primaryDownloadPath || product.downloadPath || '', 900),
    primaryDownloadBytes: Math.max(0, Math.round(Number(product.primaryDownloadBytes || 0))),
    galleryPaths: Array.isArray(product.galleryPaths) ? product.galleryPaths.map((item) => cleanString(item, 900)).filter(Boolean).slice(0, 24) : [],
    previewAudioPaths: Array.isArray(product.previewAudioPaths) ? product.previewAudioPaths.map((item) => cleanString(item, 900)).filter(Boolean).slice(0, 12) : [],
    previewVideoPaths: Array.isArray(product.previewVideoPaths) ? product.previewVideoPaths.map((item) => cleanString(item, 900)).filter(Boolean).slice(0, 8) : [],
    previewAssignment: {
      cardPreviewMode: cleanString(previewAssignment.cardPreviewMode || '', 80),
      hoverAudioPath: cleanString(previewAssignment.hoverAudioPath || '', 900),
      hoverVideoPath: cleanString(previewAssignment.hoverVideoPath || '', 900),
      demoReelPath: cleanString(previewAssignment.demoReelPath || '', 900),
      detailHeroPreviewPath: cleanString(previewAssignment.detailHeroPreviewPath || '', 900)
    },
    assetSummary: {
      downloadableCount: Math.max(0, Math.round(Number(assetSummary.downloadableCount || 0))),
      previewableCount: Math.max(0, Math.round(Number(assetSummary.previewableCount || 0))),
      totalBytes: Math.max(0, Math.round(Number(assetSummary.totalBytes || 0))),
      totalFiles: Math.max(0, Math.round(Number(assetSummary.totalFiles || 0)))
    },
    deliverableFiles: deliverableFiles.map((file) => ({
      id: cleanString(file?.id || '', 180),
      name: cleanString(file?.name || file?.displayPath || '', 220),
      displayPath: cleanString(file?.displayPath || file?.name || '', 320),
      storagePath: cleanString(file?.storagePath || '', 900),
      sizeBytes: Math.max(0, Math.round(Number(file?.sizeBytes || 0))),
      contentType: cleanString(file?.contentType || '', 120)
    })).filter((file) => file.storagePath).slice(0, 50),
    shortDescription: cleanString(product.shortDescription || '', 500),
    description: cleanString(product.description || '', 2200),
    sellerAgreementAccepted: Boolean(product.sellerAgreementAccepted || product.sellerAgreement?.accepted)
  }
}

function buildDecisionUpdate(decision = '', { uid = '', reason = '', notes = '', existing = {} } = {}) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  const cleanReason = cleanString(reason, 1200)
  const cleanNotes = cleanString(notes, 2400)
  const summaryParts = [existing.moderationSummary, cleanReason, cleanNotes].map((item) => cleanString(item, 1200)).filter(Boolean)
  const base = {
    reviewedAt: now,
    reviewedBy: uid,
    reviewDecision: decision,
    reviewReason: cleanReason,
    reviewNotes: cleanNotes,
    updatedAt: now
  }
  if (summaryParts.length) base.moderationSummary = summaryParts.slice(-3).join(' | ')

  if (decision === 'approve') {
    return {
      ...base,
      status: 'published',
      visibility: 'public',
      moderationStatus: 'approved',
      reviewJobStatus: 'approved',
      publishedAt: now,
      releasedAt: existing.releasedAt || now
    }
  }
  if (decision === 'request_changes') {
    return {
      ...base,
      status: 'needs_changes',
      visibility: 'private',
      moderationStatus: 'needs_changes',
      reviewJobStatus: 'needs_changes',
      publishedAt: null
    }
  }
  if (decision === 'reject') {
    return {
      ...base,
      status: 'rejected',
      visibility: 'private',
      moderationStatus: 'rejected',
      reviewJobStatus: 'rejected',
      publishedAt: null
    }
  }
  return {
    ...base,
    status: 'review_pending',
    visibility: 'private',
    reviewJobStatus: 'pending_manual_review',
    publishedAt: null
  }
}

async function loadReviewQueue(limitCount = 60) {
  const pageSize = Math.max(1, Math.min(Number(limitCount || 60), 100))
  const products = new Map()
  const addDocs = (snapshot) => {
    snapshot.docs.forEach((docSnap) => {
      if (products.size >= pageSize) return
      const data = docSnap.data() || {}
      if (productIsInReviewQueue(data)) products.set(docSnap.id, sanitizeProductForQueue(docSnap.id, data))
    })
  }
  const productsRef = db().collection('products')
  const snapshots = await Promise.all([
    productsRef.where('status', 'in', Array.from(REVIEW_STATUSES)).limit(pageSize).get(),
    productsRef.where('reviewJobStatus', 'in', Array.from(REVIEW_JOB_STATUSES)).limit(pageSize).get(),
    productsRef.where('moderationStatus', 'in', Array.from(REVIEW_MODERATION_STATUSES)).limit(pageSize).get()
  ])
  snapshots.forEach(addDocs)
  return Array.from(products.values())
    .sort((a, b) => {
      const aStamp = toMillis(a.reviewRequestedAt || a.updatedAt || a.createdAt)
      const bStamp = toMillis(b.reviewRequestedAt || b.updatedAt || b.createdAt)
      return bStamp - aStamp
    })
    .slice(0, pageSize)
}

exports.listMarketplaceReviewQueue = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  await requireStaff(request)
  const products = await loadReviewQueue(request.data?.limit)
  return { ok: true, products }
})

exports.reviewProductDecision = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const staff = await requireStaff(request)
  const productId = normalizeProductId(request.data?.productId)
  const decision = normalizeDecision(request.data?.decision)
  const reason = cleanString(request.data?.reason || '', 1200)
  const notes = cleanString(request.data?.notes || '', 2400)
  const productRef = db().collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
  const product = productSnap.data() || {}

  if (decision === 'approve' && (!productIsInReviewQueue(product) && product.status !== 'needs_changes')) {
    throw new HttpsError('failed-precondition', 'Only products in marketplace review can be approved.')
  }

  const productUpdate = buildDecisionUpdate(decision, { uid: staff.uid, reason, notes, existing: product })
  const eventRef = db().collection('productModeration').doc(productId).collection('events').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db().batch()
  batch.set(productRef, productUpdate, { merge: true })
  batch.set(eventRef, {
    id: eventRef.id,
    productId,
    decision,
    reason,
    notes,
    actorUid: staff.uid,
    actorEmail: staff.email,
    actorRole: staff.role,
    previousStatus: cleanString(product.status || '', 80),
    previousVisibility: cleanString(product.visibility || '', 80),
    previousModerationStatus: cleanString(product.moderationStatus || '', 80),
    createdAt: now
  })
  await batch.commit()

  return {
    ok: true,
    productId,
    decision,
    status: productUpdate.status,
    visibility: productUpdate.visibility,
    moderationStatus: productUpdate.moderationStatus || product.moderationStatus || '',
    reviewJobStatus: productUpdate.reviewJobStatus || product.reviewJobStatus || ''
  }
})

exports.__test = {
  buildDecisionUpdate,
  cleanString,
  normalizeDecision,
  productIsInReviewQueue,
  sanitizeProductForQueue,
  tokenHasStaffRole
}
