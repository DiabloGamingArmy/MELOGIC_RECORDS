const { HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('./adminAuth')

const DECISIONS = new Set(['approve', 'request_changes', 'reject', 'keep_pending'])
const REVIEW_STATUSES = new Set(['review_pending', 'pending_ai_review', 'needs_changes'])
const REVIEW_JOB_STATUSES = new Set(['pending_manual_review', 'ai_failed', 'failed_ai_auth', 'needs_changes'])
const REVIEW_MODERATION_STATUSES = new Set(['pending', 'ai_error', 'needs_changes'])

function db() {
  return admin.firestore()
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

function productIsInReviewQueue(product = {}) {
  return REVIEW_STATUSES.has(cleanString(product.status, 80)) ||
    REVIEW_JOB_STATUSES.has(cleanString(product.reviewJobStatus, 80)) ||
    REVIEW_MODERATION_STATUSES.has(cleanString(product.moderationStatus, 80))
}

function sanitizePathList(value = [], max = 24) {
  return Array.isArray(value) ? value.map((item) => cleanString(item, 900)).filter(Boolean).slice(0, max) : []
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
    artistDisplayName: cleanString(product.artistDisplayName || product.artistName || 'Creator', 180),
    artistUsername: cleanString(product.artistUsername || '', 180),
    artistProfilePath: cleanString(product.artistProfilePath || '', 360),
    artistAvatarURL: cleanString(product.artistAvatarURL || product.artistPhotoURL || '', 900),
    artistPhotoURL: cleanString(product.artistPhotoURL || product.artistAvatarURL || '', 900),
    productType: cleanString(product.productType || 'Product', 120),
    productKind: cleanString(product.productKind || '', 120),
    usageLicense: cleanString(product.usageLicense || '', 180),
    version: cleanString(product.version || '', 80),
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
    reviewRequestedBy: cleanString(product.reviewRequestedBy || '', 180),
    reviewedAt: serializeDate(product.reviewedAt),
    reviewedBy: cleanString(product.reviewedBy || '', 180),
    reviewDecision: cleanString(product.reviewDecision || '', 80),
    reviewReason: cleanString(product.reviewReason || '', 1200),
    reviewNotes: cleanString(product.reviewNotes || '', 2400),
    createdAt: serializeDate(product.createdAt),
    updatedAt: serializeDate(product.updatedAt),
    coverPath: cleanString(product.coverPath || '', 900),
    coverURL: cleanString(product.coverURL || '', 900),
    thumbnailPath: cleanString(product.thumbnailPath || '', 900),
    thumbnailURL: cleanString(product.thumbnailURL || '', 900),
    downloadPath: cleanString(product.downloadPath || '', 900),
    primaryDownloadPath: cleanString(product.primaryDownloadPath || product.downloadPath || '', 900),
    primaryDownloadBytes: Math.max(0, Math.round(Number(product.primaryDownloadBytes || 0))),
    galleryPaths: sanitizePathList(product.galleryPaths, 24),
    previewAudioPaths: sanitizePathList(product.previewAudioPaths, 12),
    previewVideoPaths: sanitizePathList(product.previewVideoPaths, 8),
    previewAssignment: {
      cardPreviewMode: cleanString(previewAssignment.cardPreviewMode || '', 80),
      hoverAudioPath: cleanString(previewAssignment.hoverAudioPath || '', 900),
      hoverAudioURL: cleanString(previewAssignment.hoverAudioURL || '', 900),
      hoverVideoPath: cleanString(previewAssignment.hoverVideoPath || '', 900),
      hoverVideoURL: cleanString(previewAssignment.hoverVideoURL || '', 900),
      demoReelPath: cleanString(previewAssignment.demoReelPath || '', 900),
      demoReelType: cleanString(previewAssignment.demoReelType || '', 80),
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
      contentType: cleanString(file?.contentType || '', 120),
      downloadable: file?.downloadable !== false,
      previewable: file?.previewable === true
    })).filter((file) => file.storagePath).slice(0, 50),
    shortDescription: cleanString(product.shortDescription || '', 500),
    description: cleanString(product.description || '', 2200),
    sellerAgreementAccepted: Boolean(product.sellerAgreementAccepted || product.sellerAgreement?.accepted),
    sellerAgreementVersion: cleanString(product.sellerAgreementVersion || product.sellerAgreement?.version || '', 80),
    sellerAgreement: {
      accepted: Boolean(product.sellerAgreement?.accepted || product.sellerAgreementAccepted),
      acceptedAt: serializeDate(product.sellerAgreement?.acceptedAt),
      agreementId: cleanString(product.sellerAgreement?.agreementId || '', 180),
      version: cleanString(product.sellerAgreement?.version || product.sellerAgreementVersion || '', 80)
    },
    moderationAIAttempted: Boolean(product.moderationAIAttempted),
    moderationAIConfigured: Boolean(product.moderationAIConfigured),
    moderationAIEnabled: Boolean(product.moderationAIEnabled),
    moderationAICompletedAt: serializeDate(product.moderationAICompletedAt),
    moderationAIFailedAt: serializeDate(product.moderationAIFailedAt),
    moderationAIError: cleanString(product.moderationAIError || '', 1200),
    moderationAIErrorCode: cleanString(product.moderationAIErrorCode || '', 120),
    moderationAIErrorCategory: cleanString(product.moderationAIErrorCategory || '', 120)
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

function productHasDeliverables(product = {}) {
  const deliverableFiles = Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []
  const deliverableCount = deliverableFiles.filter((file) => cleanString(file?.storagePath || file?.path || '', 900)).length
  const assetSummary = product.assetSummary && typeof product.assetSummary === 'object' && !Array.isArray(product.assetSummary)
    ? product.assetSummary
    : {}
  return deliverableCount > 0 ||
    Number(assetSummary.downloadableCount || 0) > 0 ||
    Boolean(cleanString(product.primaryDownloadPath || product.downloadPath || '', 900))
}

function validateProductForApproval(product = {}) {
  const problems = []
  const priceCents = Number(product.priceCents)
  const payoutTargetCents = Number(product.payoutTargetCents || 0)
  if (!productIsInReviewQueue(product)) problems.push('Product is not in a reviewable state.')
  if (!cleanString(product.artistId || '', 180)) problems.push('Artist ownership is missing.')
  if (!cleanString(product.title || '', 160)) problems.push('Title is missing.')
  if (!cleanString(product.slug || '', 180)) problems.push('Slug is missing.')
  if (!cleanString(product.productType || '', 120)) problems.push('Product type is missing.')
  if (!cleanString(product.shortDescription || product.description || '', 500)) problems.push('Description is missing.')
  if (!Boolean(product.sellerAgreementAccepted || product.sellerAgreement?.accepted)) problems.push('Seller agreement is missing.')
  if (!productHasDeliverables(product)) problems.push('At least one deliverable is required.')
  if (!Number.isFinite(priceCents) || priceCents < 0) problems.push('Price is invalid.')
  if (!Number.isFinite(payoutTargetCents) || payoutTargetCents < 0) problems.push('Payout target is invalid.')
  if (!cleanString(product.currency || 'USD', 12)) problems.push('Currency is missing.')
  return problems
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

module.exports = {
  DECISIONS,
  REVIEW_JOB_STATUSES,
  REVIEW_MODERATION_STATUSES,
  REVIEW_STATUSES,
  buildDecisionUpdate,
  cleanString,
  loadReviewQueue,
  normalizeDecision,
  normalizeProductId,
  productHasDeliverables,
  productIsInReviewQueue,
  sanitizeProductForQueue,
  serializeDate,
  validateProductForApproval
}
