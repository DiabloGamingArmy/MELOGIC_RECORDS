const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertPermission, cleanString } = require('./adminAuth')
const { db, logSummary, orderSummary, safeSummaryValue, serializeDate } = require('./adminListShared')

async function loadOrderLogs(orderId = '') {
  try {
    const snapshot = await db().collection('adminLogs').where('targetId', '==', orderId).limit(25).get()
    return snapshot.docs
      .map(logSummary)
      .filter((log) => !log.targetType || log.targetType === 'order' || log.targetId === orderId)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
  } catch {
    return []
  }
}

function commerceRowSummary(docSnap) {
  const raw = docSnap.exists ? docSnap.data() || {} : {}
  return {
    id: docSnap.id,
    exists: docSnap.exists,
    uid: cleanString(raw.uid || '', 180),
    productId: cleanString(raw.productId || docSnap.id, 180),
    orderId: cleanString(raw.orderId || '', 180),
    source: cleanString(raw.source || '', 120),
    status: cleanString(raw.status || 'active', 80),
    license: cleanString(raw.license || raw.licenseType || '', 160),
    stripeSessionId: cleanString(raw.stripeSessionId || '', 180),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt),
    revokedAt: serializeDate(raw.revokedAt),
    refundedAt: serializeDate(raw.refundedAt),
    productSnapshot: safeSummaryValue(raw.productSnapshot || {})
  }
}

async function loadCommerceState(order = {}) {
  const uid = order.buyerUid || order.uid || ''
  const productIds = Array.isArray(order.productIds) ? order.productIds.filter(Boolean).slice(0, 25) : []
  if (!uid || !productIds.length) return { entitlements: [], libraryItems: [], warnings: ['Order has no buyer/product entitlement targets.'] }

  const [entitlementSnaps, librarySnaps] = await Promise.all([
    Promise.all(productIds.map((productId) => db().doc(`users/${uid}/entitlements/${productId}`).get().catch(() => null))),
    Promise.all(productIds.map((productId) => db().doc(`users/${uid}/libraryItems/${productId}`).get().catch(() => null)))
  ])
  const entitlements = entitlementSnaps.filter(Boolean).map(commerceRowSummary)
  const libraryItems = librarySnaps.filter(Boolean).map(commerceRowSummary)
  const entitlementByProduct = new Map(entitlements.map((row) => [row.productId, row]))
  const libraryByProduct = new Map(libraryItems.map((row) => [row.productId, row]))
  const paymentComplete = ['paid', 'complete', 'completed'].includes(String(order.paymentStatus || order.status || '').toLowerCase())
  const refunded = ['refunded', 'complete', 'completed'].includes(String(order.refundStatus || '').toLowerCase())
  const warnings = []

  productIds.forEach((productId) => {
    const entitlement = entitlementByProduct.get(productId)
    const library = libraryByProduct.get(productId)
    if (paymentComplete && !entitlement?.exists) warnings.push(`Order paid but entitlement missing for ${productId}.`)
    if (entitlement?.exists && !library?.exists) warnings.push(`Entitlement exists but library item missing for ${productId}.`)
    if (refunded && entitlement?.status === 'active') warnings.push(`Refunded order still has active entitlement for ${productId}.`)
  })
  if (!paymentComplete) warnings.push('Order exists but payment is not complete.')

  return { entitlements, libraryItems, warnings }
}

const getAdminOrder = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'orderSupport')
  const orderId = cleanString(request.data?.orderId || '', 180)
  if (!orderId || orderId.includes('/')) throw new HttpsError('invalid-argument', 'A valid order id is required.')

  const snap = await db().collection('orders').doc(orderId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
  const order = orderSummary(snap)
  const [logs, commerce] = await Promise.all([
    loadOrderLogs(orderId),
    loadCommerceState(order)
  ])

  return {
    ok: true,
    order,
    logs,
    entitlements: commerce.entitlements,
    libraryItems: commerce.libraryItems,
    mismatchWarnings: commerce.warnings,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getAdminOrder
}
