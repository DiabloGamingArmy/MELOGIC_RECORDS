const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const db = admin.firestore()
const { FieldValue } = admin.firestore

const ALLOWED_STATUSES = new Set([
  'draft',
  'review_pending',
  'pending_ai_review',
  'needs_changes',
  'rejected',
  'archived'
])
const CREATE_STATUSES = new Set(['draft', 'review_pending'])
const ALLOWED_VISIBILITIES = new Set(['private', 'unlisted'])
const ALLOWED_CURRENCIES = new Set(['USD', 'EUR', 'GBP'])
const MAX_MONEY_CENTS = 10000000

function cleanString(value = '', max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function cleanLongString(value = '', max = 20000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180)
}

function normalizeDocId(value = '') {
  const productId = cleanString(value, 180)
  if (!productId) return ''
  if (productId === '.' || productId === '..' || productId.includes('/')) {
    throw new HttpsError('invalid-argument', 'productId is invalid.')
  }
  return productId
}

function normalizeStatus(value = '') {
  const raw = cleanString(value, 40)
  if (!raw) return 'draft'
  if (raw === 'published') return 'review_pending'
  if (!ALLOWED_STATUSES.has(raw)) {
    throw new HttpsError('invalid-argument', 'Product status is invalid.')
  }
  return raw
}

function normalizeCreateStatus(value = '') {
  const status = normalizeStatus(value)
  if (!CREATE_STATUSES.has(status)) return 'draft'
  return status
}

function normalizeVisibility(value = '') {
  const raw = cleanString(value, 40)
  if (!raw) return 'private'
  if (raw === 'public') return 'unlisted'
  if (!ALLOWED_VISIBILITIES.has(raw)) {
    throw new HttpsError('invalid-argument', 'Product visibility is invalid.')
  }
  return raw
}

function normalizeMoneyCents(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_MONEY_CENTS, Math.max(0, Math.round(parsed)))
}

function normalizeCurrency(value = '') {
  const currency = cleanString(value || 'USD', 8).toUpperCase()
  return ALLOWED_CURRENCIES.has(currency) ? currency : 'USD'
}

function normalizeStringArray(value, limit = 50, maxItemLength = 120) {
  const rows = Array.isArray(value)
    ? value
    : String(value || '').split(',')
  return Array.from(new Set(rows
    .map((item) => cleanString(item, maxItemLength))
    .filter(Boolean)))
    .slice(0, limit)
}

function normalizeKey(value = '') {
  return slugify(value).slice(0, 80)
}

function normalizeKeyArray(value, limit = 50) {
  return normalizeStringArray(value, limit, 120).map(normalizeKey).filter(Boolean)
}

function normalizePath(value = '', max = 600) {
  const path = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .slice(0, max)
  if (!path || path.includes('..') || /^https?:\/\//i.test(path) || /^gs:\/\//i.test(path)) return ''
  return path
}

function normalizePathArray(value, limit = 24) {
  const rows = Array.isArray(value)
    ? value
    : String(value || '').split(',')
  return rows.map((item) => normalizePath(item)).filter(Boolean).slice(0, limit)
}

function normalizeUrl(value = '', max = 1200) {
  const url = cleanString(value, max)
  if (!url) return ''
  return /^https:\/\/|^http:\/\//i.test(url) ? url : ''
}

function normalizeAssetSummary(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    totalFiles: normalizeMoneyCents(input.totalFiles, 0),
    totalBytes: Math.max(0, Math.round(Number(input.totalBytes || 0) || 0)),
    previewableCount: normalizeMoneyCents(input.previewableCount, 0),
    downloadableCount: normalizeMoneyCents(input.downloadableCount, 0)
  }
}

function normalizePreviewAssignment(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    hoverEnabled: input.hoverEnabled !== false,
    hoverDelayMs: Math.max(0, Math.round(Number(input.hoverDelayMs || 0) || 0)),
    hoverVideoPath: normalizePath(input.hoverVideoPath),
    hoverVideoURL: normalizeUrl(input.hoverVideoURL),
    hoverAudioPath: normalizePath(input.hoverAudioPath),
    hoverAudioURL: normalizeUrl(input.hoverAudioURL),
    cardPreviewMode: ['none', 'audio', 'video', 'video-audio'].includes(input.cardPreviewMode) ? input.cardPreviewMode : 'audio',
    detailHeroPreviewPath: normalizePath(input.detailHeroPreviewPath),
    detailHeroPreviewType: ['audio', 'video', 'image', ''].includes(input.detailHeroPreviewType) ? input.detailHeroPreviewType : '',
    demoReelPath: normalizePath(input.demoReelPath),
    demoReelType: ['audio', 'video', ''].includes(input.demoReelType) ? input.demoReelType : '',
    updatedAt: cleanString(input.updatedAt || '', 80)
  }
}

