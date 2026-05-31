const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { db, normalizeLimit, orderSummary, productSummary, profileSummary, reportSummary, safeListCollection } = require('./adminListShared')

function matchesFilter(report = {}, filter = '') {
  if (!filter || filter === 'all') return true
  if (filter === 'open') return !report.status || report.status === 'open'
  if (filter === 'in_review') return report.status === 'in_review'
  if (filter === 'resolved') return report.status === 'resolved'
  if (filter === 'dismissed') return report.status === 'dismissed'
  if (filter === 'product') return report.targetType === 'product' || report.type === 'product'
  if (filter === 'user') return ['user', 'profile'].includes(report.targetType) || ['user', 'profile'].includes(report.type)
  if (filter === 'order') return report.targetType === 'order' || report.type === 'order'
  return true
}

async function loadProfileSummary(uid = '') {
  if (!uid) return null
  const [profileSnap, userSnap, adminSnap] = await Promise.all([
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).get(),
    db().collection('adminUsers').doc(uid).get()
  ])
  if (!profileSnap.exists && !userSnap.exists && !adminSnap.exists) return null
  return profileSummary(
    profileSnap.exists ? profileSnap : { id: uid, data: () => ({ uid }) },
    adminSnap.exists ? adminSnap.data() || {} : null,
    userSnap.exists ? userSnap.data() || {} : {}
  )
}

async function enrichReport(report = {}) {
  const [reporter, target] = await Promise.all([
    loadProfileSummary(report.reporterUid).catch(() => null),
    (async () => {
      if (report.targetType === 'product' && report.targetId) {
        const productSnap = await db().collection('products').doc(report.targetId).get()
        return productSnap.exists ? productSummary(productSnap) : null
      }
      if (['profile', 'user'].includes(report.targetType) && report.targetId) {
        return loadProfileSummary(report.targetId)
      }
      if (report.targetType === 'order' && report.targetId) {
        const orderSnap = await db().collection('orders').doc(report.targetId).get()
        return orderSnap.exists ? orderSummary(orderSnap) : null
      }
      return null
    })().catch(() => null)
  ])
  return { reporter, target }
}

const listAdminReports = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userModerate', 'productReview', 'orderSupport'])
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const reportId = cleanString(request.data?.reportId || '', 180)
  const filter = cleanString(request.data?.filter || '', 80)

  if (reportId) {
    if (reportId.includes('/')) throw new HttpsError('invalid-argument', 'A valid report id is required.')
    const snap = await db().collection('reports').doc(reportId).get()
    if (!snap.exists) throw new HttpsError('not-found', 'Report not found.')
    const report = reportSummary(snap)
    const detail = await enrichReport(report)
    return {
      ok: true,
      report,
      reports: [report],
      total: 1,
      ...detail,
      requester: { uid: claims.uid, role: claims.adminRole }
    }
  }

  const snapshot = await safeListCollection('reports', { orderBy: 'createdAt', direction: 'desc', limit })
  const reports = snapshot.docs.map(reportSummary).filter((report) => matchesFilter(report, filter))
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
