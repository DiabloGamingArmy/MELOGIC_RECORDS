import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import { getProductById } from './productService'

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function toIso(value) {
  const millis = toMillis(value)
  return millis ? new Date(millis).toISOString() : ''
}

async function productPreview(productId = '') {
  const id = String(productId || '').trim()
  if (!id) return null
  try {
    return await getProductById(id)
  } catch (error) {
    console.warn('[accountCommerceService] product lookup failed', id, error?.message || error)
    return null
  }
}

function normalizeEntitlement(docSnap) {
  const data = docSnap.data() || {}
  const snapshot = data.productSnapshot && typeof data.productSnapshot === 'object' ? data.productSnapshot : {}
  return {
    id: docSnap.id,
    productId: String(data.productId || docSnap.id || ''),
    source: String(data.source || ''),
    acquisitionType: String(data.acquisitionType || ''),
    status: String(data.status || 'active'),
    orderId: String(data.orderId || ''),
    giftedBy: String(data.giftedBy || ''),
    giftId: String(data.giftId || ''),
    license: String(data.license || data.licenseType || 'Standard License'),
    acquiredAt: data.acquiredAt || data.claimedAt || data.createdAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    productSnapshot: {
      title: String(snapshot.title || data.productTitle || ''),
      slug: String(snapshot.slug || data.productSlug || ''),
      creatorName: String(snapshot.creatorName || data.artistName || ''),
      coverPath: String(snapshot.coverPath || data.coverPath || ''),
      coverURL: String(snapshot.coverURL || data.coverURL || ''),
      productType: String(snapshot.productType || data.productType || ''),
      usageLicense: String(snapshot.usageLicense || data.license || ''),
      sizeBytes: Number(snapshot.sizeBytes || data.sizeBytes || data.primaryDownloadBytes || 0)
    }
  }
}

function normalizeSavedProduct(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: `saved-${docSnap.id}`,
    productId: String(data.productId || docSnap.id || ''),
    source: 'saved',
    status: 'active',
    orderId: '',
    license: '',
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null
  }
}

function normalizeOrder(docSnap) {
  const data = docSnap.data() || {}
  const productIds = Array.isArray(data.productIds) ? data.productIds.map(String).filter(Boolean) : []
  const amountValue = data.amountTotalCents ?? data.amountCents ?? data.totalCents
  const amountNumber = Number(amountValue)
  const items = (Array.isArray(data.items) ? data.items : []).map((item = {}) => ({
    ...item,
    productId: String(item.productId || item.id || ''),
    title: String(item.title || item.productTitle || item.productSnapshot?.title || item.productId || 'Product metadata unavailable'),
    creatorUid: String(item.creatorUid || item.artistId || item.productSnapshot?.creatorUid || ''),
    creatorName: String(item.creatorName || item.artistName || item.productSnapshot?.creatorName || ''),
    quantity: Math.max(1, Number(item.quantity || 1)),
    amountCents: Number.isFinite(Number(item.amountCents ?? item.amountTotalCents ?? item.priceCents))
      ? Math.max(0, Math.round(Number(item.amountCents ?? item.amountTotalCents ?? item.priceCents)))
      : null,
    currency: String(item.currency || data.currency || 'USD').toUpperCase()
  }))
  return {
    id: docSnap.id,
    uid: String(data.uid || data.buyerUid || data.buyerId || ''),
    productIds,
    items,
    status: String(data.status || data.paymentStatus || 'unknown'),
    paymentStatus: String(data.paymentStatus || data.status || 'unknown'),
    orderState: String(data.orderState || data.paymentStatus || data.status || 'unknown'),
    checkoutStatus: String(data.checkoutStatus || ''),
    refundStatus: String(data.refundStatus || ''),
    stripeSessionId: String(data.stripeSessionId || ''),
    checkoutSessionId: String(data.checkoutSessionId || data.stripeSessionId || ''),
    paymentIntentId: String(data.paymentIntentId || ''),
    amountSubtotalCents: Number.isFinite(Number(data.amountSubtotalCents ?? data.amount_subtotal))
      ? Math.max(0, Math.round(Number(data.amountSubtotalCents ?? data.amount_subtotal)))
      : null,
    amountTotalCents: Number.isFinite(amountNumber) ? Math.max(0, Math.round(amountNumber)) : null,
    amountAvailable: Number.isFinite(amountNumber),
    amountSource: String(data.amountSource || ''),
    currency: String(data.currency || 'usd').toUpperCase(),
    livemode: data.livemode === true,
    paymentSource: String(data.paymentSource || (data.stripeSessionId ? 'stripe_test' : '')),
    createdAt: data.createdAt || null,
    paidAt: data.paidAt || null,
    updatedAt: data.updatedAt || null
  }
}

export function sortAccountRowsByDate(rows = []) {
  return [...rows].sort((a, b) => {
    const aTime = toMillis(a.updatedAt) || toMillis(a.paidAt) || toMillis(a.createdAt)
    const bTime = toMillis(b.updatedAt) || toMillis(b.paidAt) || toMillis(b.createdAt)
    return bTime - aTime
  })
}

export function accountDateIso(value) {
  return toIso(value)
}

