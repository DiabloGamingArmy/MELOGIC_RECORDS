const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')

const SEVERITIES = new Set(['info', 'warning', 'critical'])
const CATEGORIES = new Set(['account', 'support', 'moderation', 'security', 'marketplace'])

function db() {
  return admin.firestore()
}

const addAdminUserNote = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userModerate', 'orderSupport'])
  const uid = cleanString(request.data?.uid || '', 180)
  const note = cleanString(request.data?.note || '', 2400)
  const severity = SEVERITIES.has(cleanString(request.data?.severity || '', 40)) ? cleanString(request.data?.severity, 40) : 'info'
  const category = CATEGORIES.has(cleanString(request.data?.category || '', 80)) ? cleanString(request.data?.category, 80) : 'account'

  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')
  if (!note) throw new HttpsError('invalid-argument', 'Admin note is required.')

  const userRef = db().collection('users').doc(uid)
  const noteRef = userRef.collection('adminNotes').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    noteId: noteRef.id,
    uid,
    note,
    severity,
    category,
    createdAt: now,
    createdBy: claims.uid,
    createdByEmail: claims.email || '',
    visibility: 'admin_only'
  }

  await noteRef.set(payload)
  await writeAdminAuditLog({
    actorUid: claims.uid,
    actorEmail: claims.email,
    actorRole: claims.adminRole,
    action: 'user_note_add',
    targetType: 'user',
    targetId: uid,
    targetPath: `users/${uid}/adminNotes/${noteRef.id}`,
    reason: note.slice(0, 240),
    after: { noteId: noteRef.id, severity, category }
  })

  return {
    ok: true,
    note: {
      ...payload,
      createdAt: new Date().toISOString()
    }
  }
})

module.exports = {
  addAdminUserNote
}
