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
  updateDoc,
  startAfter,
  where,
  writeBatch
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { storage } from '../firebase/storage'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { STORAGE_PATHS } from '../config/storagePaths'

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
  try {
    return await getDownloadURL(ref(storage, path))
  } catch (error) {
    warnOnce('media', '[productService] Storage URL resolution failed.', error?.message || error)
    return fallback
  }
}

export async function resolveProductMedia(product) {
  const productId = product.id
  const thumbnailPath = product.thumbnailPath || STORAGE_PATHS.productThumb(productId)
  const coverPath = product.coverPath || STORAGE_PATHS.productCover(productId)
  const galleryPaths = Array.isArray(product.galleryPaths) ? product.galleryPaths.slice(0, 12) : []
  const previewVideoPaths = Array.isArray(product.previewVideoPaths) ? product.previewVideoPaths.slice(0, 6) : []

  const thumbnailURL = await safeStorageUrl(thumbnailPath)
  const coverURL = await safeStorageUrl(coverPath, thumbnailURL)
  const previewAudioURLs = await Promise.all((product.previewAudioPaths || []).map((path) => safeStorageUrl(path)))
  const primaryPreviewURL = product.primaryPreviewPath ? await safeStorageUrl(product.primaryPreviewPath) : ''
  const galleryURLs = await Promise.all(galleryPaths.map((path) => safeStorageUrl(path)))
  const previewVideoURLs = await Promise.all(previewVideoPaths.map((path) => safeStorageUrl(path)))
  const assignment = normalizePreviewAssignment(product.previewAssignment || {}, product.productType)
  const hoverAudioURL = assignment.hoverAudioURL || await safeStorageUrl(assignment.hoverAudioPath)
  const hoverVideoURL = assignment.hoverVideoURL || await safeStorageUrl(assignment.hoverVideoPath)

  return {
    thumbnailPath,
    coverPath,
    thumbnailURL,
    coverURL,
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
  const counts = rawProduct.counts || {}
  const categories = rawProduct.categories || []
  const genres = rawProduct.genres || []
  const tags = rawProduct.tags || []
  const contributorNames = rawProduct.contributorNames || []
  const contributorCount = Number(rawProduct.contributorCount ?? rawProduct.contributorIds?.length ?? contributorNames.length ?? 0)
  const likeCount = Number(rawProduct.likeCount ?? counts.likes ?? 0)
  const saveCount = Number(rawProduct.saveCount ?? counts.saves ?? 0)
  const downloadCount = Number(rawProduct.downloadCount ?? counts.downloads ?? 0)
  const commentCount = Number(rawProduct.commentCount ?? counts.comments ?? 0)
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
    contributorCount,
    sellerAgreement: rawProduct.sellerAgreement && typeof rawProduct.sellerAgreement === 'object' ? rawProduct.sellerAgreement : null,
    sellerAgreementAccepted: Boolean(rawProduct.sellerAgreementAccepted),
    sellerAgreementVersion: String(rawProduct.sellerAgreementVersion || ''),
    coverPath: media.coverPath || rawProduct.coverPath || '',
    thumbnailPath: media.thumbnailPath || rawProduct.thumbnailPath || '',
    thumbnailURL: media.thumbnailURL || '',
    coverURL: media.coverURL || '',
    galleryPaths: rawProduct.galleryPaths || [],
    previewAudioPaths: rawProduct.previewAudioPaths || [],
    previewVideoPaths: rawProduct.previewVideoPaths || [],
    previewAudioURLs: media.previewAudioURLs || [],
    primaryPreviewURL: media.primaryPreviewURL || '',
    galleryURLs: media.galleryURLs || [],
    previewVideoURLs: media.previewVideoURLs || [],
    downloadPath: rawProduct.downloadPath || '',
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
    counts: {
      likes: Number(counts.likes || 0),
      dislikes: Number(counts.dislikes || 0),
      saves: Number(counts.saves || 0),
      shares: Number(counts.shares || 0),
      comments: Number(counts.comments || 0),
      downloads: Number(counts.downloads || 0),
      follows: Number(counts.follows || 0)
    },
    featured: Boolean(rawProduct.featured),
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
  const previewAudioPaths = Array.isArray(input.previewAudioPaths) ? input.previewAudioPaths : parseCsv(input.previewAudioPaths)
  const previewVideoPaths = Array.isArray(input.previewVideoPaths) ? input.previewVideoPaths : parseCsv(input.previewVideoPaths)
  const galleryPaths = Array.isArray(input.galleryPaths) ? input.galleryPaths : parseCsv(input.galleryPaths)
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

export function isPlaceholderProductId(productId = '') {
  const normalized = String(productId || '').trim().toLowerCase()
  if (!normalized) return true
  if (PLACEHOLDER_PRODUCT_IDS.has(normalized)) return true
  return normalized.startsWith('test-') || normalized.startsWith('temp-') || normalized.startsWith('fake-')
}

async function ensureDraftProductDocument(user, input = {}, productId = '') {
  if (!db || !user?.uid || !productId) return
  const creator = getCreatorIdentity(user, input)

  const now = serverTimestamp()
  await setDoc(
    doc(db, FIRESTORE_COLLECTIONS.products, productId),
    {
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
      visibility: input.visibility === 'public' ? 'unlisted' : (input.visibility || 'private'),
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  )
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
    mimeType: raw.mimeType || 'application/octet-stream',
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

export async function saveProductFileManifest(productId, fileRows = []) {
  if (!db || !productId) return
  const filesCol = collection(db, FIRESTORE_COLLECTIONS.products, productId, 'files')
  const batch = writeBatch(db)
  fileRows.forEach((row, index) => {
    const id = row.id || doc(filesCol).id
    batch.set(doc(filesCol, id), {
      ...row,
      id,
      productId,
      sortIndex: Number(row.sortIndex ?? index),
      updatedAt: serverTimestamp(),
      createdAt: row.createdAt || serverTimestamp()
    }, { merge: true })
  })
  await batch.commit()
}

export async function initializeProductDraft(user, input = {}, requestedId = '') {
  if (!db || !user?.uid) throw new Error('Authenticated user required.')
  const productId = !isPlaceholderProductId(requestedId) ? requestedId : createProductId()
  const draftRef = doc(db, FIRESTORE_COLLECTIONS.products, productId)
  const draftSnapshot = await getDoc(draftRef)
  const created = !draftSnapshot.exists()
  const basePayload = buildProductPayload({ ...input, id: productId }, user)
  await ensureDraftProductDocument(user, basePayload, productId)
  return { productId, created }
}

export async function saveProductDraft(user, input = {}, options = {}) {
  if (!db || !user?.uid) throw new Error('Authenticated user required.')

  const requestedId = options.productId || input.id || ''
  let productId = ''
  let created = false
  let stage = 'draft-initialization'
  try {
    const initialization = await initializeProductDraft(user, input, requestedId)
    productId = initialization.productId
    created = initialization.created
    if (typeof options.onStatus === 'function' && created) {
      options.onStatus('Draft document created.')
    }
    const existsAfterInit = await waitForDraftDocument(productId)
    if (!existsAfterInit) {
      throw createStageError('draft-verification', 'Draft existence check failed after initialization.')
    }
  } catch (error) {
    console.warn('[productService] draft save failed', {
      stage,
      code: error?.code || error?.cause?.code,
      message: error?.message || error?.cause?.message,
      productId,
      payloadId: input?.id,
      artistId: input?.artistId,
      currentUid: user?.uid,
      title: Boolean(input?.title),
      status: input?.status,
      visibility: input?.visibility,
      payloadKeys: Object.keys(input || {})
    })
    throw createStageError('draft-initialization', 'Draft initialization failed.', error)
  }

  const creator = getCreatorIdentity(user, input)
  const basePayload = buildProductPayload({ ...input, ...creator, id: productId }, user)
  let mediaUploads = {}
  try {
    if (typeof options.onStatus === 'function' && options.mediaFiles?.cover) {
      options.onStatus('Cover upload started.')
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
      if (typeof options.onStatus === 'function') options.onStatus('Gallery upload started.')
      galleryUploads = await Promise.all(options.galleryFiles.map(async (file, index) => {
        const path = `${STORAGE_PATHS.productGalleryRoot(productId)}/${Date.now()}-${index}-${sanitizeStorageFileName(file.name)}`
        await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/*' })
        return path
      }))
    }
    if (Array.isArray(options.previewAudioFiles) && options.previewAudioFiles.length) {
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
      if (typeof options.onStatus === 'function') options.onStatus('Deliverable upload started.')
      deliverableUploads = await uploadProductFiles(productId, options.deliverableFiles, { useSubfolder: true })
      fileManifestRows = [...fileManifestRows, ...deliverableUploads]
    }
  } catch (error) {
    throw createStageError('deliverable-upload', 'Deliverable upload failed.', error)
  }

  try {
    if (fileManifestRows.length) {
      await saveProductFileManifest(productId, fileManifestRows)
      if (typeof options.onStatus === 'function') options.onStatus('File manifest saved.')
    }
  } catch (error) {
    throw createStageError('file-manifest-save', 'File manifest save failed.', error)
  }

  const desiredStatus = options.status || basePayload.status || 'draft'
  const editingPublishedListing = input.currentStatus === 'published' || basePayload.status === 'published'
  const normalizedStatus = editingPublishedListing ? 'review_pending' : (desiredStatus === 'published' ? 'review_pending' : desiredStatus)
  const payload = {
    ...basePayload,
    id: productId,
    ...creator,
    artistId: user.uid,
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
  }
  const isSubmittingForReview = desiredStatus === 'published'
  if (!isSubmittingForReview && !String(input.title || '').trim()) {
    delete payload.title
  }
  if (!isSubmittingForReview && !String(input.productType || '').trim()) {
    delete payload.productType
  }

  try {
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId), payload, { merge: true })
    if (typeof options.onStatus === 'function') {
      options.onStatus('Final product metadata saved.')
    }
  } catch (error) {
    throw createStageError('final-firestore-merge', 'Final product metadata save failed.', error)
  }

  return {
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
  if (!db || !user?.uid || !productId) throw new Error('Missing review submission context.')
  await updateDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId), {
    status: 'review_pending',
    moderationStatus: 'pending_ai_review',
    updatedAt: serverTimestamp()
  })
  await setDoc(doc(db, 'pendingReview', 'marketplace', 'items', productId), {
    id: productId,
    productId,
    productPath: `products/${productId}`,
    sellerId: user.uid,
    sellerProfilePath: `profiles/${user.uid}`,
    status: 'pending_ai_review',
    reviewType: 'marketplace-product',
    source: 'new-product-editor',
    productSnapshot: {
      title: product?.title || '',
      slug: product?.slug || '',
      shortDescription: product?.shortDescription || '',
      description: product?.description || '',
      productType: product?.productType || '',
      productKind: product?.productKind || '',
      categories: product?.categories || [],
      genres: product?.genres || [],
      tags: product?.tags || [],
      priceCents: Number(product?.priceCents || 0),
      payoutTargetCents: Number(product?.payoutTargetCents || 0),
      currency: product?.currency || 'USD',
      isFree: Boolean(product?.isFree),
      visibility: product?.visibility || 'private',
      coverPath: product?.coverPath || '',
      thumbnailPath: product?.thumbnailPath || '',
      previewAudioPaths: product?.previewAudioPaths || [],
      previewVideoPaths: product?.previewVideoPaths || [],
      primaryDownloadPath: product?.primaryDownloadPath || '',
      assetSummary: product?.assetSummary || {},
      sellerAgreementVersion: product?.sellerAgreementVersion || '',
      sellerAgreementAccepted: Boolean(product?.sellerAgreementAccepted)
    },
    checks: {
      ai: { status: 'pending', score: null, reasons: [], reviewedAt: null },
      rules: { status: 'pending', blockers: [], warnings: [] },
      human: { status: 'not_required', reviewedBy: '', reviewedAt: null, notes: '' }
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
  return { status: 'review_pending' }
}

export async function requestProductReview(productId = '') {
  if (!functions || !productId) throw new Error('Missing product id for review request.')
  try {
    const callable = httpsCallable(functions, 'requestProductReview')
    const result = await callable({ productId })
    return result?.data || { status: 'review_pending', aiEnabled: false }
  } catch (error) {
    const code = String(error?.code || '')
    if (code.includes('not-found') || code.includes('unavailable') || code.includes('internal')) {
      throw new Error('Review service is currently unavailable. Please try again shortly.')
    }
    throw new Error(error?.message || 'Could not submit product for review.')
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
