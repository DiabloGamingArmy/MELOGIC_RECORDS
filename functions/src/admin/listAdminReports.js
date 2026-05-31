const { onCall } = require('firebase-functions/v2/https')
const { assertAnyPermission } = require('./adminAuth')
const { normalizeLimit, reportSummary, safeListCollection } = require('./adminListShared')

const listAdminReports = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userModerate', 'productReview', 'orderSupport'])
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const snapshot = await safeListCollection('reports', { orderBy: 'createdAt', direction: 'desc', limit })
  const reports = snapshot.docs.map(reportSummary)
  return {
    ok: true,
    reports,
    total: reports.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminReports
}
