import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { deleteObject, getDownloadURL, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { storage } from '../firebase/storage'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { STORAGE_PATHS } from '../config/storagePaths'
import { getCachedStorageUrl } from '../services/pageMediaCache'

let hasWarnedProductFetch = false
let hasWarnedProductMedia = false
const isDevelopmentRuntime = import.meta.env.DEV

function warnOnce(type, ...details) {
  if (type === 'fetch') {
    if (hasWarnedProductFetch) return
    hasWarnedProductFetch = true
  } else if (type === 'media') {
    if (hasWarnedProductMedia) return
    hasWarnedProductMedia = true
  }
  console.warn(...details)
}

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
}

function toPathArray(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean)
  return String(value || '').split(',').map((v) => v.trim()).filter(Boolean)
}

const PRODUCT_KIND_CONFIG = {
  'single-sample': { previewMode: 'hover-audio', distributionMode: 'single-file' },
  'sample-pack': { previewMode: 'demo-audio', distributionMode: 'folder-manifest' },
  'drum-kit': { previewMode: 'demo-audio', distributionMode: 'folder-manifest' },
  'vocal-pack': { previewMode: 'demo-audio', distributionMode: 'folder-manifest' },
  'preset-bank': { previewMode: 'detail-browser', distributionMode: 'folder-manifest' },
  'wavetable-pack': { previewMode: 'detail-browser', distributionMode: 'folder-manifest' },
  'midi-pack': { previewMode: 'detail-browser', distributionMode: 'folder-manifest' },
  'project-file': { previewMode: 'detail-browser', distributionMode: 'package-download' },
  'plugin-vst': { previewMode: 'video-demo', distributionMode: 'installer-variants' },
  'course-tutorial': { previewMode: 'video-demo', distributionMode: 'package-download' },
  release: { previewMode: 'demo-audio', distributionMode: 'package-download' },
  other: { previewMode: 'none', distributionMode: 'external-or-manual' }
}

export const PRODUCT_QUOTAS = {
  maxTotalDeliverableBytes: 1024 * 1024 * 1024,
  maxSingleDeliverableBytes: 512 * 1024 * 1024,
  maxPackageBytes: 1024 * 1024 * 1024,
  maxPreviewAudioBytes: 50 * 1024 * 1024,
  maxPreviewVideoBytes: 250 * 1024 * 1024,
  maxGalleryImageBytes: 15 * 1024 * 1024,
  maxFileCount: 500,
  maxFolderDepth: 8,
  maxPathLength: 260,
  maxFileNameLength: 160
}

export function normalizeProductKind(value = '') {
  const key = normalizeKey(value)
  if (PRODUCT_KIND_CONFIG[key]) return key
  if (key === 'plugin-vst' || key === 'plugin-vst-au-aax') return 'plugin-vst'
  if (key === 'course-tutorials') return 'course-tutorial'
  if (key === 'wavetable-pack' || key === 'wavetables') return 'wavetable-pack'
  return 'other'
}

function resolveKindSettings(productType, productKind, previewMode, distributionMode) {
  const resolvedKind = productKind || normalizeProductKind(productType)
  const defaults = PRODUCT_KIND_CONFIG[resolvedKind] || PRODUCT_KIND_CONFIG.other
  return {
    productKind: resolvedKind,
    previewMode: previewMode || defaults.previewMode || 'none',
    distributionMode: distributionMode || defaults.distributionMode || 'external-or-manual'
  }
}

function previewDefaultsForType(productType = '') {
  const normalized = normalizeProductKind(productType)
  if (normalized === 'single-sample') return { cardPreviewMode: 'audio', hoverEnabled: true }
  if (normalized === 'plugin-vst') return { cardPreviewMode: 'video-audio', hoverEnabled: true }
  if (normalized === 'course-tutorial') return { cardPreviewMode: 'video', hoverEnabled: true }
  if (normalized === 'sample-pack' || normalized === 'drum-kit' || normalized === 'vocal-pack') {
    return { cardPreviewMode: 'video-audio', hoverEnabled: true }
  }
  return { cardPreviewMode: 'audio', hoverEnabled: true }
}

function normalizePreviewAssignment(input = {}, productType = '') {
  const defaults = previewDefaultsForType(productType)
  return {
    hoverEnabled: input.hoverEnabled !== false && defaults.hoverEnabled,
    hoverDelayMs: Math.max(0, Number(input.hoverDelayMs || 500)),
    hoverVideoPath: String(input.hoverVideoPath || ''),
    hoverVideoURL: String(input.hoverVideoURL || ''),
    hoverAudioPath: String(input.hoverAudioPath || ''),
    hoverAudioURL: String(input.hoverAudioURL || ''),
    cardPreviewMode: ['none', 'audio', 'video', 'video-audio'].includes(input.cardPreviewMode) ? input.cardPreviewMode : defaults.cardPreviewMode,
    detailHeroPreviewPath: String(input.detailHeroPreviewPath || ''),
    detailHeroPreviewType: ['audio', 'video', 'image', ''].includes(input.detailHeroPreviewType) ? input.detailHeroPreviewType : '',
    demoReelPath: String(input.demoReelPath || ''),
    demoReelType: ['audio', 'video', ''].includes(input.demoReelType) ? input.demoReelType : '',
    updatedAt: input.updatedAt || new Date().toISOString()
  }
}

