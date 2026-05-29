import { collection, getDocs, query, where } from 'firebase/firestore'
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
  return {
    id: docSnap.id,
    productId: String(data.productId || docSnap.id || ''),
    source: String(data.source || ''),
    orderId: String(data.orderId || ''),
    license: String(data.license || data.licenseType || 'Standard License'),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null
  }
}

function normalizeSavedProduct(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: `saved-${docSnap.id}`,
    productId: String(data.productId || docSnap.id || ''),
    source: 'saved',
    orderId: '',
    license: '',
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null
  }
}

function normalizeOrder(docSnap) {
  const data = docSnap.data() || {}
  const productIds = Array.isArray(data.productIds) ? data.productIds.map(String).filter(Boolean) : []
  return {
    id: docSnap.id,
    uid: String(data.uid || data.buyerId || ''),
    productIds,
    status: String(data.status || data.paymentStatus || 'unknown'),
    paymentStatus: String(data.paymentStatus || data.status || 'unknown'),
    stripeSessionId: String(data.stripeSessionId || ''),
    paymentIntentId: String(data.paymentIntentId || ''),
    amountTotalCents: Number(data.amountTotalCents || data.totalCents || 0),
    currency: String(data.currency || 'usd').toUpperCase(),
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

export async function listUserLibraryItems(uid = '') {
  const userId = String(uid || '').trim()
  if (!db || !userId) return []

  const [entitlementResult, savedResult, libraryResult] = await Promise.allSettled([
    getDocs(collection(db, 'users', userId, 'entitlements')),
    getDocs(collection(db, 'users', userId, 'savedProducts')),
    getDocs(collection(db, 'users', userId, 'libraryItems'))
  ])

  const rows = []
  if (entitlementResult.status === 'fulfilled') rows.push(...entitlementResult.value.docs.map(normalizeEntitlement))
  else console.warn('[accountCommerceService] entitlement read failed', entitlementResult.reason?.message || entitlementResult.reason)

  if (savedResult.status === 'fulfilled') rows.push(...savedResult.value.docs.map(normalizeSavedProduct))
  else console.warn('[accountCommerceService] saved products read failed', savedResult.reason?.message || savedResult.reason)

  if (libraryResult.status === 'fulfilled') rows.push(...libraryResult.value.docs.map(normalizeEntitlement))
  else console.warn('[accountCommerceService] library item read failed', libraryResult.reason?.message || libraryResult.reason)

  const withProducts = await Promise.all(rows.map(async (row) => ({
    ...row,
    product: await productPreview(row.productId)
  })))

  return sortAccountRowsByDate(withProducts)
}

export async function listUserOrders(uid = '') {
  const userId = String(uid || '').trim()
  if (!db || !userId) return []

  const [topLevelResult, nestedResult] = await Promise.allSettled([
    getDocs(query(collection(db, 'orders'), where('uid', '==', userId))),
    getDocs(collection(db, 'users', userId, 'orders'))
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
    return { ...order, products: products.filter(Boolean) }
  }))

  return sortAccountRowsByDate(orders)
}