function normalizeSellerAgreement(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    agreementId: cleanString(input.agreementId || '', 120),
    version: cleanString(input.version || input.activeVersion || '', 80),
    accepted: input.accepted === true,
    acceptedAt: cleanString(input.acceptedAt || '', 80)
  }
}

function normalizeDeliverableFiles(value = [], productId = '') {
  if (!Array.isArray(value)) return []
  return value.slice(0, 500).map((row, index) => {
    const id = cleanString(row?.id || `file-${index}`, 120)
    const storagePath = normalizePath(row?.storagePath || row?.path || row?.filePath || '')
    return {
      id,
      productId,
      name: cleanString(row?.name || row?.displayPath || id, 180),
      displayPath: cleanString(row?.displayPath || row?.name || id, 260),
      storagePath,
      sizeBytes: Math.max(0, Math.round(Number(row?.sizeBytes || 0) || 0)),
      contentType: cleanString(row?.contentType || row?.mimeType || 'application/octet-stream', 120),
      extension: cleanString(row?.extension || String(row?.name || '').split('.').pop() || '', 20),
      type: cleanString(row?.type || row?.contentType || 'file', 120),
      category: cleanString(row?.category || 'Deliverables', 120),
      role: cleanString(row?.role || 'deliverable', 80),
      isDeliverable: row?.isDeliverable !== false,
      isDownloadable: row?.isDownloadable !== false,
      canPreview: row?.canPreview === true,
      description: cleanString(row?.description || '', 150),
      updatedAt: cleanString(row?.updatedAt || '', 80)
    }
  }).filter((row) => row.id)
}

function buildSearchKeywords(product = {}, creator = {}) {
  return Array.from(new Set([
    ...normalizeStringArray(product.searchKeywords, 120, 80),
    ...cleanString(product.title || '', 160).toLowerCase().split(/\s+/),
    ...cleanString(creator.artistName || product.artistName || '', 160).toLowerCase().split(/\s+/),
    ...cleanString(creator.artistUsername || product.artistUsername || '', 80).toLowerCase().split(/\s+/),
    ...normalizeStringArray(product.tags, 50, 80).map((tag) => tag.toLowerCase()),
    ...normalizeStringArray(product.genres, 20, 80).map((genre) => genre.toLowerCase()),
    ...normalizeStringArray(product.categories, 20, 80).map((category) => category.toLowerCase())
  ].map((token) => normalizeKey(token)).filter((token) => token.length > 1))).slice(0, 120)
}

function safeOptionalBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined
  return value === true
}