function toPriceLabel(product) {
  if (product?.isFree) return 'Free'
  if (!Number.isFinite(product?.priceCents)) return null
  const amount = product.priceCents / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: product.currency || 'USD',
      maximumFractionDigits: 2
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

async function safeStorageUrl(path, fallback = '') {
  if (!path || !storage) return fallback
  const resolved = await getCachedStorageUrl(path, async (storagePath) => {
    try {
      return await getDownloadURL(ref(storage, storagePath))
    } catch (error) {
      if (isDevelopmentRuntime) warnOnce('media', '[productService] Storage URL resolution failed.', { path: storagePath, code: error?.code, message: error?.message })
      return ''
    }
  }, { scopeKey: `product-media:${String(path).split('/').slice(0, 2).join('/')}`, type: 'product-media' })
  return resolved || fallback
}

export async function resolveProductMedia(product) {
  const explicitThumbnailPath = String(product.thumbnailPath || '').trim()
  const explicitCoverPath = String(product.coverPath || '').trim()
  const galleryPaths = Array.isArray(product.galleryPaths) ? product.galleryPaths.slice(0, 12) : []
  const previewVideoPaths = Array.isArray(product.previewVideoPaths) ? product.previewVideoPaths.slice(0, 6) : []

  const coverURL = explicitCoverPath ? await safeStorageUrl(explicitCoverPath) : ''
  const thumbnailURL = explicitThumbnailPath
    ? await safeStorageUrl(explicitThumbnailPath, coverURL)
    : coverURL
  const previewAudioURLs = await Promise.all((product.previewAudioPaths || []).map((path) => safeStorageUrl(path)))
  const primaryPreviewURL = product.primaryPreviewPath ? await safeStorageUrl(product.primaryPreviewPath) : ''
  const galleryURLs = await Promise.all(galleryPaths.map((path) => safeStorageUrl(path)))
  const previewVideoURLs = await Promise.all(previewVideoPaths.map((path) => safeStorageUrl(path)))
  const assignment = normalizePreviewAssignment(product.previewAssignment || {}, product.productType)
  const hoverAudioURL = assignment.hoverAudioURL || await safeStorageUrl(assignment.hoverAudioPath)
  const hoverVideoURL = assignment.hoverVideoURL || await safeStorageUrl(assignment.hoverVideoPath)

  return {
    thumbnailPath: explicitThumbnailPath || explicitCoverPath,
    coverPath: explicitCoverPath,
    thumbnailURL,
    coverURL: coverURL || thumbnailURL,
    previewAudioURLs: previewAudioURLs.filter(Boolean),
    primaryPreviewURL: primaryPreviewURL || previewAudioURLs.find(Boolean) || '',
    galleryURLs: galleryURLs.filter(Boolean),
    previewVideoURLs: previewVideoURLs.filter(Boolean),
    previewAssignment: {
      ...assignment,
      hoverAudioURL,
      hoverVideoURL
    }
  }
}

export function normalizeProduct(productId, rawProduct = {}, media = {}) {
  const normalizeCount = (...values) => {
    for (const value of values) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return Math.max(0, parsed)
    }
    return 0
  }
  const counts = rawProduct.counts || {}
  const categories = rawProduct.categories || []
  const genres = rawProduct.genres || []
  const tags = rawProduct.tags || []
  const contributorNames = rawProduct.contributorNames || []
  const contributors = Array.isArray(rawProduct.contributors) ? rawProduct.contributors : []
  const contributorCount = Number(rawProduct.contributorCount ?? rawProduct.contributorIds?.length ?? contributorNames.length ?? 0)
  const likeCount = normalizeCount(counts.likes, rawProduct.likeCount)
  const dislikeCount = normalizeCount(counts.dislikes, rawProduct.dislikeCount)
  const saveCount = normalizeCount(counts.saves, rawProduct.saveCount)
  const downloadCount = normalizeCount(counts.downloads, rawProduct.downloadCount)
  const commentCount = normalizeCount(counts.comments, rawProduct.commentCount)
  const categoryKeys = Array.isArray(rawProduct.categoryKeys) && rawProduct.categoryKeys.length ? rawProduct.categoryKeys : categories.map(normalizeKey).filter(Boolean)
  const genreKeys = Array.isArray(rawProduct.genreKeys) && rawProduct.genreKeys.length ? rawProduct.genreKeys : genres.map(normalizeKey).filter(Boolean)
  const tagKeys = Array.isArray(rawProduct.tagKeys) && rawProduct.tagKeys.length ? rawProduct.tagKeys : tags.map(normalizeKey).filter(Boolean)
  const dawCompatibility = Array.isArray(rawProduct.dawCompatibility) ? rawProduct.dawCompatibility : []
  const formatKeys = Array.isArray(rawProduct.formatKeys) ? rawProduct.formatKeys : []
  const searchKeywords = Array.isArray(rawProduct.searchKeywords) ? rawProduct.searchKeywords : []
  const kindSettings = resolveKindSettings(rawProduct.productType, rawProduct.productKind, rawProduct.previewMode, rawProduct.distributionMode)
  const previewAssignment = normalizePreviewAssignment(rawProduct.previewAssignment || {}, rawProduct.productType)
  const assetSummary = rawProduct.assetSummary && typeof rawProduct.assetSummary === 'object'
    ? rawProduct.assetSummary
    : {}
  return {
    id: rawProduct.id || productId,
    slug: rawProduct.slug || '',
    status: rawProduct.status || 'draft',
    visibility: rawProduct.visibility || 'private',
    title: rawProduct.title || 'Untitled product',
    shortDescription: rawProduct.shortDescription || '',
    description: rawProduct.description || '',
    version: rawProduct.version || '',
    usageLicense: rawProduct.usageLicense || '',
    productType: rawProduct.productType || 'Release',
    productKind: kindSettings.productKind,
    previewMode: kindSettings.previewMode,
    distributionMode: kindSettings.distributionMode,
    categories,
    genres,
    tags,
    artistId: rawProduct.artistId || '',
    artistName: rawProduct.artistName || 'Unknown artist',
    artistDisplayName: rawProduct.artistDisplayName || rawProduct.artistName || 'Unknown artist',
    artistUsername: rawProduct.artistUsername || '',
    artistProfilePath: rawProduct.artistProfilePath || '',
    artistAvatarURL: rawProduct.artistAvatarURL || rawProduct.artistPhotoURL || '',
    artistPhotoURL: rawProduct.artistPhotoURL || rawProduct.artistAvatarURL || '',
    contributorIds: rawProduct.contributorIds || [],
    contributorNames,
    contributors,
    contributorCount,
    sellerAgreement: rawProduct.sellerAgreement && typeof rawProduct.sellerAgreement === 'object' ? rawProduct.sellerAgreement : null,
    sellerAgreementAccepted: Boolean(rawProduct.sellerAgreementAccepted),
    sellerAgreementVersion: String(rawProduct.sellerAgreementVersion || ''),
    coverPath: media.coverPath || rawProduct.coverPath || '',
    thumbnailPath: media.thumbnailPath || rawProduct.thumbnailPath || '',
    thumbnailURL: media.thumbnailURL || '',
    coverURL: media.coverURL || '',
    galleryPaths: toPathArray(rawProduct.galleryPaths),
    previewAudioPaths: toPathArray(rawProduct.previewAudioPaths),
    previewVideoPaths: toPathArray(rawProduct.previewVideoPaths),
    previewAudioURLs: media.previewAudioURLs || [],
    primaryPreviewURL: media.primaryPreviewURL || '',
    galleryURLs: media.galleryURLs || [],
    previewVideoURLs: media.previewVideoURLs || [],
    downloadPath: rawProduct.downloadPath || '',
    deliverableFiles: Array.isArray(rawProduct.deliverableFiles) ? rawProduct.deliverableFiles : [],
    licensePath: rawProduct.licensePath || '',
    assetSummary: {
      totalFiles: Number(assetSummary.totalFiles || 0),
      totalBytes: Number(assetSummary.totalBytes || 0),
      previewableCount: Number(assetSummary.previewableCount || 0),
      downloadableCount: Number(assetSummary.downloadableCount || 0)
    },
    primaryPreviewPath: rawProduct.primaryPreviewPath || rawProduct.previewAudioPaths?.[0] || '',
    primaryPreviewType: rawProduct.primaryPreviewType || '',
    primaryPreviewDuration: Number(rawProduct.primaryPreviewDuration || 0),
    primaryDownloadPath: rawProduct.primaryDownloadPath || rawProduct.downloadPath || '',
    primaryDownloadBytes: Number(rawProduct.primaryDownloadBytes || 0),
    previewAssignment: media.previewAssignment || previewAssignment,
    priceCents: Number.isFinite(rawProduct.priceCents) ? rawProduct.priceCents : 0,
    payoutTargetCents: Number.isFinite(rawProduct.payoutTargetCents) ? rawProduct.payoutTargetCents : Number.isFinite(rawProduct.priceCents) ? rawProduct.priceCents : 0,
    currency: rawProduct.currency || 'USD',
    isFree: Boolean(rawProduct.isFree),
    priceLabel: toPriceLabel(rawProduct),
    likeCount,
    dislikeCount,
    saveCount,
    downloadCount,
    commentCount,
    categoryKeys,
    genreKeys,
    tagKeys,
    dawCompatibility,
    formatKeys,
    titleLower: String(rawProduct.titleLower || rawProduct.title || '').toLowerCase(),
    artistNameLower: String(rawProduct.artistNameLower || rawProduct.artistName || '').toLowerCase(),
    artistUsernameLower: String(rawProduct.artistUsernameLower || rawProduct.artistUsername || '').toLowerCase(),
    searchKeywords,
    counts: { likes: likeCount, dislikes: dislikeCount, saves: saveCount, shares: normalizeCount(counts.shares, rawProduct.shareCount), comments: commentCount, downloads: downloadCount, follows: normalizeCount(counts.follows, rawProduct.followCount) },
    featured: Boolean(rawProduct.featured),
    moderationStatus: String(rawProduct.moderationStatus || ''),
    moderationSummary: String(rawProduct.moderationSummary || ''),
    moderationReasons: Array.isArray(rawProduct.moderationReasons) ? rawProduct.moderationReasons : [],
    moderationRiskLevel: String(rawProduct.moderationRiskLevel || ''),
    moderationAIConfigured: Boolean(rawProduct.moderationAIConfigured),
    moderationAIAttempted: Boolean(rawProduct.moderationAIAttempted),
    moderationAISucceeded: Boolean(rawProduct.moderationAISucceeded),
    moderationAIEnabled: Boolean(rawProduct.moderationAIEnabled),
    moderationAIError: String(rawProduct.moderationAIError || ''),
    moderationAIErrorCode: String(rawProduct.moderationAIErrorCode || ''),
    moderationAIErrorCategory: String(rawProduct.moderationAIErrorCategory || ''),
    moderationAIModel: String(rawProduct.moderationAIModel || ''),
    reviewJobStatus: String(rawProduct.reviewJobStatus || ''),
    reviewRequestedAt: toIsoDate(rawProduct.reviewRequestedAt),
    reviewedAt: toIsoDate(rawProduct.reviewedAt),
    reviewedBy: String(rawProduct.reviewedBy || ''),
    publishedAt: toIsoDate(rawProduct.publishedAt),
    releasedAt: toIsoDate(rawProduct.releasedAt),
    createdAt: toIsoDate(rawProduct.createdAt),
    updatedAt: toIsoDate(rawProduct.updatedAt)
  }
}

function sortQueryFor(sort = 'featured') {
  switch (sort) {
    case 'newest':
      return [orderBy('releasedAt', 'desc'), orderBy('createdAt', 'desc')]
    case 'oldest':
      return [orderBy('releasedAt', 'asc'), orderBy('createdAt', 'asc')]
    case 'priceLow':
      return [orderBy('priceCents', 'asc'), orderBy('createdAt', 'desc')]
    case 'priceHigh':
      return [orderBy('priceCents', 'desc'), orderBy('createdAt', 'desc')]
    case 'mostLiked':
      return [orderBy('likeCount', 'desc'), orderBy('createdAt', 'desc')]
    case 'mostSaved':
      return [orderBy('saveCount', 'desc'), orderBy('createdAt', 'desc')]
    case 'mostDownloaded':
      return [orderBy('downloadCount', 'desc'), orderBy('createdAt', 'desc')]
    case 'mostCommented':
      return [orderBy('commentCount', 'desc'), orderBy('createdAt', 'desc')]
    case 'featured':
    default:
      return [orderBy('featured', 'desc'), orderBy('releasedAt', 'desc'), orderBy('createdAt', 'desc')]
  }
}

function sortProductsClientSide(products = [], sort = 'featured') {
  const rows = [...products]
  const toStamp = (item) => new Date(item.releasedAt || item.createdAt || 0).getTime() || 0

  switch (sort) {
    case 'oldest':
      return rows.sort((a, b) => toStamp(a) - toStamp(b))
    case 'priceLow':
      return rows.sort((a, b) => Number(a.priceCents || 0) - Number(b.priceCents || 0))
    case 'priceHigh':
      return rows.sort((a, b) => Number(b.priceCents || 0) - Number(a.priceCents || 0))
    case 'mostLiked':
      return rows.sort((a, b) => Number(b.likeCount || b.counts?.likes || 0) - Number(a.likeCount || a.counts?.likes || 0))
    case 'mostSaved':
      return rows.sort((a, b) => Number(b.saveCount || b.counts?.saves || 0) - Number(a.saveCount || a.counts?.saves || 0))
    case 'mostDownloaded':
      return rows.sort((a, b) => Number(b.downloadCount || b.counts?.downloads || 0) - Number(a.downloadCount || a.counts?.downloads || 0))
    case 'mostCommented':
      return rows.sort((a, b) => Number(b.commentCount || b.counts?.comments || 0) - Number(a.commentCount || a.counts?.comments || 0))
    case 'featured':
      return rows.sort((a, b) => {
        if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1
        return toStamp(b) - toStamp(a)
      })
    case 'newest':
    default:
      return rows.sort((a, b) => toStamp(b) - toStamp(a))
  }
}

function getRangeFilterPlan(filters = {}, sort = 'featured') {
  const hasPriceRange = Number.isFinite(filters.minPriceCents) || Number.isFinite(filters.maxPriceCents)
  const hasContributorRange = Number.isFinite(filters.minContributorCount) && filters.minContributorCount > 0

  const priceSortDirection = sort === 'priceHigh' ? 'desc' : 'asc'
  const preferPriceRange = hasPriceRange
  const useContributorRangeInQuery = !preferPriceRange && hasContributorRange

  return {
    hasPriceRange,
    hasContributorRange,
    preferPriceRange,
    useContributorRangeInQuery,
    priceSortDirection,
    applyClientSort: (hasPriceRange && !['priceLow', 'priceHigh'].includes(sort))
      || (useContributorRangeInQuery && sort !== 'newest'),
    applyContributorClientFilter: preferPriceRange && hasContributorRange
  }
}

function buildProductsPageQuery({ filters = {}, sort = 'featured', pageSize = 10, cursor = null }) {
  const constraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  ]
  const rangePlan = getRangeFilterPlan(filters, sort)

  const firstToken = String(filters.searchToken || '').trim().toLowerCase()
  const categoryKey = String(filters.categoryKey || '').trim().toLowerCase()
  const genreKey = String(filters.genreKey || '').trim().toLowerCase()
  const daw = String(filters.daw || '').trim().toLowerCase()
  const format = String(filters.format || '').trim().toLowerCase()
  const tag = String(filters.tagKey || '').trim().toLowerCase()

  if (firstToken) {
    constraints.push(where('searchKeywords', 'array-contains', firstToken))
  } else if (categoryKey) {
    constraints.push(where('categoryKeys', 'array-contains', categoryKey))
  } else if (genreKey) {
    constraints.push(where('genreKeys', 'array-contains', genreKey))
  } else if (daw) {
    constraints.push(where('dawCompatibility', 'array-contains', daw))
  } else if (format) {
    constraints.push(where('formatKeys', 'array-contains', format))
  } else if (tag) {
    constraints.push(where('tagKeys', 'array-contains', tag))
  }

  if (filters.priceType === 'free') constraints.push(where('isFree', '==', true))
  if (filters.priceType === 'paid') constraints.push(where('isFree', '==', false))

  if (rangePlan.preferPriceRange) {
    if (Number.isFinite(filters.minPriceCents)) constraints.push(where('priceCents', '>=', filters.minPriceCents))
    if (Number.isFinite(filters.maxPriceCents)) constraints.push(where('priceCents', '<=', filters.maxPriceCents))
  } else if (rangePlan.useContributorRangeInQuery) {
    constraints.push(where('contributorCount', '>=', filters.minContributorCount))
  }

  if (rangePlan.preferPriceRange) {
    constraints.push(orderBy('priceCents', rangePlan.priceSortDirection), orderBy('createdAt', 'desc'))
  } else if (rangePlan.useContributorRangeInQuery) {
    constraints.push(orderBy('contributorCount', 'desc'), orderBy('createdAt', 'desc'))
  } else {
    constraints.push(...sortQueryFor(sort))
  }
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(pageSize))
  return {
    firestoreQuery: query(collection(db, FIRESTORE_COLLECTIONS.products), ...constraints),
    rangePlan
  }
}

