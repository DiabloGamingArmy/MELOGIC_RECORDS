const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const {
  assertPermission,
  requireAdminActionSecurity,
  buildAdminClaims,
  cleanString,
  mergeAdminClaims,
  normalizeRole,
  pickAdminClaims,
  roleRank,
  stripAdminClaims
} = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const { writeAccountEvent } = require('../account/accountEvents')

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

async function assertOwnerWillRemain(uid = '') {
  const owners = await db()
    .collection('adminUsers')
    .where('role', '==', 'owner')
    .where('active', '==', true)
    .limit(2)
    .get()
  const otherOwnerExists = owners.docs.some((doc) => doc.id !== uid)
  if (!otherOwnerExists) {
    throw new HttpsError('failed-precondition', 'The last owner cannot be removed or downgraded.')
  }
}

const setAdminUserRole = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const actor = await requireAdminActionSecurity(request, 'roleManage')
  const uid = normalizeUid(request.data?.uid)
  const requestedRole = normalizeRole(request.data?.role || '')
  const active = request.data?.active !== false && requestedRole !== 'remove'
  if (!requestedRole) throw new HttpsError('invalid-argument', 'A valid role is required.')
  if (uid === actor.uid) {
    throw new HttpsError('failed-precondition', 'You cannot change your own admin role.')
  }

  const [userRecord, existingAdminUser] = await Promise.all([
    admin.auth().getUser(uid),
    db().collection('adminUsers').doc(uid).get()
  ])
  const existingClaims = userRecord.customClaims || {}
  const currentAdminData = existingAdminUser.exists ? existingAdminUser.data() || {} : {}
  const actorRole = normalizeRole(actor.adminRole || '')
  const currentTargetRole = normalizeRole(existingClaims.adminRole || currentAdminData.role || '')
  const actorRank = roleRank(actorRole)
  const targetRank = roleRank(currentTargetRole)
  const requestedRank = active ? roleRank(requestedRole) : 0
  const actorIsOwner = actorRole === 'owner'

  if (!actorIsOwner) {
    if (requestedRank >= actorRank) {
      throw new HttpsError('permission-denied', 'You cannot assign a role equal to or higher than your own.')
    }
    if (targetRank >= actorRank) {
      throw new HttpsError('permission-denied', 'You cannot manage a role equal to or higher than your own.')
    }
  }
  if (currentTargetRole === 'owner' && (!active || requestedRole !== 'owner')) {
    await assertOwnerWillRemain(uid)
  }

  const nextClaims = active
    ? mergeAdminClaims(existingClaims, requestedRole, true)
    : stripAdminClaims(existingClaims)
  const adminClaims = active ? buildAdminClaims(requestedRole) : {}

  await admin.auth().setCustomUserClaims(uid, nextClaims)

  const adminUserRef = db().collection('adminUsers').doc(uid)
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
  await writeAccountEvent(db(), uid, {
    type: 'admin_role_changed',
    severity: active && ['admin', 'owner'].includes(requestedRole) ? 'critical' : 'warning',
    title: active ? 'Admin role changed' : 'Admin role removed',
    message: active
      ? `Your admin role was changed to ${requestedRole}.`
      : 'Your admin access was removed.',
    actorUid: actor.uid,
    actorType: 'admin',
    source: 'admin-roles',
    path: '',
    metadata: {
      requestedRole,
      active,
      auditLogId
    }
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