function baseProductPayload({ product = {}, productId = '', uid = '', existing = null } = {}) {
  const title = cleanString(product.title || existing?.title || '', 160)
  if (!title) throw new HttpsError('invalid-argument', 'Product title is required.')

  const slug = slugify(product.slug || existing?.slug || title)
  if (!slug) throw new HttpsError('invalid-argument', 'Product slug is required.')

  const creator = {
    artistName: cleanString(product.artistName || product.artistDisplayName || existing?.artistName || 'Creator', 160) || 'Creator',
    artistDisplayName: cleanString(product.artistDisplayName || product.artistName || existing?.artistDisplayName || existing?.artistName || 'Creator', 160) || 'Creator',
    artistUsername: cleanString(product.artistUsername || existing?.artistUsername || '', 80),
    artistProfilePath: cleanString(product.artistProfilePath || existing?.artistProfilePath || `profiles/${uid}`, 180) || `profiles/${uid}`,
    artistAvatarURL: normalizeUrl(product.artistAvatarURL || existing?.artistAvatarURL || ''),
    artistPhotoURL: normalizeUrl(product.artistPhotoURL || product.artistAvatarURL || existing?.artistPhotoURL || existing?.artistAvatarURL || '')
  }

  const priceCents = normalizeMoneyCents(product.priceCents, normalizeMoneyCents(existing?.priceCents, 0))
  const payoutTargetCents = normalizeMoneyCents(product.payoutTargetCents, priceCents)
  const categories = normalizeStringArray(product.categories ?? existing?.categories, 20, 80)
  const genres = normalizeStringArray(product.genres ?? existing?.genres, 20, 80)
  const tags = normalizeStringArray(product.tags ?? existing?.tags, 50, 80)
  const categoryKeys = normalizeKeyArray(product.categoryKeys ?? categories, 20)
  const genreKeys = normalizeKeyArray(product.genreKeys ?? genres, 20)
  const tagKeys = normalizeKeyArray(product.tagKeys ?? tags, 50)
  const contributorIds = normalizeStringArray(product.contributorIds ?? existing?.contributorIds, 25, 120)
  const contributorNames = normalizeStringArray(product.contributorNames ?? existing?.contributorNames, 25, 160)
  const pendingContributorIds = normalizeStringArray(product.pendingContributorIds ?? existing?.pendingContributorIds, 25, 120)

  const payload = {
    id: productId,
    slug,
    status: normalizeStatus(product.status || existing?.status || 'draft'),
    visibility: normalizeVisibility(product.visibility || existing?.visibility || 'private'),
    title,
    shortDescription: cleanString(product.shortDescription || existing?.shortDescription || '', 500),
    description: cleanLongString(product.description || existing?.description || '', 20000),
    version: cleanString(product.version || existing?.version || '', 80),
    usageLicense: cleanString(product.usageLicense || existing?.usageLicense || '', 120),
    productType: cleanString(product.productType || existing?.productType || 'Sample Pack', 120) || 'Sample Pack',
    productKind: cleanString(product.productKind || existing?.productKind || '', 80),
    previewMode: cleanString(product.previewMode || existing?.previewMode || '', 80),
    distributionMode: cleanString(product.distributionMode || existing?.distributionMode || '', 80),
    categories,
    genres,
    tags,
    categoryKeys,
    genreKeys,
    tagKeys,
    searchKeywords: buildSearchKeywords(product, creator),
    artistId: uid,
    ...creator,
    artistNameLower: creator.artistName.toLowerCase(),
    artistUsernameLower: creator.artistUsername.toLowerCase(),
    contributorIds,
    contributorNames,
    contributorCount: Math.min(25, Math.max(0, Math.round(Number(product.contributorCount ?? contributorIds.length) || 0))),
    pendingContributorIds,
    contributorRequestCount: Math.min(25, Math.max(0, Math.round(Number(product.contributorRequestCount ?? pendingContributorIds.length) || 0))),
    sellerAgreement: normalizeSellerAgreement(product.sellerAgreement || existing?.sellerAgreement || {}),
    sellerAgreementAccepted: product.sellerAgreementAccepted === undefined
      ? Boolean(existing?.sellerAgreementAccepted)
      : product.sellerAgreementAccepted === true,
    sellerAgreementVersion: cleanString(product.sellerAgreementVersion || existing?.sellerAgreementVersion || '', 80),
    coverPath: normalizePath(product.coverPath || existing?.coverPath || ''),
    thumbnailPath: normalizePath(product.thumbnailPath || existing?.thumbnailPath || ''),
    coverURL: normalizeUrl(product.coverURL || existing?.coverURL || ''),
    thumbnailURL: normalizeUrl(product.thumbnailURL || existing?.thumbnailURL || ''),
    galleryPaths: normalizePathArray(product.galleryPaths ?? existing?.galleryPaths, 24),
    previewAudioPaths: normalizePathArray(product.previewAudioPaths ?? existing?.previewAudioPaths, 12),
    previewVideoPaths: normalizePathArray(product.previewVideoPaths ?? existing?.previewVideoPaths, 8),
    downloadPath: normalizePath(product.downloadPath || existing?.downloadPath || ''),
    deliverableFiles: normalizeDeliverableFiles(product.deliverableFiles || existing?.deliverableFiles || [], productId),
    licensePath: normalizePath(product.licensePath || existing?.licensePath || ''),
    assetSummary: normalizeAssetSummary(product.assetSummary || existing?.assetSummary || {}),
    primaryPreviewPath: normalizePath(product.primaryPreviewPath || existing?.primaryPreviewPath || ''),
    primaryPreviewType: cleanString(product.primaryPreviewType || existing?.primaryPreviewType || '', 40),
    primaryPreviewDuration: Math.max(0, Number(product.primaryPreviewDuration || existing?.primaryPreviewDuration || 0) || 0),
    primaryDownloadPath: normalizePath(product.primaryDownloadPath || product.downloadPath || existing?.primaryDownloadPath || existing?.downloadPath || ''),
    primaryDownloadBytes: Math.max(0, Math.round(Number(product.primaryDownloadBytes || existing?.primaryDownloadBytes || 0) || 0)),
    previewAssignment: normalizePreviewAssignment(product.previewAssignment || existing?.previewAssignment || {}),
    priceCents,
    payoutTargetCents,
    currency: normalizeCurrency(product.currency || existing?.currency || 'USD'),
    isFree: priceCents === 0,
    dawCompatibility: normalizeKeyArray(product.dawCompatibility ?? existing?.dawCompatibility, 40),
    formatKeys: normalizeKeyArray(product.formatKeys ?? existing?.formatKeys, 40),
    formatNotes: cleanLongString(product.formatNotes || existing?.formatNotes || '', 5000),
    compatibilityNotes: cleanLongString(product.compatibilityNotes || existing?.compatibilityNotes || '', 5000),
    includedFiles: cleanLongString(product.includedFiles || existing?.includedFiles || '', 10000)
  }

  const saleEnabled = safeOptionalBoolean(product.saleEnabled)
  const storefrontVisible = safeOptionalBoolean(product.storefrontVisible)
  if (saleEnabled !== undefined) payload.saleEnabled = saleEnabled
  if (storefrontVisible !== undefined) payload.storefrontVisible = storefrontVisible

  return payload
}

