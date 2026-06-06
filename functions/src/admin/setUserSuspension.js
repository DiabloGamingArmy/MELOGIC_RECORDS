const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString, normalizeRole, requireAdminActionSecurity, roleRank } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const { writeAccountEvent } = require('../account/accountEvents')

const DURATIONS = {
  indefinite: 0,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
}

function db() {
  return admin.firestore()
}

async function assertCanSuspendTarget(claims, uid, suspended) {
  if (uid === claims.uid) throw new HttpsError('failed-precondition', 'You cannot suspend your own account.')

  const targetAdminSnap = await db().collection('adminUsers').doc(uid).get()
  const targetAdmin = targetAdminSnap.exists ? targetAdminSnap.data() || {} : {}
  const targetRole = normalizeRole(targetAdmin.role || '')
  const targetActive = targetAdmin.active === true && targetRole && targetRole !== 'remove'
  if (!targetActive) return targetAdmin

  const requesterRole = normalizeRole(claims.adminRole || '')
  if (requesterRole !== 'owner' && roleRank(requesterRole) <= roleRank(targetRole)) {
    throw new HttpsError('permission-denied', 'Hierarchy rules block suspending this account.')
  }

  if (suspended && targetRole === 'owner') {
    const owners = await db().collection('adminUsers').where('role', '==', 'owner').where('active', '==', true).limit(2).get()
    if (owners.size <= 1 && owners.docs[0]?.id === uid) {
      throw new HttpsError('failed-precondition', 'The last owner account cannot be suspended.')
    }
  }

  return targetAdmin
}

function suspensionUntil(duration = '') {
  const key = cleanString(duration || 'indefinite', 40)
  const ms = DURATIONS[key] || 0
  return ms ? admin.firestore.Timestamp.fromMillis(Date.now() + ms) : null
}

const setUserSuspension = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = await requireAdminActionSecurity(request, ['userModerate'])
  const uid = cleanString(request.data?.uid || '', 180)
  const suspended = request.data?.suspended === true
  const reason = cleanString(request.data?.reason || '', 1200)
  const duration = cleanString(request.data?.duration || 'indefinite', 40)
  const note = cleanString(request.data?.note || '', 1200)

  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.')
  if (suspended && !Object.prototype.hasOwnProperty.call(DURATIONS, duration)) {
    throw new HttpsError('invalid-argument', 'A valid duration is required.')
  }

  await assertCanSuspendTarget(claims, uid, suspended)

  const userRef = db().collection('users').doc(uid)
  const profileRef = db().collection('profiles').doc(uid)
  const [userSnap, profileSnap] = await Promise.all([userRef.get(), profileRef.get()])
  const before = {
    user: userSnap.exists ? userSnap.data() || {} : null,
    profile: profileSnap.exists ? profileSnap.data() || {} : null
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const until = suspended ? suspensionUntil(duration) : null
  const userPayload = suspended
    ? {
        accountStatus: 'suspended',
        suspended: true,
        suspendedAt: now,
        suspendedBy: claims.uid,
        suspensionReason: reason,
        suspensionNote: note,
        suspensionDuration: duration,
        suspensionUntil: until,
        updatedAt: now
      }
    : {
        accountStatus: 'active',
        suspended: false,
        unsuspendedAt: now,
        unsuspendedBy: claims.uid,
        unsuspensionReason: reason,
        suspensionReason: admin.firestore.FieldValue.delete(),
        suspensionNote: admin.firestore.FieldValue.delete(),
        suspensionDuration: admin.firestore.FieldValue.delete(),
        suspensionUntil: admin.firestore.FieldValue.delete(),
        updatedAt: now
      }
  const profilePayload = suspended
    ? {
        accountStatus: 'suspended',
        suspended: true,
        updatedAt: now
      }
    : {
        accountStatus: 'active',
        suspended: false,
        updatedAt: now
      }

  const writes = [userRef.set(userPayload, { merge: true })]
  if (profileSnap.exists) writes.push(profileRef.set(profilePayload, { merge: true }))
  await Promise.all(writes)

  await writeAdminAuditLog({
    actorUid: claims.uid,
    actorEmail: claims.email,
    actorRole: claims.adminRole,
    action: suspended ? 'user_suspend' : 'user_unsuspend',
    targetType: 'user',
    targetId: uid,
    targetPath: `users/${uid}`,
    reason,
    before,
    after: { suspended, duration: suspended ? duration : '', note: Boolean(note) }
  })

  await writeAccountEvent(db(), uid, {
    type: suspended ? 'account_suspended' : 'account_unsuspended',
    severity: suspended ? 'critical' : 'success',
    title: suspended ? 'Account suspended' : 'Account unsuspended',
    message: suspended ? `Your account has been suspended. Reason: ${reason}` : `Your account has been restored. Reason: ${reason}`,
    actorUid: claims.uid,
    actorType: 'admin',
    source: 'admin_console',
    path: '/account/security',
    metadata: { duration: suspended ? duration : '', suspensionUntil: until ? until.toDate().toISOString() : '' }
  })

  return {
    ok: true,
    uid,
    suspended,
    accountStatus: suspended ? 'suspended' : 'active',
    suspensionUntil: until ? until.toDate().toISOString() : ''
  }
})

module.exports = {
  setUserSuspension
}
