const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertPermission } = require('./adminAuth')
const { cleanString } = require('./adminAuth')
const { db, normalizeLimit, orderSummary, paginationFromSnapshot, safeListCollection } = require('./adminListShared')

const listAdminOrders = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'orderSupport')
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const orderId = cleanString(request.data?.orderId || '', 180)
  const cursor = cleanString(request.data?.cursor || '', 180)
  if (orderId) {
    if (orderId.includes('/')) throw new HttpsError('invalid-argument', 'A valid order id is required.')
    const snap = await db().collection('orders').doc(orderId).get()
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
    const order = orderSummary(snap)
    return {
      ok: true,
      order,
      orders: [order],
      total: 1,
      requester: { uid: claims.uid, role: claims.adminRole }
    }
  }
  const snapshot = await safeListCollection('orders', { orderBy: 'createdAt', direction: 'desc', limit, cursor })
  const orders = snapshot.docs.map(orderSummary)
  const pagination = paginationFromSnapshot(snapshot, limit)
  return {
    ok: true,
    orders,
    nextCursor: pagination.nextCursor,
    hasMore: pagination.hasMore,
    total: orders.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminOrders
}
