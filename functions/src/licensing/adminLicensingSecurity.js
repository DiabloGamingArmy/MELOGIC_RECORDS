const { requireAdminActionSecurity, assertPermission, getRequesterClaims } = require('../admin/adminAuth')
const { fail } = require('./entitlements')
// Use the established permission and MFA model, plus current Auth claims and
// role metadata so a cached browser token cannot retain removed privileges.
async function verifyLicensingAdmin(request, mutation, { auth, db, requireStepUp = requireAdminActionSecurity }) {
  const actor = mutation ? await requireStepUp(request, 'settingsManage') : assertPermission(request, 'settingsManage')
  const [user, role] = await Promise.all([auth.getUser(actor.uid), db.doc(`adminUsers/${actor.uid}`).get()])
  const current = getRequesterClaims({ auth: { uid: actor.uid, token: user.customClaims || {} } })
  if (user.disabled || current.admin !== true || !current.settingsManage || (role.exists && role.data().active !== true)) fail('permission-denied', 'Current admin authority is required.')
  if (Number(request.auth.token.auth_time || 0) * 1000 < Date.parse(user.tokensValidAfterTime || '1970-01-01')) fail('unauthenticated', 'Sign in again.')
  return current
}
module.exports = { verifyLicensingAdmin }
