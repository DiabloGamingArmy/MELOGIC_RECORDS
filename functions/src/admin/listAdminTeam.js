const { onCall } = require('firebase-functions/v2/https')
const { assertPermission } = require('./adminAuth')
const { adminUserSummary, normalizeLimit, safeListCollection } = require('./adminListShared')

const listAdminTeam = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'roleManage')
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const snapshot = await safeListCollection('adminUsers', { orderBy: 'updatedAt', direction: 'desc', limit })
  const team = snapshot.docs.map(adminUserSummary)
  return {
    ok: true,
    team,
    total: team.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminTeam
}
