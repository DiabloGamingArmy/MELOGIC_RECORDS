import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { storage } from '../firebase/storage'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { STORAGE_PATHS } from '../config/storagePaths'

let hasWarnedProductFetch = false
let hasWarnedProductMedia = false

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

  const thumbnailURL = await safeStorageUrl(thumbnailPath)
  const coverURL = await safeStorageUrl(coverPath, thumbnailURL)
  const previewAudioURLs = await Promise.all((product.previewAudioPaths || []).map((path) => safeStorageUrl(path)))

  return {
    thumbnailPath,
    coverPath,
    thumbnailURL,
    coverURL,
    previewAudioURLs: previewAudioURLs.filter(Boolean)
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
  return {
    id: rawProduct.id || productId,
    slug: rawProduct.slug || '',
    status: rawProduct.status || 'draft',
    visibility: rawProduct.visibility || 'private',
    title: rawProduct.title || 'Untitled product',
    shortDescription: rawProduct.shortDescription || '',
    description: rawProduct.description || '',
    productType: rawProduct.productType || 'Release',
    categories,
    genres,
    tags,
    artistId: rawProduct.artistId || '',
    artistName: rawProduct.artistName || 'Unknown artist',
    artistUsername: rawProduct.artistUsername || '',
    artistProfilePath: rawProduct.artistProfilePath || '',
    contributorIds: rawProduct.contributorIds || [],
    contributorNames,
    contributorCount,
    coverPath: media.coverPath || rawProduct.coverPath || '',
    thumbnailPath: media.thumbnailPath || rawProduct.thumbnailPath || '',
    thumbnailURL: media.thumbnailURL || '',
    coverURL: media.coverURL || '',
    galleryPaths: rawProduct.galleryPaths || [],
    previewAudioPaths: rawProduct.previewAudioPaths || [],
    previewAudioURLs: media.previewAudioURLs || [],
    downloadPath: rawProduct.downloadPath || '',
    licensePath: rawProduct.licensePath || '',
    priceCents: Number.isFinite(rawProduct.priceCents) ? rawProduct.priceCents : 0,
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

function buildProductsPageQuery({ filters = {}, sort = 'featured', pageSize = 10, cursor = null }) {
  const constraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  ]

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
  if (Number.isFinite(filters.minPriceCents)) constraints.push(where('priceCents', '>=', filters.minPriceCents))
  if (Number.isFinite(filters.maxPriceCents)) constraints.push(where('priceCents', '<=', filters.maxPriceCents))
  if (Number.isFinite(filters.minContributorCount) && filters.minContributorCount > 0) {
    constraints.push(where('contributorCount', '>=', filters.minContributorCount))
  }

  constraints.push(...sortQueryFor(sort))
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(pageSize))
  return query(collection(db, FIRESTORE_COLLECTIONS.products), ...constraints)
}

