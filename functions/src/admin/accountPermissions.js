const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { cleanString, requireAdminActionSecurity } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const {
  DEFAULT_PERMISSIONS,
  PUBLIC_BADGE_KEYS,
  cleanBoolMap,
  loadAccountPermissionInputs,
  resolveAccountPermissions
} = require('../account/accountPermissions')

const RESTRICTION_KEYS = [
  'suspended',
  'liveSuspended',
  'musicRestricted',
  'marketplaceRestricted',
  'communityRestricted',
  'studioRestricted',
  'messagingRestricted'
]

function db() {
  return admin.firestore()
}

function permissionDocSummary(raw = {}) {
  return {
    exists: raw.exists === true,
    permissions: cleanBoolMap(raw.permissions || {}),
    badges: cleanBoolMap(raw.badges || {}, PUBLIC_BADGE_KEYS),
    restrictions: cleanBoolMap(raw.restrictions || {}, RESTRICTION_KEYS),
    changeReason: cleanString(raw.changeReason || '', 1200),
    expiresAt: raw.expiresAt || null
  }
}

function publicBadgeMirror(badges = {}) {
  return PUBLIC_BADGE_KEYS.reduce((result, key) => {
    result[`badge_${key}`] = badges[key] === true
    return result
  }, {})
}

const getAdminAccountPermissions = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  await requireAdminActionSecurity(request, ['userRead', 'userModerate', 'roleManage'])
  const uid = cleanString(request.data?.uid || '', 180)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')
  const inputs = await loadAccountPermissionInputs(uid)
  return {
    ok: true,
    uid,
    defaults: DEFAULT_PERMISSIONS,
    explicit: permissionDocSummary(inputs.explicit || {}),
    effective: resolveAccountPermissions(inputs),
    path: inputs.path
  }
})

const updateAdminAccountPermissions = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = await requireAdminActionSecurity(request, ['userModerate', 'roleManage'])
  const uid = cleanString(request.data?.uid || '', 180)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')
  const reason = cleanString(request.data?.changeReason || request.data?.reason || '', 1200)
  if (!reason) throw new HttpsError('invalid-argument', 'A change reason is required.')

  const expiresAtInput = cleanString(request.data?.expiresAt || '', 80)
  const expiresAt = expiresAtInput ? new Date(expiresAtInput) : null
  if (expiresAtInput && Number.isNaN(expiresAt.getTime())) throw new HttpsError('invalid-argument', 'Expiration must be a valid date.')

  const beforeInputs = await loadAccountPermissionInputs(uid)
  const beforeExplicit = permissionDocSummary(beforeInputs.explicit || {})
  const permissions = cleanBoolMap(request.data?.permissions || {})
  const badges = cleanBoolMap(request.data?.badges || {}, PUBLIC_BADGE_KEYS)
  const restrictions = cleanBoolMap(request.data?.restrictions || {}, RESTRICTION_KEYS)
  const ref = db().collection('users').doc(uid).collection('permissions').doc('current')
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    permissions,
    badges,
    restrictions,
    updatedAt: now,
    updatedByUid: claims.uid,
    updatedByEmail: claims.email || '',
    updatedByDisplayName: cleanString(request.auth?.token?.name || '', 160),
    changeReason: reason
  }
  if (expiresAt) payload.expiresAt = admin.firestore.Timestamp.fromDate(expiresAt)
  else payload.expiresAt = null

  await ref.set(payload, { merge: true })
  await db().collection('profiles').doc(uid).set({
    publicBadges: publicBadgeMirror(badges),
    updatedAt: now
  }, { merge: true })
  await writeAdminAuditLog({
    actorUid: claims.uid,
    actorEmail: claims.email,
    actorRole: claims.adminRole,
    action: 'account_permissions_updated',
    targetType: 'user',
    targetId: uid,
    targetPath: `users/${uid}/permissions/current`,
    reason,
    before: beforeExplicit,
    after: permissionDocSummary(payload)
  })

  const afterInputs = await loadAccountPermissionInputs(uid)
  return {
    ok: true,
    uid,
    explicit: permissionDocSummary(afterInputs.explicit || {}),
    effective: resolveAccountPermissions(afterInputs),
    path: afterInputs.path
  }
})

module.exports = {
  getAdminAccountPermissions,
  updateAdminAccountPermissions
}
