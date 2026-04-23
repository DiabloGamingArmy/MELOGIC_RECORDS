import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
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
  return {
    id: rawProduct.id || productId,
    slug: rawProduct.slug || '',
    status: rawProduct.status || 'draft',
    visibility: rawProduct.visibility || 'private',
    title: rawProduct.title || 'Untitled product',
    shortDescription: rawProduct.shortDescription || '',
    description: rawProduct.description || '',
    productType: rawProduct.productType || 'Release',
    categories: rawProduct.categories || [],
    genres: rawProduct.genres || [],
    tags: rawProduct.tags || [],
    artistId: rawProduct.artistId || '',
    artistName: rawProduct.artistName || 'Unknown artist',
    artistUsername: rawProduct.artistUsername || '',
    artistProfilePath: rawProduct.artistProfilePath || '',
    contributorIds: rawProduct.contributorIds || [],
    contributorNames: rawProduct.contributorNames || [],
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

export async function getPublicProducts() {
  if (!db) return []

  try {
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
    const coverPath = STORAGE_PATHS.productCover(productId)
    await uploadBytes(ref(storage, coverPath), mediaFiles.cover, { contentType: mediaFiles.cover.type || 'image/webp' })
    uploads.coverPath = coverPath
    uploads.coverURL = await safeStorageUrl(coverPath)
  }

  if (mediaFiles.thumbnail instanceof File) {
    const thumbnailPath = STORAGE_PATHS.productThumb(productId)
    await uploadBytes(ref(storage, thumbnailPath), mediaFiles.thumbnail, { contentType: mediaFiles.thumbnail.type || 'image/webp' })
    uploads.thumbnailPath = thumbnailPath
    uploads.thumbnailURL = await safeStorageUrl(thumbnailPath)
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
  const initialization = await initializeProductDraft(user, input, requestedId)
  const { productId, created } = initialization
  if (typeof options.onStatus === 'function' && created) {
    options.onStatus('Draft created.')
  }
  const basePayload = buildProductPayload({ ...input, id: productId }, user)
  if (typeof options.onStatus === 'function' && (options.mediaFiles?.cover || options.mediaFiles?.thumbnail)) {
    options.onStatus('Upload started.')
  }

  const mediaUploads = await uploadProductMediaFiles(productId, options.mediaFiles || {})
  if (typeof options.onStatus === 'function' && mediaUploads.coverPath) {
    options.onStatus('Cover uploaded successfully.')
  }
  if (typeof options.onStatus === 'function' && mediaUploads.thumbnailPath) {
    options.onStatus('Thumbnail uploaded successfully.')
  }

  const payload = {
    ...basePayload,
    id: productId,
    artistId: user.uid,
    status: options.status || basePayload.status || 'draft',
    visibility: basePayload.visibility || 'private',
    coverPath: mediaUploads.coverPath || basePayload.coverPath,
    thumbnailPath: mediaUploads.thumbnailPath || basePayload.thumbnailPath,
    updatedAt: serverTimestamp(),
    createdAt: options.isNew ? serverTimestamp() : basePayload.createdAt || serverTimestamp()
  }
  const isPublishing = (options.status || basePayload.status || 'draft') === 'published'
  if (!isPublishing && !String(input.title || '').trim()) {
    delete payload.title
  }
  if (!isPublishing && !String(input.productType || '').trim()) {
    delete payload.productType
  }

  await setDoc(doc(db, FIRESTORE_COLLECTIONS.products, productId), payload, { merge: true })

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