function createOnlyFields(status = 'draft') {
  return {
    createdAt: FieldValue.serverTimestamp(),
    likeCount: 0,
    dislikeCount: 0,
    saveCount: 0,
    downloadCount: 0,
    commentCount: 0,
    shareCount: 0,
    followCount: 0,
    counts: {
      likes: 0,
      dislikes: 0,
      saves: 0,
      shares: 0,
      comments: 0,
      downloads: 0,
      follows: 0
    },
    featured: false,
    promoted: false,
    salesCount: 0,
    revenue: 0,
    entitlementCount: 0,
    moderationStatus: status === 'draft' ? 'not_submitted' : 'pending',
    moderationSummary: '',
    moderationReasons: [],
    moderationRiskLevel: '',
    moderationAIConfigured: false,
    moderationAIAttempted: false,
    moderationAISucceeded: false,
    moderationAIEnabled: false,
    moderationAIModel: '',
    moderationAIError: '',
    moderationAIErrorCode: '',
    moderationAIErrorCategory: '',
    moderationAICompletedAt: null,
    moderationAIFailedAt: null,
    reviewRequestedAt: null,
    reviewRequestedBy: '',
    reviewJobStatus: '',
    reviewedAt: null,
    reviewedBy: '',
    publishedAt: null
  }
}

function resetReviewFields(status = 'draft') {
  return {
    moderationStatus: status === 'draft' ? 'not_submitted' : 'pending',
    moderationSummary: '',
    moderationReasons: [],
    moderationRiskLevel: '',
    moderationAIConfigured: false,
    moderationAIAttempted: false,
    moderationAISucceeded: false,
    moderationAIEnabled: false,
    moderationAIModel: '',
    moderationAIError: '',
    moderationAIErrorCode: '',
    moderationAIErrorCategory: '',
    moderationAICompletedAt: null,
    moderationAIFailedAt: null,
    reviewRequestedAt: null,
    reviewRequestedBy: '',
    reviewJobStatus: '',
    reviewedAt: null,
    reviewedBy: '',
    publishedAt: null
  }
}

function hasActiveReviewState(product = {}) {
  return ['review_pending', 'pending_ai_review'].includes(product.status)
    && ['queued', 'running', 'pending_manual_review', 'ai_failed', 'failed_ai_auth'].includes(product.reviewJobStatus)
}

exports.createOrUpdateProductShell = onCall(
  {
    timeoutSeconds: 30,
    memory: '256MiB',
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

    const input = request.data || {}
    const product = input.product && typeof input.product === 'object' && !Array.isArray(input.product)
      ? input.product
      : {}
    const requestedProductId = normalizeDocId(input.productId || product.id || '')
    const productRef = requestedProductId
      ? db.collection('products').doc(requestedProductId)
      : db.collection('products').doc()
    const productId = productRef.id

    let response = null
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(productRef)
      const created = !snap.exists
      const existing = snap.exists ? (snap.data() || {}) : null

      if (existing && existing.artistId !== uid) {
        throw new HttpsError('permission-denied', 'This product does not belong to the signed-in account.')
      }

      const payload = baseProductPayload({ product, productId, uid, existing })
      payload.status = created ? normalizeCreateStatus(payload.status) : normalizeStatus(payload.status)
      payload.visibility = normalizeVisibility(payload.visibility)

      if (existing?.status === 'published') {
        payload.status = payload.status === 'draft' ? 'draft' : 'review_pending'
        payload.visibility = payload.visibility === 'unlisted' ? 'unlisted' : 'private'
        Object.assign(payload, resetReviewFields(payload.status))
      } else if (existing && hasActiveReviewState(existing) && payload.status === 'draft') {
        payload.status = existing.status
      }

      if (payload.status === 'published' || payload.visibility === 'public') {
        throw new HttpsError('invalid-argument', 'Product shell cannot be public or published.')
      }

      const writePayload = {
        ...payload,
        artistId: uid,
        updatedAt: FieldValue.serverTimestamp()
      }

      if (created) {
        Object.assign(writePayload, createOnlyFields(writePayload.status))
      }

      tx.set(productRef, writePayload, { merge: true })
      response = {
        ok: true,
        productId,
        status: writePayload.status,
        visibility: writePayload.visibility,
        created,
        updated: !created
      }
    })

    return response
  }
)

exports.__test = {
  baseProductPayload,
  normalizeCreateStatus,
  normalizeDocId,
  normalizeStatus,
  normalizeVisibility,
  slugify
}