export async function listPublicProductsPage({ filters = {}, sort = 'featured', pageSize = 10, cursor = null } = {}) {
  if (!db) return { products: [], nextCursor: null, hasMore: false }

  try {
    const { firestoreQuery, rangePlan } = buildProductsPageQuery({ filters, sort, pageSize, cursor })
    const snapshot = await getDocs(firestoreQuery)
    let products = await Promise.all(snapshot.docs.map(async (docSnap) => {
      const raw = docSnap.data()
      const media = await resolveProductMedia({ id: docSnap.id, ...raw })
      return normalizeProduct(docSnap.id, raw, media)
    }))

    if (rangePlan.applyContributorClientFilter) {
      products = products.filter((item) => Number(item.contributorCount || 0) >= Number(filters.minContributorCount || 0))
    }
    if (rangePlan.applyClientSort) {
      products = sortProductsClientSide(products, sort)
    }

    return {
      products,
      nextCursor: snapshot.docs[snapshot.docs.length - 1] || null,
      hasMore: snapshot.docs.length === pageSize
    }
  } catch (error) {
    const errorCode = String(error?.code || '')
    const isMissingIndex = errorCode === 'failed-precondition' || /index/i.test(String(error?.message || ''))

    if (!isDevelopmentRuntime) {
      warnOnce('fetch', '[productService] Production product query failed.', error?.message || error)
      if (isMissingIndex) {
        throw new Error('Products could not be loaded right now. Try refreshing in a moment.')
      }
      throw new Error('Products could not be loaded right now. Try refreshing in a moment.')
    }

    warnOnce('fetch', '[productService] Paginated product query failed; running dev-only lightweight fallback query.', error?.message || error)

    const fallbackConstraints = [
      where('status', '==', 'published'),
      where('visibility', '==', 'public')
    ]
    if (cursor) fallbackConstraints.push(startAfter(cursor))
    fallbackConstraints.push(limit(pageSize))

    try {
      const fallbackSnapshot = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.products), ...fallbackConstraints))
      const fallbackProducts = await Promise.all(fallbackSnapshot.docs.map(async (docSnap) => {
        const raw = docSnap.data()
        const media = await resolveProductMedia({ id: docSnap.id, ...raw })
        return normalizeProduct(docSnap.id, raw, media)
      }))

      return {
        products: sortProductsClientSide(fallbackProducts, sort),
        nextCursor: fallbackSnapshot.docs[fallbackSnapshot.docs.length - 1] || null,
        hasMore: fallbackSnapshot.docs.length === pageSize
      }
    } catch (fallbackError) {
      warnOnce('fetch', '[productService] Paginated product query failed. Missing Firestore index or invalid query.', fallbackError?.message || fallbackError)
      return { products: [], nextCursor: null, hasMore: false }
    }
  }
}

export async function listHomepageReleaseProducts() {
  const { products } = await listPublicProductsPage({ sort: 'featured', pageSize: 12 })
  return products
}

export async function getPublicProducts() {
  if (!db) return []

  try {
    // Legacy helper: avoid using this on large marketplace catalog pages.
    const snapshot = await getDocs(collection(db, FIRESTORE_COLLECTIONS.products))
    const rows = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((item) => item.status === 'published' && item.visibility === 'public')

    const products = await Promise.all(rows.map(async (row) => {
      const media = await resolveProductMedia({ id: row.id, ...row })
      return normalizeProduct(row.id, row, media)
    }))

    return products.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1
      const dateA = a.releasedAt || a.createdAt || ''
      const dateB = b.releasedAt || b.createdAt || ''
      return dateA < dateB ? 1 : -1
    })
  } catch (error) {
    warnOnce('fetch', '[productService] Failed to fetch products.', error?.message || error)
    return []
  }
}

export async function getProductById(productId) {
  if (!db || !productId) return null

  try {
    const productRef = doc(db, FIRESTORE_COLLECTIONS.products, productId)
    const snapshot = await getDoc(productRef)
    if (!snapshot.exists()) return null
    const raw = snapshot.data()
    const media = await resolveProductMedia({ id: productId, ...raw })
    return normalizeProduct(productId, raw, media)
  } catch (error) {
    warnOnce('fetch', '[productService] Failed to fetch product by id.', error?.message || error)
    return null
  }
}

export async function getProductShellById(productId) {
  if (!db || !productId) return null

  try {
    const productRef = doc(db, FIRESTORE_COLLECTIONS.products, productId)
    const snapshot = await getDoc(productRef)
    if (!snapshot.exists()) return null
    return normalizeProduct(productId, snapshot.data(), {})
  } catch (error) {
    warnOnce('fetch', '[productService] Failed to fetch product shell by id.', error?.message || error)
    return null
  }
}

function recommendationScore(baseProduct, candidate) {
  let score = 0
  const baseGenres = new Set(baseProduct.genreKeys || [])
  const baseCategories = new Set(baseProduct.categoryKeys || [])

  score += (candidate.genreKeys || []).reduce((total, key) => total + (baseGenres.has(key) ? 4 : 0), 0)
  score += (candidate.categoryKeys || []).reduce((total, key) => total + (baseCategories.has(key) ? 3 : 0), 0)

  if ((candidate.productType || '') === (baseProduct.productType || '')) score += 2
  if (candidate.artistId && candidate.artistId === baseProduct.artistId) score += 2
  if (candidate.featured) score += 1

  const freshness = new Date(candidate.releasedAt || candidate.createdAt || 0).getTime() || 0
  return score * 10000000000000 + freshness
}

