const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString, requireAdminActionSecurity } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const {
  DEFAULT_PERMISSIONS,
  PUBLIC_BADGE_KEYS,
  cleanBoolMap,
  loadAccountPermissionInputs,
  resolveAccountPermissions
} = require('../account/accountPermissions')
const { listRoleDefinitions, normalizeRoleArray } = require('../roles/roleRegistry')

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

// melogic-account-role-badge-assignment-v3
async function loadCanonicalRoleState(uid = '') {
  const [userSnap, profileSnap, definitions] = await Promise.all([
    db().collection('users').doc(uid).get(),
    db().collection('profiles').doc(uid).get(),
    listRoleDefinitions({ includeDisabled: true })
  ])
  return {
    roles: normalizeRoleArray(userSnap.data()?.roles || []),
    badges: normalizeRoleArray(profileSnap.data()?.badges || []),
    roleDefinitions: definitions
  }
}

function validateAssignments(values = [], definitions = [], capability = '') {
  const normalized = normalizeRoleArray(values)
  const allowed = new Set(definitions
    .filter((item) => item.enabled !== false && item?.[capability] === true)
    .map((item) => item.key))
  const invalid = normalized.filter((key) => !allowed.has(key))
  if (invalid.length) throw new HttpsError('invalid-argument', `Unknown or unavailable role definitions: ${invalid.join(', ')}`)
  return normalized
}

// melogic-role-assignment-integrity-audit-v4
function assignmentDiff(before = [], after = []) {
  const beforeSet = new Set(normalizeRoleArray(before))
  const afterSet = new Set(normalizeRoleArray(after))
  return {
    added: [...afterSet].filter((key) => !beforeSet.has(key)).sort(),
    removed: [...beforeSet].filter((key) => !afterSet.has(key)).sort(),
    unchanged: [...afterSet].filter((key) => beforeSet.has(key)).sort()
  }
}

function sameRoleArray(left = [], right = []) {
  const a = [...normalizeRoleArray(left)].sort()
  const b = [...normalizeRoleArray(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function assignmentAuditSummary(beforeRoles = [], afterRoles = [], beforeBadges = [], afterBadges = []) {
  const roles = assignmentDiff(beforeRoles, afterRoles)
  const badges = assignmentDiff(beforeBadges, afterBadges)
  return {
    roles,
    badges,
    rolesChanged: roles.added.length > 0 || roles.removed.length > 0,
    badgesChanged: badges.added.length > 0 || badges.removed.length > 0
  }
}

// melogic-admin-account-permissions-read-v1
// Reading the selected user's current permission state is not a mutation and
// must not require the 60-second MFA step-up window. The Admin Users UI opens
// this callable directly; requiring fresh step-up here caused the read to fail
// and the dialog to fall back to unchecked controls.
const getAdminAccountPermissions = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  assertAnyPermission(request, ['userRead', 'userModerate', 'roleManage'])
  const uid = cleanString(request.data?.uid || '', 180)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')
  const [inputs, canonical] = await Promise.all([
    loadAccountPermissionInputs(uid),
    loadCanonicalRoleState(uid)
  ])
  return {
    ok: true,
    uid,
    defaults: DEFAULT_PERMISSIONS,
    explicit: permissionDocSummary(inputs.explicit || {}),
    effective: resolveAccountPermissions(inputs),
    accountRoles: canonical.roles,
    profileBadges: canonical.badges,
    roleDefinitions: canonical.roleDefinitions,
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

  const [beforeInputs, beforeCanonical] = await Promise.all([
    loadAccountPermissionInputs(uid),
    loadCanonicalRoleState(uid)
  ])
  const beforeExplicit = permissionDocSummary(beforeInputs.explicit || {})
  const permissions = cleanBoolMap(request.data?.permissions || {})
  const badges = cleanBoolMap(request.data?.badges || {}, PUBLIC_BADGE_KEYS)
  const restrictions = cleanBoolMap(request.data?.restrictions || {}, RESTRICTION_KEYS)
  const accountRoles = validateAssignments(request.data?.accountRoles || [], beforeCanonical.roleDefinitions, 'backendAssignable')
  const profileBadges = validateAssignments(request.data?.profileBadges || [], beforeCanonical.roleDefinitions, 'badgeAssignable')
  const assignmentChanges = assignmentAuditSummary(beforeCanonical.roles, accountRoles, beforeCanonical.badges, profileBadges)
  const ref = db().collection('users').doc(uid).collection('permissions').doc('current')
  const userRef = db().collection('users').doc(uid)
  const profileRef = db().collection('profiles').doc(uid)
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

  // One atomic commit: permissions + backend roles + visual badges cannot partially diverge.
  const batch = db().batch()
  batch.set(ref, payload, { merge: true })
  batch.set(userRef, { roles: accountRoles, updatedAt: now }, { merge: true })
  batch.set(profileRef, { badges: profileBadges, updatedAt: now }, { merge: true })
  await batch.commit()

  // Keep the general permission audit for one complete account-change record.
  await writeAdminAuditLog({
    actorUid: claims.uid,
    actorEmail: claims.email,
    actorRole: claims.adminRole,
    action: 'account_permissions_updated',
    targetType: 'user',
    targetId: uid,
    targetPath: `users/${uid}/permissions/current`,
    reason,
    before: { ...beforeExplicit, accountRoles: beforeCanonical.roles, profileBadges: beforeCanonical.badges },
    after: {
      ...permissionDocSummary(payload),
      accountRoles,
      profileBadges,
      assignmentChanges
    }
  })

  // Dedicated assignment audit records make role/badge changes queryable without
  // conflating backend authority with public identity.
  if (assignmentChanges.rolesChanged) {
    await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: 'account_roles_updated',
      targetType: 'user',
      targetId: uid,
      targetPath: `users/${uid}`,
      reason,
      before: { roles: beforeCanonical.roles },
      after: { roles: accountRoles, diff: assignmentChanges.roles }
    })
  }
  if (assignmentChanges.badgesChanged) {
    await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: 'profile_badges_updated',
      targetType: 'profile',
      targetId: uid,
      targetPath: `profiles/${uid}`,
      reason,
      before: { badges: beforeCanonical.badges },
      after: { badges: profileBadges, diff: assignmentChanges.badges }
    })
  }

  const [afterInputs, afterCanonical] = await Promise.all([
    loadAccountPermissionInputs(uid),
    loadCanonicalRoleState(uid)
  ])
  if (!sameRoleArray(afterCanonical.roles, accountRoles) || !sameRoleArray(afterCanonical.badges, profileBadges)) {
    console.error('[admin] canonical role/badge verification mismatch', {
      uid,
      expectedRoles: accountRoles,
      actualRoles: afterCanonical.roles,
      expectedBadges: profileBadges,
      actualBadges: afterCanonical.badges
    })
    throw new HttpsError('internal', 'Role/badge data was written but post-save verification did not match. Refresh before making another change.')
  }

  return {
    ok: true,
    uid,
    explicit: permissionDocSummary(afterInputs.explicit || {}),
    effective: resolveAccountPermissions(afterInputs),
    accountRoles: afterCanonical.roles,
    profileBadges: afterCanonical.badges,
    roleDefinitions: afterCanonical.roleDefinitions,
    assignmentChanges,
    path: afterInputs.path
  }
})

module.exports = {
  getAdminAccountPermissions,
  updateAdminAccountPermissions
}