export async function listPublicProductsPage({ filters = {}, sort = 'featured', pageSize = 10, cursor = null } = {}) {
  if (!db) return { products: [], nextCursor: null, hasMore: false }

  try {
    const snapshot = await getDocs(buildProductsPageQuery({ filters, sort, pageSize, cursor }))
    const products = await Promise.all(snapshot.docs.map(async (docSnap) => {
      const raw = docSnap.data()
      const media = await resolveProductMedia({ id: docSnap.id, ...raw })
      return normalizeProduct(docSnap.id, raw, media)
    }))

    return {
      products,
      nextCursor: snapshot.docs[snapshot.docs.length - 1] || null,
      hasMore: snapshot.docs.length === pageSize
    }
  } catch (error) {
    warnOnce('fetch', '[productService] Paginated product query failed; running lightweight fallback query.', error?.message || error)

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

export function buildProductPayload(input = {}, user = null) {
  const nowIso = new Date().toISOString()
  const counts = input.counts || {}
  const slug = input.slug || slugify(input.title) || `product-${Date.now()}`
  const contributorNames = Array.isArray(input.contributorNames) ? input.contributorNames : parseCsv(input.contributorNames)

  return {
    id: input.id || slug,
    slug,
    status: input.status || 'draft',
    visibility: input.visibility || 'private',
    title: input.title || '',
    shortDescription: input.shortDescription || '',
    description: input.description || '',
    productType: input.productType || 'Sample Pack',
    categories: Array.isArray(input.categories) ? input.categories : parseCsv(input.categories),
    genres: Array.isArray(input.genres) ? input.genres : parseCsv(input.genres),
    tags: Array.isArray(input.tags) ? input.tags : parseCsv(input.tags),
    artistId: input.artistId || user?.uid || '',
    artistName: input.artistName || user?.displayName || '',
    artistUsername: input.artistUsername || '',
    artistProfilePath: input.artistProfilePath || '',
    contributorIds: Array.isArray(input.contributorIds) ? input.contributorIds : parseCsv(input.contributorIds),
    contributorNames,
    coverPath: input.coverPath || '',
    thumbnailPath: input.thumbnailPath || '',
    coverURL: input.coverURL || '',
    thumbnailURL: input.thumbnailURL || '',
    galleryPaths: Array.isArray(input.galleryPaths) ? input.galleryPaths : parseCsv(input.galleryPaths),
    previewAudioPaths: Array.isArray(input.previewAudioPaths) ? input.previewAudioPaths : parseCsv(input.previewAudioPaths),
    previewVideoPaths: Array.isArray(input.previewVideoPaths) ? input.previewVideoPaths : parseCsv(input.previewVideoPaths),
    downloadPath: input.downloadPath || '',
    licensePath: input.licensePath || '',
    priceCents: Number.isFinite(input.priceCents) ? input.priceCents : 0,
    currency: input.currency || 'USD',
    isFree: Boolean(input.isFree),
    titleLower: String(input.title || '').toLowerCase(),
    artistNameLower: String(input.artistName || user?.displayName || '').toLowerCase(),
    artistUsernameLower: String(input.artistUsername || '').toLowerCase(),
    searchKeywords: Array.from(new Set([
      ...parseCsv(input.searchKeywords),
      ...String(input.title || '').toLowerCase().split(/\s+/),
      ...String(input.artistName || user?.displayName || '').toLowerCase().split(/\s+/),
      ...String(input.artistUsername || '').toLowerCase().split(/\s+/),
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
    likeCount: Number(input.likeCount ?? counts.likes ?? 0),
    saveCount: Number(input.saveCount ?? counts.saves ?? 0),
    downloadCount: Number(input.downloadCount ?? counts.downloads ?? 0),
    commentCount: Number(input.commentCount ?? counts.comments ?? 0),
    counts: {
      likes: Number(counts.likes || 0),
      dislikes: Number(counts.dislikes || 0),
      saves: Number(counts.saves || 0),
      shares: Number(counts.shares || 0),
      comments: Number(counts.comments || 0),
      downloads: Number(counts.downloads || 0),
      follows: Number(counts.follows || 0)
    },
    featured: Boolean(input.featured),
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

  const now = serverTimestamp()
  await setDoc(
    doc(db, FIRESTORE_COLLECTIONS.products, productId),
    {
      id: productId,
      artistId: user.uid,
      artistName: input.artistName || user.displayName || '',
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
    throw createStageError('draft-initialization', 'Draft initialization failed.', error)
  }

  const basePayload = buildProductPayload({ ...input, id: productId }, user)
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

  const desiredStatus = options.status || basePayload.status || 'draft'
  const payload = {
    ...basePayload,
    id: productId,
    artistId: user.uid,
    status: desiredStatus === 'published' ? 'draft' : desiredStatus,
    visibility: basePayload.visibility || 'private',
    coverPath: mediaUploads.coverPath || basePayload.coverPath,
    thumbnailPath: mediaUploads.thumbnailPath || basePayload.thumbnailPath,
    updatedAt: serverTimestamp(),
    createdAt: options.isNew ? serverTimestamp() : basePayload.createdAt || serverTimestamp()
  }
  const isPublishing = desiredStatus === 'published'
  if (!isPublishing && !String(input.title || '').trim()) {
    delete payload.title
  }
  if (!isPublishing && !String(input.productType || '').trim()) {
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

  if (isPublishing) {
    try {
      await setDoc(
        doc(db, FIRESTORE_COLLECTIONS.products, productId),
        {
          status: 'published',
          updatedAt: serverTimestamp()
        },
        { merge: true }
      )
      if (typeof options.onStatus === 'function') {
        options.onStatus('Publish transition completed.')
      }
    } catch (error) {
      throw createStageError('publish-transition', 'Publish update failed.', error)
    }
  }

  return {
    productId,
    payload,
    mediaUploads,
    draftCreated: created
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