export async function listRecommendedProducts({ product, pageSize = 8 } = {}) {
  if (!product?.id) return []

  const targetSize = Math.max(1, Math.min(Number(pageSize) || 8, 12))
  const { products } = await listPublicProductsPage({
    sort: 'featured',
    pageSize: Math.max(12, targetSize + 4)
  })

  if (!products.length) return []

  const scored = products
    .filter((candidate) => candidate.id !== product.id)
    .map((candidate) => ({ candidate, score: recommendationScore(product, candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, targetSize)
    .map((entry) => entry.candidate)

  return scored
}



function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getCreatorIdentity(user = null, input = {}) {
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {}
  const artistId = user?.uid || ''
  const artistName = String(profile.displayName || user?.displayName || 'Creator').trim() || 'Creator'
  const artistUsername = String(profile.username || profile.handle || '').trim()
  const artistProfilePath = artistId ? `profiles/${artistId}` : ''
  const artistAvatarURL = String(profile.avatarURL || profile.photoURL || user?.photoURL || '').trim()
  const artistPhotoURL = String(profile.photoURL || profile.avatarURL || user?.photoURL || '').trim()

  return {
    artistId,
    artistName,
    artistDisplayName: artistName,
    artistUsername,
    artistProfilePath,
    artistAvatarURL,
    artistPhotoURL
  }
}

export function buildProductPayload(input = {}, user = null) {
  const nowIso = new Date().toISOString()
  const slug = input.slug || slugify(input.title) || `product-${Date.now()}`
  const contributorNames = Array.isArray(input.contributorNames) ? input.contributorNames : parseCsv(input.contributorNames)
  const creator = getCreatorIdentity(user, input)
  const kindSettings = resolveKindSettings(input.productType, input.productKind, input.previewMode, input.distributionMode)
  const previewAudioPaths = toPathArray(input.previewAudioPaths)
  const previewVideoPaths = toPathArray(input.previewVideoPaths)
  const galleryPaths = toPathArray(input.galleryPaths)
  const primaryPreviewPath = input.primaryPreviewPath || previewAudioPaths[0] || previewVideoPaths[0] || ''
  const primaryPreviewType = input.primaryPreviewType || (primaryPreviewPath ? (previewAudioPaths.includes(primaryPreviewPath) ? 'audio' : 'video') : '')
  const deliverableRows = Array.isArray(input.deliverableFiles) ? input.deliverableFiles : []
  const computedAssetSummary = {
    totalFiles: Number(input.assetSummary?.totalFiles ?? deliverableRows.length ?? 0),
    totalBytes: Number(input.assetSummary?.totalBytes ?? deliverableRows.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0)),
    previewableCount: Number(input.assetSummary?.previewableCount ?? deliverableRows.filter((row) => row.canPreview).length ?? 0),
    downloadableCount: Number(input.assetSummary?.downloadableCount ?? deliverableRows.filter((row) => row.isDownloadable !== false).length ?? 0)
  }
  const previewAssignment = normalizePreviewAssignment(input.previewAssignment || {}, input.productType)

  return {
    id: input.id || slug,
    slug,
    status: input.status || 'draft',
    visibility: input.visibility || 'private',
    title: input.title || '',
    shortDescription: input.shortDescription || '',
    description: input.description || '',
    version: input.version || '',
    usageLicense: input.usageLicense || '',
    productType: input.productType || 'Sample Pack',
    productKind: kindSettings.productKind,
    previewMode: kindSettings.previewMode,
    distributionMode: kindSettings.distributionMode,
    categories: Array.isArray(input.categories) ? input.categories : parseCsv(input.categories),
    genres: Array.isArray(input.genres) ? input.genres : parseCsv(input.genres),
    tags: Array.isArray(input.tags) ? input.tags : parseCsv(input.tags),
    artistId: creator.artistId,
    artistName: creator.artistName,
    artistDisplayName: creator.artistDisplayName,
    artistUsername: creator.artistUsername,
    artistProfilePath: creator.artistProfilePath,
    artistAvatarURL: creator.artistAvatarURL,
    artistPhotoURL: creator.artistPhotoURL,
    contributorIds: Array.isArray(input.contributorIds) ? input.contributorIds : parseCsv(input.contributorIds),
    contributorNames,
    coverPath: input.coverPath || '',
    thumbnailPath: input.thumbnailPath || '',
    coverURL: input.coverURL || '',
    thumbnailURL: input.thumbnailURL || '',
    galleryPaths,
    previewAudioPaths,
    previewVideoPaths,
    downloadPath: input.downloadPath || '',
    licensePath: input.licensePath || '',
    assetSummary: computedAssetSummary,
    primaryPreviewPath,
    primaryPreviewType,
    primaryPreviewDuration: Number(input.primaryPreviewDuration || 0),
    primaryDownloadPath: input.primaryDownloadPath || input.downloadPath || '',
    primaryDownloadBytes: Number(input.primaryDownloadBytes || 0),
    previewAssignment,
    priceCents: Number.isFinite(input.priceCents) ? input.priceCents : 0,
    payoutTargetCents: Number.isFinite(input.payoutTargetCents)
      ? input.payoutTargetCents
      : Number.isFinite(input.priceCents) ? input.priceCents : 0,
    currency: input.currency || 'USD',
    isFree: Boolean(input.isFree),
    titleLower: String(input.title || '').toLowerCase(),
    artistNameLower: String(creator.artistName || '').toLowerCase(),
    artistUsernameLower: String(creator.artistUsername || '').toLowerCase(),
    searchKeywords: Array.from(new Set([
      ...parseCsv(input.searchKeywords),
      ...String(input.title || '').toLowerCase().split(/\s+/),
      ...String(creator.artistName || '').toLowerCase().split(/\s+/),
      ...String(creator.artistUsername || '').toLowerCase().split(/\s+/),
      ...parseCsv(input.tags).map((tag) => String(tag).toLowerCase()),
      ...parseCsv(input.genres).map((genre) => String(genre).toLowerCase()),
      ...parseCsv(input.categories).map((category) => String(category).toLowerCase())
    ].map((token) => token.trim()).filter((token) => token.length > 1))),
    categoryKeys: (Array.isArray(input.categories) ? input.categories : parseCsv(input.categories)).map(normalizeKey).filter(Boolean),
    genreKeys: (Array.isArray(input.genres) ? input.genres : parseCsv(input.genres)).map(normalizeKey).filter(Boolean),
    tagKeys: (Array.isArray(input.tags) ? input.tags : parseCsv(input.tags)).map(normalizeKey).filter(Boolean),
    dawCompatibility: (Array.isArray(input.dawCompatibility) ? input.dawCompatibility : parseCsv(input.dawCompatibility)).map(normalizeKey).filter(Boolean),
    formatKeys: (Array.isArray(input.formatKeys) ? input.formatKeys : parseCsv(input.formatKeys)).map(normalizeKey).filter(Boolean),
    contributorCount: Number(input.contributorCount || (Array.isArray(input.contributorIds) ? input.contributorIds.length : parseCsv(input.contributorIds).length)),
    sellerAgreement: input.sellerAgreement && typeof input.sellerAgreement === 'object' ? input.sellerAgreement : null,
    sellerAgreementAccepted: Boolean(input.sellerAgreementAccepted),
    sellerAgreementVersion: String(input.sellerAgreementVersion || ''),
    releasedAt: input.releasedAt || null,
    createdAt: input.createdAt || nowIso,
    updatedAt: nowIso
  }
}

function createProductId() {
  if (!db) return `product-${Date.now()}`
  return doc(collection(db, FIRESTORE_COLLECTIONS.products)).id
}

const PLACEHOLDER_PRODUCT_IDS = new Set(['test', 'temp', 'tmp', 'placeholder', 'fake'])
const CLIENT_PROTECTED_PRODUCT_KEYS = [
  'likeCount', 'dislikeCount', 'saveCount', 'downloadCount', 'commentCount', 'shareCount', 'followCount', 'counts',
  'featured', 'promoted', 'moderationStatus', 'moderationSummary', 'moderationReasons', 'reviewedAt', 'reviewedBy',
  'publishedAt', 'salesCount', 'revenue', 'entitlementCount'
]
const CLIENT_STRIPPED_PRODUCT_KEYS = [
  'price',
  'priceLabel',
  'mediaFiles',
  'deliverableFiles',
  'folderDeliverables',
  'previewAudioURLs',
  'previewVideoURLs',
  'galleryURLs',
  'primaryPreviewURL',
  'blobURL',
  'objectURL',
  'localPreviewURL',
  'previewURL'
]
const FIRESTORE_PRODUCT_CLIENT_ALLOWED_KEYS = new Set([
  'id', 'slug', 'status', 'visibility',
  'title', 'shortDescription', 'description', 'version', 'usageLicense', 'productType', 'productKind', 'previewMode', 'distributionMode',
  'categories', 'genres', 'tags', 'categoryKeys', 'genreKeys', 'tagKeys', 'searchKeywords',
  'artistId', 'artistName', 'artistDisplayName', 'artistUsername', 'artistProfilePath', 'artistAvatarURL', 'artistPhotoURL', 'artistNameLower', 'artistUsernameLower',
  'contributorIds', 'contributorNames', 'contributors', 'contributorCount', 'pendingContributorIds', 'contributorRequestCount', 'sellerAgreement', 'sellerAgreementAccepted', 'sellerAgreementVersion',
  'coverPath', 'thumbnailPath', 'coverURL', 'thumbnailURL', 'galleryPaths', 'previewAudioPaths', 'previewVideoPaths', 'downloadPath', 'deliverableFiles', 'licensePath', 'assetSummary',
  'primaryPreviewPath', 'primaryPreviewType', 'primaryPreviewDuration', 'primaryDownloadPath', 'primaryDownloadBytes', 'previewAssignment',
  'priceCents', 'payoutTargetCents', 'currency', 'isFree', 'saleEnabled', 'storefrontVisible',
  'dawCompatibility', 'formatKeys', 'formatNotes', 'compatibilityNotes', 'includedFiles',
  'releasedAt', 'createdAt', 'updatedAt'
])

function sanitizeClientProductDraftPayload(payload = {}) {
  const sanitized = {}
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (FIRESTORE_PRODUCT_CLIENT_ALLOWED_KEYS.has(key)) sanitized[key] = value
  })
  CLIENT_PROTECTED_PRODUCT_KEYS.forEach((key) => delete sanitized[key])
  CLIENT_STRIPPED_PRODUCT_KEYS.forEach((key) => delete sanitized[key])
  return sanitized
}

function logDraftFirestoreWrite({
  operation = '',
  path = '',
  user = null,
  productId = '',
  payload = null,
  batchTargets = []
} = {}) {
  if (!isDevelopmentRuntime) return
  console.debug('[productService] draft write diagnostic', {
    operation,
    path,
    uid: user?.uid || null,
    productId: productId || null,
    payloadId: payload?.id || null,
    payloadArtistId: payload?.artistId || null,
    payloadStatus: payload?.status || null,
    payloadVisibility: payload?.visibility || null,
    payloadKeys: payload ? Object.keys(payload).sort() : [],
    payload: payload || null,
    batchTargets
  })
}

function getPayloadFieldTypes(payload = {}) {
  return Object.fromEntries(Object.entries(payload || {}).map(([key, value]) => {
    let type = typeof value
    if (Array.isArray(value)) type = 'array'
    else if (value === null) type = 'null'
    return [key, type]
  }))
}

function buildProductShellDiagnostics({ user = null, productId = '', payload = null } = {}) {
  return {
    uid: user?.uid || null,
    productId: productId || null,
    payloadId: payload?.id || null,
    payloadArtistId: payload?.artistId || null,
    payloadStatus: payload?.status || null,
    payloadVisibility: payload?.visibility || null,
    payloadTitle: payload?.title || null,
    payloadSlug: payload?.slug || null,
    payloadKeys: payload ? Object.keys(payload).sort() : [],
    fieldTypes: payload ? getPayloadFieldTypes(payload) : {}
  }
}

function withoutUndefinedValues(payload = {}) {
  return Object.fromEntries(Object.entries(payload || {}).filter(([, value]) => value !== undefined))
}

function createStageError(stage, message, cause = null) {
  const error = new Error(message)
  error.stage = stage
  error.cause = cause || undefined
  error.code = cause?.code || error.code
  return error
}

async function waitForDraftDocument(productId, attempts = 4, delayMs = 120) {
  if (!db || !productId) return false

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await getDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId))
    if (snapshot.exists()) return true
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return false
}

async function getProductShellExistsForDiagnostics(productId = '') {
  if (!db || !productId) return null
  try {
    const snapshot = await getDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId))
    return snapshot.exists()
  } catch (error) {
    return `unknown:${error?.code || error?.message || 'read-failed'}`
  }
}

async function getProductParentDiagnostics(productId = '') {
  if (!db || !productId) return { parentExists: null, parentArtistId: null, parentStatus: null, parentVisibility: null }
  try {
    const snapshot = await getDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId))
    const data = snapshot.exists() ? (snapshot.data() || {}) : {}
    return {
      parentExists: snapshot.exists(),
      parentArtistId: data.artistId || null,
      parentStatus: data.status || null,
      parentVisibility: data.visibility || null
    }
  } catch (error) {
    return {
      parentExists: `unknown:${error?.code || error?.message || 'read-failed'}`,
      parentArtistId: null,
      parentStatus: null,
      parentVisibility: null
    }
  }
}

export function isPlaceholderProductId(productId = '') {
  const normalized = String(productId || '').trim().toLowerCase()
  if (!normalized) return true
  if (PLACEHOLDER_PRODUCT_IDS.has(normalized)) return true
  return normalized.startsWith('test-') || normalized.startsWith('temp-') || normalized.startsWith('fake-')
}

async function ensureDraftProductDocument(user, input = {}, productId = '') {
  if (!db || !user?.uid || !productId) return
  const creator = getCreatorIdentity(user, input)

  const payload = {
    id: productId,
    artistId: creator.artistId || user.uid,
    artistName: creator.artistName,
    artistDisplayName: creator.artistDisplayName,
    artistUsername: creator.artistUsername,
    artistProfilePath: creator.artistProfilePath,
    artistAvatarURL: creator.artistAvatarURL,
    artistPhotoURL: creator.artistPhotoURL,
    title: String(input.title || '').trim() || 'Untitled product',
    productType: input.productType || 'Sample Pack',
    slug: input.slug || productId,
    status: 'draft',
    visibility: input.visibility === 'public' ? 'unlisted' : (input.visibility || 'private')
  }
  logDraftFirestoreWrite({
    operation: 'callable ensureDraftProductDocument',
    path: `${FIRESTORE_COLLECTIONS.products}/${productId}`,
    user,
    productId,
    payload
  })
  await createOrUpdateProductShell(payload, user)
}

export async function uploadProductMediaFiles(productId, mediaFiles = {}) {
  if (!storage || !productId) return {}
  const uploads = {}

  if (mediaFiles.cover instanceof File) {
    try {
      const coverPath = STORAGE_PATHS.productCover(productId)
      await uploadBytes(ref(storage, coverPath), mediaFiles.cover, { contentType: mediaFiles.cover.type || 'image/webp' })
      uploads.coverPath = coverPath
      uploads.coverURL = await safeStorageUrl(coverPath)
    } catch (error) {
      throw createStageError('cover-upload', 'Cover upload failed.', error)
    }
  }

  if (mediaFiles.thumbnail instanceof File) {
    try {
      const thumbnailPath = STORAGE_PATHS.productThumb(productId)
      await uploadBytes(ref(storage, thumbnailPath), mediaFiles.thumbnail, { contentType: mediaFiles.thumbnail.type || 'image/webp' })
      uploads.thumbnailPath = thumbnailPath
      uploads.thumbnailURL = await safeStorageUrl(thumbnailPath)
    } catch (error) {
      throw createStageError('thumbnail-upload', 'Thumbnail upload failed.', error)
    }
  }

  return uploads
}

