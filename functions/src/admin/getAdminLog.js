const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertPermission, cleanString } = require('./adminAuth')
const { db, logSummary } = require('./adminListShared')

const getAdminLog = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'auditRead')
  const logId = cleanString(request.data?.logId || '', 180)
  if (!logId || logId.includes('/')) throw new HttpsError('invalid-argument', 'A valid log id is required.')

  const snap = await db().collection('adminLogs').doc(logId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Log not found.')

  return {
    ok: true,
    log: logSummary(snap),
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getAdminLog
}
