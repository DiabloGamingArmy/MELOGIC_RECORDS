const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertPermission, cleanString } = require('./adminAuth')
const { db, logSummary, orderSummary } = require('./adminListShared')

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

const getAdminOrder = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'orderSupport')
  const orderId = cleanString(request.data?.orderId || '', 180)
  if (!orderId || orderId.includes('/')) throw new HttpsError('invalid-argument', 'A valid order id is required.')

  const snap = await db().collection('orders').doc(orderId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found.')
  const order = orderSummary(snap)
  const logs = await loadOrderLogs(orderId)

  return {
    ok: true,
    order,
    logs,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getAdminOrder
}
