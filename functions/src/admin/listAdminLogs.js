const { onCall } = require('firebase-functions/v2/https')
const { assertPermission } = require('./adminAuth')
const { logSummary, normalizeLimit, safeListCollection } = require('./adminListShared')

const listAdminLogs = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'auditRead')
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const snapshot = await safeListCollection('adminLogs', { orderBy: 'createdAt', direction: 'desc', limit })
  const logs = snapshot.docs.map(logSummary)
  return {
    ok: true,
    logs,
    total: logs.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminLogs
}