export async function listUserLibraryItems(uid = '', { limitCount = 0 } = {}) {
  const userId = String(uid || '').trim()
  if (!db || !userId) return []
  const rowLimit = Math.min(Math.max(Number(limitCount) || 0, 0), 50)
  const rowsQuery = (reference) => rowLimit ? query(reference, limit(rowLimit)) : reference

  const [entitlementResult, savedResult, libraryResult] = await Promise.allSettled([
    getDocs(rowsQuery(collection(db, 'users', userId, 'entitlements'))),
    getDocs(rowsQuery(collection(db, 'users', userId, 'savedProducts'))),
    getDocs(rowsQuery(collection(db, 'users', userId, 'libraryItems')))
  ])

  const rows = []
  if (entitlementResult.status === 'fulfilled') rows.push(...entitlementResult.value.docs.map(normalizeEntitlement))
  else console.warn('[accountCommerceService] entitlement read failed', entitlementResult.reason?.message || entitlementResult.reason)

  if (savedResult.status === 'fulfilled') rows.push(...savedResult.value.docs.map(normalizeSavedProduct))
  else console.warn('[accountCommerceService] saved products read failed', savedResult.reason?.message || savedResult.reason)

  if (libraryResult.status === 'fulfilled') rows.push(...libraryResult.value.docs.map(normalizeEntitlement))
  else console.warn('[accountCommerceService] library item read failed', libraryResult.reason?.message || libraryResult.reason)

  const deduped = [...rows.reduce((map, row) => {
    const key = row.source === 'saved' ? row.id : row.productId
    const existing = map.get(key)
    if (!existing || existing.source === 'saved' || row.source === 'purchase') map.set(key, row)
    return map
  }, new Map()).values()]

  const withProducts = await Promise.all(deduped.map(async (row) => ({
    ...row,
    product: await productPreview(row.productId)
  })))

  return sortAccountRowsByDate(withProducts)
}

export async function listUserOrders(uid = '', { limitCount = 0 } = {}) {
  const userId = String(uid || '').trim()
  if (!db || !userId) return []
  const rowLimit = Math.min(Math.max(Number(limitCount) || 0, 0), 50)
  const topLevelConstraints = [where('uid', '==', userId)]
  if (rowLimit) topLevelConstraints.push(limit(rowLimit))
  const nestedReference = collection(db, 'users', userId, 'orders')

  const [topLevelResult, nestedResult] = await Promise.allSettled([
    getDocs(query(collection(db, 'orders'), ...topLevelConstraints)),
    getDocs(rowLimit ? query(nestedReference, limit(rowLimit)) : nestedReference)
  ])

  const map = new Map()
  if (topLevelResult.status === 'fulfilled') {
    topLevelResult.value.docs.forEach((docSnap) => map.set(docSnap.id, normalizeOrder(docSnap)))
  } else {
    console.warn('[accountCommerceService] order read failed', topLevelResult.reason?.message || topLevelResult.reason)
  }

  if (nestedResult.status === 'fulfilled') {
    nestedResult.value.docs.forEach((docSnap) => map.set(docSnap.id, normalizeOrder(docSnap)))
  } else {
    console.warn('[accountCommerceService] nested order read failed', nestedResult.reason?.message || nestedResult.reason)
  }

  const orders = await Promise.all([...map.values()].map(async (order) => {
    const products = await Promise.all(order.productIds.slice(0, 8).map(productPreview))
    return {
      ...order,
      products: products.filter(Boolean),
      productById: Object.fromEntries(products.filter(Boolean).map((product) => [product.id, product]))
    }
  }))

  return sortAccountRowsByDate(orders)
}

export async function getUserCommerceSummary(uid = '') {
  const userId = String(uid || '').trim()
  if (!db || !userId) return null
  const snapshot = await getDoc(doc(db, 'users', userId, 'commerceSummary', 'current')).catch(() => null)
  if (!snapshot?.exists()) return null
  const data = snapshot.data() || {}
  const spendByCurrency = data.spendByCurrency && typeof data.spendByCurrency === 'object'
    ? Object.fromEntries(Object.entries(data.spendByCurrency).map(([currency, amount]) => [
        String(currency || '').toUpperCase(),
        Math.max(0, Math.round(Number(amount || 0)))
      ]).filter(([currency]) => Boolean(currency)))
    : {}
  return {
    spendByCurrency,
    paidOrderCount: Math.max(0, Number(data.paidOrderCount || 0)),
    ownedProductCount: Math.max(0, Number(data.ownedProductCount || 0)),
    lastOrderAt: data.lastOrderAt || null,
    lastPurchaseAt: data.lastPurchaseAt || null,
    updatedAt: data.updatedAt || null
  }
}

export async function getUserOrder(uid = '', orderId = '') {
  const userId = String(uid || '').trim()
  const id = String(orderId || '').trim()
  if (!db || !userId || !id || id.includes('/')) return null

  const [topLevelSnap, nestedSnap] = await Promise.all([
    getDoc(doc(db, 'orders', id)).catch(() => null),
    getDoc(doc(db, 'users', userId, 'orders', id)).catch(() => null)
  ])
  const sourceSnap = topLevelSnap?.exists() ? topLevelSnap : nestedSnap?.exists() ? nestedSnap : null
  if (!sourceSnap) return null
  const order = normalizeOrder(sourceSnap)
  if (order.uid && order.uid !== userId) return null
  const products = await Promise.all(order.productIds.slice(0, 12).map(productPreview))
  const availableProducts = products.filter(Boolean)
  const libraryRows = await listUserLibraryItems(userId)
  const libraryByProduct = new Map(libraryRows.map((row) => [row.productId, row]))
  return {
    ...order,
    products: availableProducts,
    productById: Object.fromEntries(availableProducts.map((product) => [product.id, product])),
    libraryItems: order.productIds.map((productId) => libraryByProduct.get(productId)).filter(Boolean)
  }
}
