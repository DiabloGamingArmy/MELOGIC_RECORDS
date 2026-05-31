const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')

const ACTIONS = new Set(['assign_self', 'in_review', 'dismiss', 'resolve', 'action_taken'])

function db() {
  return admin.firestore()
}

function buildPatch(action = '', actorUid = '', reason = '', notes = '') {
  const now = admin.firestore.FieldValue.serverTimestamp()
  const base = {
    updatedAt: now,
    lastAction: action,
    lastActionAt: now,
    lastActionBy: actorUid
  }
  if (action === 'assign_self') return { ...base, assignedTo: actorUid, status: 'in_review' }
  if (action === 'in_review') return { ...base, status: 'in_review' }
  if (action === 'dismiss') {
    return {
      ...base,
      status: 'dismissed',
      resolution: reason,
      adminNotes: notes,
      resolvedAt: now,
      resolvedBy: actorUid
    }
  }
  if (action === 'resolve') {
    return {
      ...base,
      status: 'resolved',
      resolution: reason,
      adminNotes: notes,
      resolvedAt: now,
      resolvedBy: actorUid
    }
  }
  return {
    ...base,
    status: 'action_taken',
    resolution: reason,
    adminNotes: notes,
    resolvedAt: now,
    resolvedBy: actorUid
  }
}

const updateReportDecision = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const actor = assertAnyPermission(request, ['userModerate', 'productReview', 'orderSupport'])
  const reportId = cleanString(request.data?.reportId || '', 180)
  const action = cleanString(request.data?.action || '', 40)
  const reason = cleanString(request.data?.reason || '', 1200)
  const notes = cleanString(request.data?.notes || '', 2400)

  if (!reportId || reportId.includes('/')) throw new HttpsError('invalid-argument', 'A valid report id is required.')
  if (!ACTIONS.has(action)) throw new HttpsError('invalid-argument', 'A valid report action is required.')
  if (['dismiss', 'resolve', 'action_taken'].includes(action) && !reason) {
    throw new HttpsError('invalid-argument', 'A reason is required for this report action.')
  }

  const reportRef = db().collection('reports').doc(reportId)
  const beforeSnap = await reportRef.get()
  if (!beforeSnap.exists) throw new HttpsError('not-found', 'Report not found.')
  const before = beforeSnap.data() || {}
  const patch = buildPatch(action, actor.uid, reason, notes)
  await reportRef.set(patch, { merge: true })

  const afterSnap = await reportRef.get()
  const auditLogId = await writeAdminAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.adminRole,
    action: `report_${action}`,
    targetType: 'report',
    targetId: reportId,
    targetPath: `reports/${reportId}`,
    reason: reason || `Report ${action}`,
    before,
    after: afterSnap.data() || {},
    metadata: {
      reportId,
      reportTargetType: before.targetType || '',
      reportTargetId: before.targetId || '',
      notes
    }
  })

  return {
    ok: true,
    reportId,
    action,
    status: patch.status || before.status || 'open',
    assignedTo: patch.assignedTo || before.assignedTo || '',
    auditLogId
  }
})

module.exports = {
  updateReportDecision
}
