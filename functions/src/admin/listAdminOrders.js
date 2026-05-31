const { onCall } = require('firebase-functions/v2/https')
const { assertPermission } = require('./adminAuth')
const { normalizeLimit, orderSummary, safeListCollection } = require('./adminListShared')

const listAdminOrders = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'orderSupport')
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const snapshot = await safeListCollection('orders', { orderBy: 'createdAt', direction: 'desc', limit })
  const orders = snapshot.docs.map(orderSummary)
  return {
    ok: true,
    orders,
    total: orders.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminOrders
}
