const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const {
  assertPermission,
  buildAdminClaims,
  cleanString,
  mergeAdminClaims,
  normalizeRole,
  pickAdminClaims,
  stripAdminClaims
} = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')

function db() {
  return admin.firestore()
}

function normalizeUid(value = '') {
  const uid = cleanString(value, 180)
  if (!uid || uid === '.' || uid === '..' || uid.includes('/')) {
    throw new HttpsError('invalid-argument', 'A valid user uid is required.')
  }
  return uid
}

function adminUserMetadata({ uid = '', role = '', active = true, userRecord = null, claims = {} } = {}) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  return {
    uid,
    active,
    role: active ? role : '',
    claims: pickAdminClaims(claims),
    email: cleanString(userRecord?.email || '', 320),
    displayName: cleanString(userRecord?.displayName || '', 180),
    photoURL: cleanString(userRecord?.photoURL || '', 900),
    updatedAt: now
  }
}

const setAdminUserRole = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const actor = assertPermission(request, 'roleManage')
  const uid = normalizeUid(request.data?.uid)
  const requestedRole = normalizeRole(request.data?.role || '')
  const active = request.data?.active !== false && requestedRole !== 'remove'
  if (!requestedRole) throw new HttpsError('invalid-argument', 'A valid role is required.')

  const userRecord = await admin.auth().getUser(uid)
  const existingClaims = userRecord.customClaims || {}
  const nextClaims = active
    ? mergeAdminClaims(existingClaims, requestedRole, true)
    : stripAdminClaims(existingClaims)
  const adminClaims = active ? buildAdminClaims(requestedRole) : {}

  await admin.auth().setCustomUserClaims(uid, nextClaims)

  const adminUserRef = db().collection('adminUsers').doc(uid)
  const existingAdminUser = await adminUserRef.get()
  await adminUserRef.set({
    ...(existingAdminUser.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    ...adminUserMetadata({ uid, role: requestedRole, active, userRecord, claims: active ? adminClaims : {} }),
    updatedBy: actor.uid
  }, { merge: true })

  const auditLogId = await writeAdminAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.adminRole,
    action: active ? 'admin_role_set' : 'admin_role_removed',
    targetType: 'user',
    targetId: uid,
    targetPath: `adminUsers/${uid}`,
    reason: cleanString(request.data?.reason || '', 1200),
    before: pickAdminClaims(existingClaims),
    after: pickAdminClaims(nextClaims),
    metadata: { requestedRole, active }
  })

  return {
    ok: true,
    uid,
    role: active ? requestedRole : '',
    active,
    claims: pickAdminClaims(nextClaims),
    auditLogId
  }
})

module.exports = {
  setAdminUserRole
}
