const admin = require('firebase-admin')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { assertAnyPermission } = require('../admin/adminAuth')
const { ledgerEntryId } = require('./creatorEarnings')

function cleanString(value = '', max = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

async function findOrder(database, { orderId = '', sessionId = '' } = {}) {
  const safeOrderId = cleanString(orderId, 180)
  if (safeOrderId && !safeOrderId.includes('/')) {
    const snap = await database.collection('orders').doc(safeOrderId).get()
    if (snap.exists) return snap
  }
  const safeSessionId = cleanString(sessionId, 180)
  if (!safeSessionId || safeSessionId.includes('/')) return null
  for (const field of ['stripeSessionId', 'checkoutSessionId']) {
    const querySnap = await database.collection('orders').where(field, '==', safeSessionId).limit(1).get()
    if (querySnap.docs[0]) return querySnap.docs[0]
  }
  return null
}

function sellerUidForLine(order = {}, productId = '') {
  const item = (Array.isArray(order.items) ? order.items : []).find((row) => cleanString(row?.productId || row?.id || '', 180) === productId) || {}
  return cleanString(item.creatorUid || item.sellerUid || item.artistId || item.productSnapshot?.creatorUid || '', 180)
}

const auditCheckoutSessionFulfillment = onCall({
  timeoutSeconds: 60,
  cors: true
}, async (request) => {
  assertAnyPermission(request, ['auditRead', 'orderSupport'])
  const database = admin.firestore()
  const orderSnap = await findOrder(database, {
    orderId: request.data?.orderId,
    sessionId: request.data?.sessionId
  })
  if (!orderSnap?.exists) throw new HttpsError('not-found', 'Checkout order was not found.')

  const order = orderSnap.data() || {}
  const orderId = orderSnap.id
  const buyerUid = cleanString(order.buyerUid || order.uid || order.userId || '', 180)
  const productIds = (Array.isArray(order.productIds) ? order.productIds : [])
    .map((value) => cleanString(value, 180))
    .filter(Boolean)
  const [buyerOrderSnap, commerceSummarySnap] = buyerUid
    ? await Promise.all([
        database.doc(`users/${buyerUid}/orders/${orderId}`).get(),
        database.doc(`users/${buyerUid}/commerceSummary/current`).get()
      ])
    : [null, null]

  const lines = await Promise.all(productIds.map(async (productId) => {
    const sellerUid = sellerUidForLine(order, productId)
    const saleId = ledgerEntryId(orderId, productId)
    const [librarySnap, entitlementSnap, saleSnap, ledgerSnap, platformSnap, earningsSnap] = await Promise.all([
      buyerUid ? database.doc(`users/${buyerUid}/libraryItems/${productId}`).get() : null,
      buyerUid ? database.doc(`users/${buyerUid}/entitlements/${productId}`).get() : null,
      sellerUid ? database.doc(`users/${sellerUid}/sales/${saleId}`).get() : null,
      database.doc(`creatorLedger/${saleId}`).get(),
      database.doc(`platformRevenueLedger/${saleId}`).get(),
      sellerUid ? database.doc(`users/${sellerUid}/earningsSummary/current`).get() : null
    ])
    return {
      productId,
      sellerUid,
      saleId,
      buyerLibraryItemExists: librarySnap?.exists === true,
      buyerEntitlementExists: entitlementSnap?.exists === true,
      sellerSaleExists: saleSnap?.exists === true,
      creatorLedgerExists: ledgerSnap.exists === true,
      platformRevenueExists: platformSnap.exists === true,
      sellerEarningsSummaryExists: earningsSnap?.exists === true
    }
  }))

  return {
    ok: true,
    orderId,
    buyerUid,
    stripeSessionId: cleanString(order.stripeSessionId || order.checkoutSessionId || '', 180),
    paymentStatus: cleanString(order.paymentStatus || '', 80),
    orderState: cleanString(order.orderState || '', 80),
    orderExists: true,
    buyerOrderMirrorExists: buyerOrderSnap?.exists === true,
    commerceSummaryExists: commerceSummarySnap?.exists === true,
    productIds,
    lines
  }
})

module.exports = {
  auditCheckoutSessionFulfillment,
  __test: {
    sellerUidForLine
  }
}