function sanitizeStorageFileName(name = '') {
  return String(name || 'file')
    .trim()
    .replace(/[^\w.\-() ]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 160) || `file-${Date.now()}`
}

function normalizePriceFields(draft = {}) {
  const rawPriceCents = Number(draft.priceCents)
  const rawPayoutTargetCents = Number(draft.payoutTargetCents)
  const priceCents = Number.isFinite(rawPriceCents) ? Math.max(0, Math.round(rawPriceCents)) : 0
  const payoutTargetCents = Number.isFinite(rawPayoutTargetCents) ? Math.max(0, Math.round(rawPayoutTargetCents)) : priceCents
  const currency = String(draft.currency || 'USD').trim().toUpperCase() || 'USD'
  return { priceCents, payoutTargetCents, isFree: priceCents === 0, currency }
}

function normalizeFileKind(raw = '', mimeType = '') {
  const key = normalizeKey(raw)
  if (key) return key
  if (String(mimeType).startsWith('audio/')) return 'audio'
  if (String(mimeType).startsWith('video/')) return 'video'
  if (String(mimeType).startsWith('image/')) return 'image'
  return 'file'
}

export function normalizeProductFile(fileId, raw = {}) {
  const displayPath = String(raw.displayPath || raw.name || fileId || '')
  const parentPath = String(raw.parentPath || (displayPath.includes('/') ? displayPath.split('/').slice(0, -1).join('/') : ''))
  return {
    id: raw.id || fileId,
    productId: raw.productId || '',
    name: raw.name || displayPath.split('/').pop() || 'file',
    displayPath,
    parentPath,
    kind: normalizeFileKind(raw.kind, raw.mimeType),
    mimeType: raw.mimeType || raw.contentType || 'application/octet-stream',
    contentType: raw.contentType || raw.mimeType || 'application/octet-stream',
    description: raw.description || '',
    category: raw.category || '',
    role: raw.role || '',
    sizeBytes: Number(raw.sizeBytes || 0),
    storagePath: raw.storagePath || '',
    previewPath: raw.previewPath || '',
    previewMimeType: raw.previewMimeType || '',
    publicPreviewPath: raw.publicPreviewPath || raw.previewPath || '',
    publicPreviewURL: raw.publicPreviewURL || '',
    durationSeconds: Number(raw.durationSeconds || 0),
    bpm: Number(raw.bpm || 0) || null,
    musicalKey: raw.musicalKey || '',
    platform: raw.platform || '',
    daw: raw.daw || '',
    version: raw.version || '',
    canPreview: Boolean(raw.canPreview),
    isDownloadable: raw.isDownloadable !== false,
    isDeliverable: raw.isDeliverable !== false,
    isPublicPreview: Boolean(raw.isPublicPreview),
    sortIndex: Number(raw.sortIndex || 0),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt)
  }
}

export function normalizeProductContributor(contributorId, raw = {}) {
  return {
    uid: raw.uid || contributorId,
    displayName: raw.displayName || '',
    username: raw.username || '',
    avatarURL: raw.avatarURL || raw.photoURL || '',
    role: raw.role || '',
    status: raw.status || 'pending',
    requestedBy: raw.requestedBy || '',
    requestedAt: toIsoDate(raw.requestedAt),
    respondedAt: toIsoDate(raw.respondedAt),
    decision: raw.decision || (raw.status === 'accepted' ? 'accepted' : raw.status === 'denied' ? 'denied' : 'pending'),
    decisionAt: toIsoDate(raw.decisionAt),
    updatedAt: toIsoDate(raw.updatedAt)
  }
}

export async function listProductContributors(productId = '') {
  if (!db || !productId) return []
  const snapshot = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.products, productId, 'contributors'), orderBy('updatedAt', 'desc'), limit(500)))
  return snapshot.docs.map((docSnap) => normalizeProductContributor(docSnap.id, docSnap.data()))
}

export function subscribeToProductContributors(productId = '', callback = () => {}, onError = null) {
  if (!db || !productId || typeof callback !== 'function') return () => {}
  return onSnapshot(
    query(collection(db, FIRESTORE_COLLECTIONS.products, productId, 'contributors'), orderBy('updatedAt', 'desc'), limit(500)),
    (snapshot) => callback(snapshot.docs.map((docSnap) => normalizeProductContributor(docSnap.id, docSnap.data()))),
    (error) => { if (typeof onError === 'function') onError(error) }
  )
}

export async function addProductContributorRequest({ productId = '', ownerUid = '', targetProfile = {}, role = '' } = {}) {
  if (!db || !productId || !ownerUid || !targetProfile?.uid) return null
  const ref = doc(db, FIRESTORE_COLLECTIONS.products, productId, 'contributors', targetProfile.uid)
  await setDoc(ref, {
    uid: targetProfile.uid,
    displayName: targetProfile.displayName || targetProfile.username || 'Contributor',
    username: targetProfile.username || '',
    avatarURL: targetProfile.avatarURL || targetProfile.photoURL || '',
    role: role || '',
    status: 'pending',
    requestedBy: ownerUid,
    requestedAt: serverTimestamp(),
    decision: 'pending',
    updatedAt: serverTimestamp()
  }, { merge: true })
  return targetProfile.uid
}

export async function removeProductContributorRequest({ productId = '', ownerUid = '', targetUid = '' } = {}) {
  if (!db || !productId || !ownerUid || !targetUid) return
  await setDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId, 'contributors', targetUid), {
    status: 'removed',
    decision: 'pending',
    updatedAt: serverTimestamp()
  }, { merge: true })
}

export async function updateProductContributorRole({ productId = '', ownerUid = '', targetUid = '', role = '' } = {}) {
  if (!db || !productId || !ownerUid || !targetUid) return
  await setDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId, 'contributors', targetUid), { role: role || '', updatedAt: serverTimestamp() }, { merge: true })
}

export async function recalculateAcceptedContributors(productId = '') {
  if (!db || !productId) return { contributorIds: [], contributorNames: [], contributorCount: 0 }
  const contributors = await listProductContributors(productId)
  const accepted = contributors.filter((row) => row.status === 'accepted' || row.decision === 'accepted')
  const contributorIds = accepted.map((row) => row.uid).filter(Boolean)
  const contributorNames = accepted.map((row) => row.displayName).filter(Boolean)
  await setDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId), {
    contributorIds,
    contributorNames,
    contributorCount: contributorIds.length,
    pendingContributorIds: contributors.filter((row) => row.status === 'pending').map((row) => row.uid),
    contributorRequestCount: contributors.length,
    updatedAt: serverTimestamp()
  }, { merge: true })
  return { contributorIds, contributorNames, contributorCount: contributorIds.length }
}

export async function listProductFiles(productId = '') {
  if (!db || !productId) return []
  const snapshot = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.products, productId, 'files'), orderBy('sortIndex', 'asc'), limit(500)))
  return snapshot.docs.map((docSnap) => normalizeProductFile(docSnap.id, docSnap.data()))
}

export function subscribeToProductFiles(productId = '', callback = () => {}, onError = null) {
  if (!db || !productId || typeof callback !== 'function') return () => {}
  return onSnapshot(
    query(collection(db, FIRESTORE_COLLECTIONS.products, productId, 'files'), orderBy('sortIndex', 'asc'), limit(500)),
    (snapshot) => callback(snapshot.docs.map((docSnap) => normalizeProductFile(docSnap.id, docSnap.data()))),
    (error) => { if (typeof onError === 'function') onError(error) }
  )
}

export async function uploadProductFiles(productId, files = [], options = {}) {
  if (!storage || !productId) return []
  const uploaded = []
  const shouldUseSubfolder = Boolean(options.useSubfolder)
  let totalBytes = 0

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    if (!(file instanceof File)) continue
    if (file.size > PRODUCT_QUOTAS.maxSingleDeliverableBytes) {
      throw createStageError('deliverable-upload', 'This file exceeds the 512 MB single-file limit.')
    }
    totalBytes += Number(file.size || 0)
    if (totalBytes > PRODUCT_QUOTAS.maxTotalDeliverableBytes) {
      throw createStageError('deliverable-upload', 'This product exceeds the 1 GB deliverable limit.')
    }
    const fileId = options.fileIdFactory ? options.fileIdFactory(file, index) : doc(collection(db, FIRESTORE_COLLECTIONS.products)).id
    const baseName = sanitizeStorageFileName(file.name)
    const storagePath = shouldUseSubfolder
      ? `products/${productId}/files/${fileId}/${baseName}`
      : `products/${productId}/downloads/${baseName}`
    await uploadBytes(ref(storage, storagePath), file, { contentType: file.type || 'application/octet-stream' })
    uploaded.push({
      id: fileId,
      productId,
      name: file.name,
      displayPath: file.webkitRelativePath || file.name,
      parentPath: String(file.webkitRelativePath || '').includes('/') ? file.webkitRelativePath.split('/').slice(0, -1).join('/') : '',
      kind: normalizeFileKind('', file.type),
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: Number(file.size || 0),
      storagePath,
      publicPreviewPath: '',
      publicPreviewURL: '',
      platform: '',
      daw: '',
      version: '',
      canPreview: String(file.type || '').startsWith('audio/'),
      isDeliverable: true,
      isDownloadable: true,
      isPublicPreview: false,
      sortIndex: index
    })
  }
  return uploaded
}

export async function saveProductFileManifest(productId, fileRows = [], user = null) {
  if (!db || !productId) return
  const filesCol = collection(db, FIRESTORE_COLLECTIONS.products, productId, 'files')
  const batch = writeBatch(db)
  fileRows.forEach((row, index) => {
    const id = row.id || doc(filesCol).id
    const filePayload = {
      ...row,
      id,
      productId,
      sortIndex: Number(row.sortIndex ?? index),
      updatedAt: serverTimestamp(),
      createdAt: row.createdAt || serverTimestamp()
    }
    batch.set(doc(filesCol, id), filePayload, { merge: true })
  })
  logDraftFirestoreWrite({
    operation: 'batch.commit saveProductFileManifest',
    path: `${FIRESTORE_COLLECTIONS.products}/${productId}/files/*`,
    user,
    productId,
    payload: null,
    batchTargets: fileRows.map((row, index) => {
      const id = row.id || `generated-${index}`
      return {
        path: `${FIRESTORE_COLLECTIONS.products}/${productId}/files/${id}`,
        payloadKeys: Object.keys({
          ...row,
          id,
          productId,
          sortIndex: Number(row.sortIndex ?? index),
          updatedAt: true,
          createdAt: true
        }).sort()
      }
    })
  })
  await batch.commit()
}

