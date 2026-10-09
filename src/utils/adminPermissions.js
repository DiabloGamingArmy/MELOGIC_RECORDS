import registry from '../../functions/src/admin/adminPermissions.json' with { type: 'json' }
// Firebase Auth custom claims supply authority. roleDefinitions/users.roles are
// account identities/badges, not the admin permission registry.
export function hasAdminPermission(claims = {}, permission = 'admin') {
  if (claims.admin !== true) return false
  if (permission === 'admin') return true
  if (!registry.permissions.includes(permission)) return false
  const raw = String(claims.adminRole || '').trim()
  const role = registry.aliases[raw.replace(/[\s_:-]+/g, '').toLowerCase()] || registry.aliases[raw] || ''
  const allowed = registry.roles[role] || []
  return claims[permission] === true || allowed === '*' || allowed.includes(permission)
}
const descriptions = {
  licensesManage: 'manage licenses and product access',
  settingsManage: 'manage settings', roleManage: 'manage administrative roles',
  userRead: 'view users', userModerate: 'moderate users',
  productReview: 'review products', listingEdit: 'edit product listings',
  orderSupport: 'manage order support', auditRead: 'view audit logs',
  emailSend: 'send administrative email', admin: 'access this administration page'
}
export function permissionDeniedMarkup(permission) {
  const description = descriptions[permission] || 'access this administration page'
  return `<div class="admin-empty-state" role="alert"><strong>Permission required</strong><p>You do not have permission to ${description}.</p></div>`
}
