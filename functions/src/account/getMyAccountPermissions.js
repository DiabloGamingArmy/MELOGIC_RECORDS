const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { resolvePermissionsForUid } = require('./accountPermissions')

const getMyAccountPermissions = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = request.auth?.uid || ''
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const effective = await resolvePermissionsForUid(uid, request.auth)
  return {
    ok: true,
    effective: {
      permissions: effective.permissions,
      restrictions: effective.restrictions,
      badges: effective.badges,
      emailVerified: effective.emailVerified,
      suspended: effective.suspended,
      source: effective.source,
      updatedAt: effective.updatedAt
    }
  }
})

module.exports = {
  getMyAccountPermissions
}