export async function initializeProductDraft(user, input = {}, requestedId = '') {
  if (!db || !user?.uid) throw new Error('Authenticated user required.')
  const productId = !isPlaceholderProductId(requestedId) ? requestedId : ''
  const basePayload = buildProductPayload({ ...input, ...(productId ? { id: productId } : {}) }, user)
  if (!productId) delete basePayload.id
  const shell = await createOrUpdateProductShell(basePayload, user)
  return { productId: shell.productId, created: Boolean(shell.created) }
}

export async function saveProductDraft(user, input = {}, options = {}) {
  if (!db || !user?.uid) throw new Error('Authenticated user required.')
  if (!String(input?.title || '').trim()) throw new Error('Add a product title before saving this draft.')

  let saveStep = 'starting'
  const rawId = String(options.productId || input.id || '').trim()
  const slugId = slugify(input?.slug || input?.title || '')
  const existingId = rawId && !isPlaceholderProductId(rawId) ? rawId : ''
  const hasExistingId = Boolean(existingId)
  let productId = existingId
  let productRef = productId ? doc(db, FIRESTORE_COLLECTIONS.products, productId) : null
  let created = !hasExistingId
  let payload = null
  try {
    let existing = {}
    if (hasExistingId) {
      saveStep = 'initial-existing-product-read'
      const initialSnapshot = await getDoc(productRef)
      created = !initialSnapshot.exists()
      existing = initialSnapshot.data() || {}
    }
    const creator = getCreatorIdentity(user, input)
    const ownerPayload = {
      ...(productId ? { id: productId } : {}),
      slug: String(input.slug || existing.slug || slugId || productId || ''),
      status: 'draft',
      visibility: 'private',
      title: String(input.title || existing.title || '').trim() || 'Untitled product',
      shortDescription: String(input.shortDescription || existing.shortDescription || ''),
      description: String(input.description || existing.description || ''),
      productType: String(input.productType || existing.productType || 'Sample Pack'),
      artistId: user.uid,
      artistName: String(existing.artistName || creator.artistName || 'Creator'),
      artistDisplayName: String(existing.artistDisplayName || creator.artistDisplayName || creator.artistName || 'Creator'),
      artistUsername: String(existing.artistUsername || creator.artistUsername || ''),
      artistProfilePath: String(existing.artistProfilePath || creator.artistProfilePath || ''),
      artistAvatarURL: String(existing.artistAvatarURL || creator.artistAvatarURL || ''),
      artistPhotoURL: String(existing.artistPhotoURL || creator.artistPhotoURL || '')
    }
    saveStep = 'pre-save-owner-doc-callable'
    if (isDevelopmentRuntime) {
      console.info('[productService] draft pre-save owner doc', {
        path: productId ? `${FIRESTORE_COLLECTIONS.products}/${productId}` : `${FIRESTORE_COLLECTIONS.products}/(server-generated)`,
        uid: user.uid,
        productId: productId || null,
        title: ownerPayload.title,
        slug: ownerPayload.slug
      })
    }
    const shellResult = await createOrUpdateProductShell(ownerPayload, user)
    productId = shellResult.productId
    productRef = doc(db, FIRESTORE_COLLECTIONS.products, productId)
    created = Boolean(shellResult.created)
    if (typeof options.onStatus === 'function' && created) options.onStatus('Draft document created.')
  } catch (error) {
    console.error('[productService] draft save failed', {
      saveStep,
      code: error?.code,
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      productId,
      uid: user?.uid || null,
      payloadId: payload?.id || null,
      payloadArtistId: payload?.artistId || null,
      payloadStatus: payload?.status || null,
      payloadKeys: payload ? Object.keys(payload).sort() : [],
      payload
    })
    throw createStageError('draft-initialization', 'Draft initialization failed.', error)
  }

  const creator = getCreatorIdentity(user, input)
  const basePayload = buildProductPayload({ ...input, ...creator, id: productId }, user)
  let mediaUploads = {}
  try {
    saveStep = 'upload-cover'
    if (isDevelopmentRuntime) {
      console.info('[productService] uploading product media', { productId, paths: { cover: STORAGE_PATHS.productCover(productId) } })
    }
    if (typeof options.onStatus === 'function' && options.mediaFiles?.cover) {
      options.onStatus('Cover upload started.')
    }
    saveStep = 'upload-thumbnail'
    if (isDevelopmentRuntime) {
      console.info('[productService] uploading product media', { productId, paths: { thumbnail: STORAGE_PATHS.productThumb(productId) } })
    }
    if (typeof options.onStatus === 'function' && options.mediaFiles?.thumbnail) {
      options.onStatus('Thumbnail upload started.')
    }
    mediaUploads = await uploadProductMediaFiles(productId, options.mediaFiles || {})
    if (typeof options.onStatus === 'function' && mediaUploads.coverPath) {
      options.onStatus('Cover uploaded successfully.')
    }
    if (typeof options.onStatus === 'function' && mediaUploads.thumbnailPath) {
      options.onStatus('Thumbnail uploaded successfully.')
    }
  } catch (error) {
    throw error?.stage ? error : createStageError('media-upload', 'Media upload failed.', error)
  }

  let galleryUploads = []
  let previewAudioUploads = []
  let previewVideoUploads = []
  let deliverableUploads = []
  let fileManifestRows = Array.isArray(options.fileManifestRows) ? options.fileManifestRows : []
  try {
    if (Array.isArray(options.galleryFiles) && options.galleryFiles.length) {
      saveStep = 'upload-gallery'
      if (typeof options.onStatus === 'function') options.onStatus('Gallery upload started.')
      galleryUploads = await Promise.all(options.galleryFiles.map(async (file, index) => {
        const path = `${STORAGE_PATHS.productGalleryRoot(productId)}/${Date.now()}-${index}-${sanitizeStorageFileName(file.name)}`
        await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/*' })
        return path
      }))
    }
    if (Array.isArray(options.previewAudioFiles) && options.previewAudioFiles.length) {
      saveStep = 'upload-preview-audio'
      if (typeof options.onStatus === 'function') options.onStatus('Preview upload started.')
      previewAudioUploads = await Promise.all(options.previewAudioFiles.map(async (file, index) => {
        if (file.size > PRODUCT_QUOTAS.maxPreviewAudioBytes) {
          throw createStageError('preview-audio-upload', 'Preview audio upload failed.')
        }
        const path = `${STORAGE_PATHS.productAudioPreviewsRoot(productId)}/${Date.now()}-${index}-${sanitizeStorageFileName(file.name)}`
        await uploadBytes(ref(storage, path), file, { contentType: file.type || 'audio/*' })
        return path
      }))
    }
    if (Array.isArray(options.previewVideoFiles) && options.previewVideoFiles.length) {
      saveStep = 'upload-preview-video'
      if (typeof options.onStatus === 'function') options.onStatus('Preview upload started.')
      previewVideoUploads = await Promise.all(options.previewVideoFiles.map(async (file, index) => {
        if (file.size > PRODUCT_QUOTAS.maxPreviewVideoBytes) {
          throw createStageError('preview-video-upload', 'Preview video upload failed.')
        }
        const path = `${STORAGE_PATHS.productVideoPreviewsRoot(productId)}/${Date.now()}-${index}-${sanitizeStorageFileName(file.name)}`
        await uploadBytes(ref(storage, path), file, { contentType: file.type || 'video/*' })
        return path
      }))
    }
  } catch (error) {
    throw createStageError('preview-upload', 'Preview upload failed.', error)
  }

  try {
    if (Array.isArray(options.deliverableFiles) && options.deliverableFiles.length) {
      saveStep = 'upload-download'
      if (typeof options.onStatus === 'function') options.onStatus('Deliverable upload started.')
      deliverableUploads = await uploadProductFiles(productId, options.deliverableFiles, { useSubfolder: true })
      fileManifestRows = [...fileManifestRows, ...deliverableUploads]
    }
  } catch (error) {
    throw createStageError('deliverable-upload', 'Deliverable upload failed.', error)
  }

  try {
    if (fileManifestRows.length) {
      saveStep = 'file-manifest-save'
      await saveProductFileManifest(productId, fileManifestRows, user)
      if (typeof options.onStatus === 'function') options.onStatus('File manifest saved.')
    }
  } catch (error) {
    throw createStageError('file-manifest-save', 'File manifest save failed.', error)
  }

  const desiredStatus = options.status || basePayload.status || 'draft'
  const editingPublishedListing = input.currentStatus === 'published' || basePayload.status === 'published'
  const normalizedStatus = editingPublishedListing ? 'review_pending' : (desiredStatus === 'published' ? 'review_pending' : desiredStatus)
  payload = sanitizeClientProductDraftPayload({
    ...basePayload,
    id: productId,
    ...creator,
    artistId: user.uid,
    artistDisplayName: creator.artistDisplayName || creator.artistName || '',
    status: normalizedStatus,
    visibility: basePayload.visibility || 'private',
    coverPath: mediaUploads.coverPath || basePayload.coverPath,
    thumbnailPath: mediaUploads.thumbnailPath || basePayload.thumbnailPath,
    galleryPaths: galleryUploads.length ? galleryUploads : basePayload.galleryPaths,
    previewAudioPaths: previewAudioUploads.length ? previewAudioUploads : basePayload.previewAudioPaths,
    previewVideoPaths: previewVideoUploads.length ? previewVideoUploads : basePayload.previewVideoPaths,
    primaryPreviewPath: options.previewAssignment?.hoverAudioPath || options.previewAssignment?.hoverVideoPath || previewAudioUploads[0] || previewVideoUploads[0] || basePayload.primaryPreviewPath || '',
    primaryPreviewType: options.previewAssignment?.hoverAudioPath ? 'audio' : (options.previewAssignment?.hoverVideoPath ? 'video' : (previewAudioUploads[0] ? 'audio' : (previewVideoUploads[0] ? 'video' : basePayload.primaryPreviewType || ''))),
    primaryDownloadPath: deliverableUploads[0]?.storagePath || basePayload.primaryDownloadPath || basePayload.downloadPath || '',
    primaryDownloadBytes: deliverableUploads[0]?.sizeBytes || basePayload.primaryDownloadBytes || 0,
    assetSummary: {
      totalFiles: fileManifestRows.length || basePayload.assetSummary?.totalFiles || 0,
      totalBytes: fileManifestRows.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0) || basePayload.assetSummary?.totalBytes || 0,
      previewableCount: fileManifestRows.filter((row) => row.canPreview).length || basePayload.assetSummary?.previewableCount || 0,
      downloadableCount: fileManifestRows.filter((row) => row.isDownloadable !== false).length || basePayload.assetSummary?.downloadableCount || 0
    },
    previewAssignment: normalizePreviewAssignment({
      ...(basePayload.previewAssignment || {}),
      ...(options.previewAssignment || {}),
      hoverAudioPath: options.previewAssignment?.hoverAudioPath || previewAudioUploads[0] || basePayload.previewAssignment?.hoverAudioPath || '',
      hoverVideoPath: options.previewAssignment?.hoverVideoPath || previewVideoUploads[0] || basePayload.previewAssignment?.hoverVideoPath || ''
    }, basePayload.productType),
    updatedAt: serverTimestamp(),
    createdAt: options.isNew ? serverTimestamp() : basePayload.createdAt || serverTimestamp()
  })
  const isSubmittingForReview = desiredStatus === 'published'
  if (!isSubmittingForReview && !String(input.title || '').trim()) {
    delete payload.title
  }
  if (!isSubmittingForReview && !String(input.productType || '').trim()) {
    delete payload.productType
  }
  payload.id = productId
  payload.artistId = user.uid

  logDraftFirestoreWrite({
    operation: 'setDoc saveProductDraft final-firestore-merge',
    path: `${FIRESTORE_COLLECTIONS.products}/${productId}`,
    user,
    productId,
    payload
  })
  if (isDevelopmentRuntime) {
    console.info('[productService] draft final save', {
      path: `${FIRESTORE_COLLECTIONS.products}/${productId}`,
      productId,
      payloadId: payload.id,
      uid: user?.uid || null,
      artistId: payload.artistId,
      status: payload.status,
      keys: Object.keys(payload).sort()
    })
  }
  try {
    saveStep = 'final-product-save'
    await setDoc(productRef, payload, { merge: true })
    if (typeof options.onStatus === 'function') {
      options.onStatus('Final product metadata saved.')
    }
  } catch (error) {
    console.error('[productService] draft save failed', {
      saveStep,
      code: error?.code,
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      productId,
      uid: user?.uid || null,
      payloadId: payload?.id || null,
      payloadArtistId: payload?.artistId || null,
      payloadStatus: payload?.status || null,
      payloadKeys: payload ? Object.keys(payload).sort() : [],
      payload
    })
    throw createStageError('final-firestore-merge', 'Final product metadata save failed.', error)
  }

  return {
    id: productId,
    productId,
    payload,
    mediaUploads,
    galleryUploads,
    previewAudioUploads,
    previewVideoUploads,
    deliverableUploads,
    draftCreated: created
  }
}

export async function submitMarketplaceProductForReview({ user, productId, product }) {
  if (!user?.uid) throw new Error('Missing review submission context.')
  if (!productId) {
    throw new Error('Cannot submit product for review because no product ID was created.')
  }
  if (isDevelopmentRuntime) {
    console.info('[productService] submitting product for review', {
      productId,
      uid: user?.uid || null
    })
  }
  return requestProductReview(productId)
}

export function resolveProductId(input = {}) {
  const rawId = String(input?.id || input?.productId || '').trim()
  if (rawId && !isPlaceholderProductId(rawId)) return rawId
  return ''
}

export async function createOrUpdateProductShell(input = {}, user = null) {
  if (!functions || !db || !user?.uid) throw new Error('Authenticated user required.')
  const productId = resolveProductId(input)
  const creator = getCreatorIdentity(user, input)
  const pricing = normalizePriceFields(input)
  const requestedStatus = String(input.status || '').trim()
  const requestedVisibility = String(input.visibility || '').trim()
  const basePayload = buildProductPayload({ ...input, ...(productId ? { id: productId } : {}) }, user)
  const payload = sanitizeClientProductDraftPayload(withoutUndefinedValues({
    ...basePayload,
    ...(productId ? { id: productId } : {}),
    slug: String(input.slug || basePayload.slug || slugify(input.title) || productId || ''),
    status: requestedStatus === 'published' ? 'review_pending' : (requestedStatus || 'draft'),
    visibility: requestedVisibility === 'public' ? 'unlisted' : (requestedVisibility || 'private'),
    title: String(input.title || basePayload.title || '').trim() || 'Untitled product',
    artistId: user.uid,
    artistName: String(creator.artistName || 'Creator'),
    artistDisplayName: String(creator.artistDisplayName || creator.artistName || 'Creator'),
    artistUsername: String(creator.artistUsername || ''),
    artistProfilePath: creator.artistProfilePath || `profiles/${user.uid}`,
    artistAvatarURL: String(creator.artistAvatarURL || ''),
    artistPhotoURL: String(creator.artistPhotoURL || ''),
    ...pricing
  }))
  delete payload.createdAt
  delete payload.updatedAt
  if (!productId) delete payload.id

  const callableName = 'createOrUpdateProductShell'
  const productDocExists = productId ? await getProductShellExistsForDiagnostics(productId) : null
  const diagnostics = {
    ...buildProductShellDiagnostics({ user, productId, payload }),
    productDocExists,
    callableName
  }
  if (isDevelopmentRuntime) {
    console.info('[productService] product shell callable diagnostic', diagnostics)
  }
  try {
    const callable = httpsCallable(functions, callableName)
    const result = await callable({
      ...(productId ? { productId } : {}),
      product: payload
    })
    const data = result?.data || {}
    if (!data.productId) throw new Error('Product shell callable did not return a productId.')
    if (isDevelopmentRuntime) {
      console.info('[productService] product shell callable result', {
        productId: data.productId,
        status: data.status || '',
        visibility: data.visibility || '',
        created: Boolean(data.created),
        updated: Boolean(data.updated)
      })
    }
    return { ...data, payload }
  } catch (error) {
    console.error('[productService] product shell callable failed', {
      ...diagnostics,
      code: error?.code || '',
      message: error?.message || '',
      details: error?.details || null
    })
    error.productShellDiagnostics = diagnostics
    throw error
  }
}

export async function uploadProductFile({ productId, queueItem, onProgress } = {}) {
  if (!storage || !productId || !queueItem?.file) throw new Error('Missing upload inputs.')
  const safeName = sanitizeStorageFileName(queueItem.name || queueItem.file.name)
  const storagePath = STORAGE_PATHS.productRoleFile(productId, queueItem.role, queueItem.id, safeName)
  const storageRef = ref(storage, storagePath)
  const task = uploadBytesResumable(storageRef, queueItem.file, { contentType: queueItem.contentType || queueItem.file.type || 'application/octet-stream' })
  await new Promise((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      const progress = snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0
      if (typeof onProgress === 'function') onProgress(progress)
    }, reject, resolve)
  })
  return { ...queueItem, storagePath, progress: 100, status: 'uploaded' }
}

export async function deleteProductStorageFile(storagePath = '') {
  const normalized = String(storagePath || '').trim()
  if (!normalized || !storage) return { ok: false, skipped: true }
  try {
    await deleteObject(ref(storage, normalized))
    return { ok: true, skipped: false }
  } catch (error) {
    if (error?.code === 'storage/object-not-found') return { ok: true, skipped: true, objectNotFound: true }
    return { ok: false, skipped: false, error }
  }
}

export async function saveProductManifest({ productId, draft = {}, uploadedFiles = [] } = {}) {
  if (!functions || !db || !productId) throw new Error('Missing productId.')
  const byRole = (role) => uploadedFiles.filter((item) => item.role === role)
  const cover = byRole('cover')[0]
  const thumbnail = byRole('thumbnail')[0]
  const deliverables = byRole('deliverable').filter((item) => item.storagePath)
  const deliverable = deliverables[0]
  const license = byRole('license')[0]
  const gallery = byRole('gallery').map((item) => item.storagePath).filter(Boolean)
  const previewAudio = byRole('previewAudio').map((item) => item.storagePath).filter(Boolean)
  const previewVideo = byRole('previewVideo').map((item) => item.storagePath).filter(Boolean)
  const existingDeliverables = Array.isArray(draft.deliverableFiles) ? draft.deliverableFiles : []
  const deliverableRows = deliverables.length ? deliverables : existingDeliverables
  const fileRows = uploadedFiles.length ? uploadedFiles : deliverableRows
  const totalBytes = fileRows.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0)
  const resolvedCoverPath = cover?.storagePath || draft.coverPath || ''
  const resolvedThumbnailPath = thumbnail?.storagePath || draft.thumbnailPath || resolvedCoverPath || ''
  const manifest = {
    coverPath: resolvedCoverPath,
    thumbnailPath: resolvedThumbnailPath,
    galleryPaths: gallery.length ? gallery : (Array.isArray(draft.galleryPaths) ? draft.galleryPaths : []),
    previewAudioPaths: previewAudio.length ? previewAudio : (Array.isArray(draft.previewAudioPaths) ? draft.previewAudioPaths : []),
    previewVideoPaths: previewVideo.length ? previewVideo : (Array.isArray(draft.previewVideoPaths) ? draft.previewVideoPaths : []),
    downloadPath: deliverable?.storagePath || draft.downloadPath || '',
    deliverableFiles: deliverableRows.map((row) => ({
      id: row.id,
      productId,
      name: row.name,
      displayPath: row.displayPath || row.name,
      storagePath: row.storagePath,
      sizeBytes: Number(row.sizeBytes || 0),
      contentType: row.contentType || 'application/octet-stream',
      extension: String(row.name || '').split('.').pop() || '',
      type: row.contentType || 'file',
      category: 'Deliverables',
      role: 'deliverable',
      isDeliverable: true,
      isDownloadable: true,
      canPreview: String(row.contentType || '').startsWith('audio/'),
      description: String(row.description || '').slice(0, 150),
      updatedAt: new Date().toISOString()
    })),
    primaryDownloadPath: deliverable?.storagePath || draft.primaryDownloadPath || draft.downloadPath || '',
    primaryDownloadBytes: Number(deliverable?.sizeBytes || draft.primaryDownloadBytes || 0),
    licensePath: license?.storagePath || '',
    assetSummary: {
      totalFiles: fileRows.length,
      totalBytes,
      downloadableCount: fileRows.filter((row) => row.role === 'deliverable' || row.isDownloadable).length,
      previewableCount: fileRows.filter((row) => row.canPreview).length
    },
    primaryPreviewPath: draft.primaryPreviewPath || '',
    primaryPreviewType: draft.primaryPreviewType || '',
    primaryPreviewDuration: Number(draft.primaryPreviewDuration || 0),
    previewAssignment: normalizePreviewAssignment(draft.previewAssignment || {}, draft.productType),
    productKind: draft.productKind || normalizeProductKind(draft.productType),
    previewMode: draft.previewMode || '',
    distributionMode: draft.distributionMode || '',
    formatKeys: Array.isArray(draft.formatKeys) ? draft.formatKeys : parseCsv(draft.formatKeys),
    dawCompatibility: Array.isArray(draft.dawCompatibility) ? draft.dawCompatibility : parseCsv(draft.dawCompatibility),
    compatibilityNotes: String(draft.compatibilityNotes || ''),
    formatNotes: String(draft.formatNotes || ''),
    includedFiles: String(draft.includedFiles || ''),
    files: fileRows.map((row, index) => ({
      id: row.id,
      productId,
      name: row.name,
      displayPath: row.displayPath || row.name,
      parentPath: row.parentPath || '',
      storagePath: row.storagePath,
      role: row.role || 'deliverable',
      category: row.role === 'deliverable' ? 'Deliverables' : row.role === 'gallery' ? 'Listing Media' : row.role === 'license' ? 'License' : 'Preview Media',
      sizeBytes: Number(row.sizeBytes || 0),
      contentType: row.contentType || row.mimeType || 'application/octet-stream',
      extension: String(row.name || '').split('.').pop() || '',
      type: row.type || row.kind || row.contentType || 'file',
      description: String(row.description || '').slice(0, 150),
      isDownloadable: row.role === 'deliverable' || row.isDownloadable === true,
      canPreview: row.canPreview === true || (row.role === 'deliverable' && String(row.contentType || '').startsWith('audio/')),
      isDeliverable: row.role === 'deliverable' || row.isDeliverable === true,
      isPublicPreview: row.role === 'previewAudio' || row.role === 'previewVideo' || row.role === 'gallery' || row.role === 'cover' || row.role === 'thumbnail',
      sortIndex: Number(row.sortIndex ?? index)
    }))
  }
  const operationName = 'callable saveProductManifest'
  const path = `${FIRESTORE_COLLECTIONS.products}/${productId}`
  const parent = await getProductParentDiagnostics(productId)
  if (isDevelopmentRuntime) {
    console.info('[productService] save-product-manifest operation start', {
      operationName,
      path,
      productId,
      uid: draft.artistId || null,
      keys: Object.keys(manifest).sort(),
      fileMetadataCount: manifest.files.length,
      ...parent
    })
  }
  try {
    const callable = httpsCallable(functions, 'saveProductManifest')
    const result = await callable({ productId, manifest })
    const data = result?.data || {}
    if (isDevelopmentRuntime) {
      console.info('[productService] save-product-manifest result', {
        productId,
        manifestSaved: Boolean(data.manifestSaved),
        productUpdated: Boolean(data.productUpdated),
        fileMetadataWritten: Number(data.fileMetadataWritten || 0),
        updatedPaths: data.updatedPaths || []
      })
    }
    return data
  } catch (error) {
    const details = error?.details || {}
    const failedOperation = details.operationName || operationName
    const failedPath = details.path || path
    console.error(`save-product-manifest failed at operation: ${failedOperation}`)
    console.error(`path: ${failedPath}`)
    console.error(`code: ${error?.code || ''}`)
    console.error('[productService] save-product-manifest failed', {
      operationName: failedOperation,
      path: failedPath,
      code: error?.code || '',
      message: error?.message || '',
      details,
      productId,
      uid: draft.artistId || null,
      keys: Object.keys(manifest).sort(),
      fileMetadataCount: manifest.files.length,
      ...parent
    })
    throw error
  }
}

export async function submitProductForReview({ productId } = {}) {
  return requestProductReview(productId)
}

export async function listMarketplaceReviewQueue({ limitCount = 60 } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listMarketplaceReviewQueue')
  const result = await callable({ limit: limitCount })
  return result?.data || { ok: false, products: [] }
}

export async function reviewProductDecision({ productId = '', decision = '', reason = '', notes = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'reviewProductDecision')
  const result = await callable({ productId, decision, reason, notes })
  return result?.data || { ok: false }
}

export async function setAdminUserRole({ uid = '', role = '', active = true, reason = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'setAdminUserRole')
  const result = await callable({ uid, role, active, reason })
  return result?.data || { ok: false }
}

export async function listAdminProducts({ limitCount = 50, search = '', productId = '', cursor = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listAdminProducts')
  const result = await callable({ limit: limitCount, search, productId, cursor })
  return result?.data || { ok: false, products: [] }
}

export async function listAdminUsers({ limitCount = 50, search = '', uid = '', cursor = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listAdminUsers')
  const result = await callable({ limit: limitCount, search, uid, cursor })
  return result?.data || { ok: false, users: [] }
}

export async function getAdminUserProfile({ uid = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'getAdminUserProfile')
  const result = await callable({ uid })
  return result?.data || { ok: false, user: null, recentProducts: [], adminNotes: [] }
}

export async function addAdminUserNote({ uid = '', note = '', severity = 'info', category = 'account' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'addAdminUserNote')
  const result = await callable({ uid, note, severity, category })
  return result?.data || { ok: false }
}

export async function setUserSuspension({ uid = '', suspended = true, reason = '', duration = 'indefinite', note = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'setUserSuspension')
  const result = await callable({ uid, suspended, reason, duration, note })
  return result?.data || { ok: false }
}

export async function listAdminReports({ limitCount = 50, cursor = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listAdminReports')
  const result = await callable({ limit: limitCount, cursor })
  return result?.data || { ok: false, reports: [] }
}

export async function getAdminReport({ reportId = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listAdminReports')
  const result = await callable({ reportId })
  return result?.data || { ok: false, reports: [] }
}

export async function updateReportDecision({ reportId = '', action = '', reason = '', notes = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'updateReportDecision')
  const result = await callable({ reportId, action, reason, notes })
  return result?.data || { ok: false }
}

export async function listAdminOrders({ limitCount = 50, orderId = '', cursor = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listAdminOrders')
  const result = await callable({ limit: limitCount, orderId, cursor })
  return result?.data || { ok: false, orders: [] }
}

export async function getAdminOrder({ orderId = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'getAdminOrder')
  const result = await callable({ orderId })
  return result?.data || { ok: false, order: null, logs: [], entitlements: [], libraryItems: [], mismatchWarnings: [] }
}

export async function listAdminLogs({ limitCount = 50, cursor = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listAdminLogs')
  const result = await callable({ limit: limitCount, cursor })
  return result?.data || { ok: false, logs: [] }
}

export async function getAdminLog({ logId = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'getAdminLog')
  const result = await callable({ logId })
  return result?.data || { ok: false, log: null }
}

export async function listAdminTeam({ limitCount = 50 } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listAdminTeam')
  const result = await callable({ limit: limitCount })
  return result?.data || { ok: false, team: [] }
}

export async function listActiveStaffPresence({ limitCount = 30 } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'listActiveStaffPresence')
  const result = await callable({ limit: limitCount })
  return result?.data || { ok: false, staff: [] }
}

export async function getAdminSettings() {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'getAdminSettings')
  const result = await callable({})
  return result?.data || { ok: false, settings: {} }
}

export async function updateAdminSettings({ section = '', values = {}, reason = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'updateAdminSettings')
  const result = await callable({ section, values, reason })
  return result?.data || { ok: false, settings: {} }
}

export async function getEmailAdminStatus() {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'getEmailAdminStatus')
  const result = await callable({})
  return result?.data || { ok: false, providerConfigured: false, recent: [] }
}

export async function sendAdminEmail({ to = '', subject = '', body = '', category = 'support', relatedUid = '', relatedProductId = '', relatedOrderId = '', relatedReportId = '', cc = '', replyTo = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'sendAdminEmail')
  const result = await callable({ to, subject, body, category, relatedUid, relatedProductId, relatedOrderId, relatedReportId, cc, replyTo })
  return result?.data || { ok: false }
}

export async function sendAdminAuthEmail({ uid = '', type = '', to = '', subject = '', body = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'sendAdminAuthEmail')
  const result = await callable({ uid, type, to, subject, body })
  return result?.data || { ok: false }
}

export async function sendAdminSystemMessage({ recipientUid = '', category = 'support', priority = 'normal', subject = '', body = '', actionLabel = '', actionUrl = '', internalNote = '' } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'sendAdminSystemMessage')
  const result = await callable({ recipientUid, category, priority, subject, body, actionLabel, actionUrl, internalNote })
  return result?.data || { ok: false }
}

export async function createReport({ targetType = '', targetId = '', targetOwnerUid = '', reason = '', description = '', sourcePath = '', metadata = {} } = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'createReport')
  const result = await callable({ targetType, targetId, targetOwnerUid, reason, description, sourcePath, metadata })
  return result?.data || { ok: false }
}

export async function uploadSellerAgreementMarkdown({ file, version = '', agreementId = 'marketplace-product-seller-agreement' } = {}) {
  if (!storage) throw new Error('Storage is not configured.')
  const cleanVersion = String(version || '').trim()
  const cleanAgreementId = String(agreementId || 'marketplace-product-seller-agreement').trim() || 'marketplace-product-seller-agreement'
  if (!/^v[0-9]+$/.test(cleanVersion)) {
    throw new Error('Version must use lowercase v followed by a number, such as v2.')
  }
  if (!(file instanceof File)) throw new Error('Choose a markdown file before uploading.')
  const fileName = String(file.name || '').toLowerCase()
  const mime = String(file.type || '').toLowerCase()
  if (!fileName.endsWith('.md') || (mime && !['text/markdown', 'text/plain', 'application/octet-stream'].includes(mime))) {
    throw new Error('Agreement upload must be a .md markdown file.')
  }
  const storagePath = `legal/agreements/${cleanAgreementId}/${cleanVersion}.md`
  await uploadBytes(ref(storage, storagePath), file, { contentType: 'text/markdown' })
  return {
    ok: true,
    storagePath,
    agreementId: cleanAgreementId,
    version: cleanVersion
  }
}

export async function requestProductReview(productId = '') {
  if (!functions || !productId) throw new Error('Missing product id for review request.')
  try {
    console.info('[productService] submitting product for review', { productId })
    const callable = httpsCallable(functions, 'requestProductReview')
    const result = await callable({ productId })
    console.info('[productService] product review result', result?.data || null)
    return result?.data || { status: 'review_pending', aiEnabled: false }
  } catch (error) {
    console.warn('[productService] product review failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details
    })
    const code = String(error?.code || '')
    const wrapped = new Error(error?.message || 'Could not submit product for review.')
    wrapped.code = error?.code || ''
    wrapped.details = error?.details || null
    if (code.includes('not-found') || code.includes('unavailable') || code.includes('internal')) {
      wrapped.message = 'Review service is currently unavailable. Please try again shortly.'
    }
    throw wrapped
  }
}

export async function seedProducts(productObjects = []) {
  if (!db || !Array.isArray(productObjects) || !productObjects.length) return 0

  const batch = writeBatch(db)
  productObjects.forEach((item) => {
    const id = item.id || item.slug
    if (!id) return
    const refDoc = doc(db, FIRESTORE_COLLECTIONS.products, id)
    batch.set(refDoc, { ...item, id }, { merge: true })
  })
  await batch.commit()
  return productObjects.length
}

export async function seedProduct(productObject = {}) {
  if (!db || !productObject?.id) return false
  await setDoc(doc(db, FIRESTORE_COLLECTIONS.products, productObject.id), productObject, { merge: true })
  return true
}
