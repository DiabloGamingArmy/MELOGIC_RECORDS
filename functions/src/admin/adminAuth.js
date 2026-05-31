const { HttpsError } = require('firebase-functions/v2/https')

const ADMIN_CLAIM_KEYS = [
  'admin',
  'adminRole',
  'productReview',
  'listingEdit',
  'userRead',
  'userModerate',
  'orderSupport',
  'roleManage',
  'auditRead'
]

const PERMISSION_KEYS = ADMIN_CLAIM_KEYS.filter((key) => key !== 'admin' && key !== 'adminRole')

const ROLE_ALIASES = new Map([
  ['owner', 'owner'],
  ['admin', 'admin'],
  ['administrator', 'admin'],
  ['marketplacereviewer', 'marketplaceReviewer'],
  ['marketplace_reviewer', 'marketplaceReviewer'],
  ['marketplace-reviewer', 'marketplaceReviewer'],
  ['reviewer', 'marketplaceReviewer'],
  ['listingeditor', 'listingEditor'],
  ['listing_editor', 'listingEditor'],
  ['listing-editor', 'listingEditor'],
  ['support', 'support'],
  ['auditor', 'auditor'],
  ['remove', 'remove'],
  ['none', 'remove']
])

const ROLE_PERMISSIONS = {
  owner: {
    productReview: true,
    listingEdit: true,
    userRead: true,
    userModerate: true,
    orderSupport: true,
    roleManage: true,
    auditRead: true
  },
  admin: {
    productReview: true,
    listingEdit: true,
    userRead: true,
    userModerate: true,
    orderSupport: true,
    roleManage: false,
    auditRead: true
  },
  marketplaceReviewer: {
    productReview: true,
    listingEdit: false,
    userRead: false,
    userModerate: false,
    orderSupport: false,
    roleManage: false,
    auditRead: false
  },
  listingEditor: {
    productReview: false,
    listingEdit: true,
    userRead: false,
    userModerate: false,
    orderSupport: false,
    roleManage: false,
    auditRead: false
  },
  support: {
    productReview: false,
    listingEdit: false,
    userRead: true,
    userModerate: false,
    orderSupport: true,
    roleManage: false,
    auditRead: false
  },
  auditor: {
    productReview: false,
    listingEdit: false,
    userRead: false,
    userModerate: false,
    orderSupport: false,
    roleManage: false,
    auditRead: true
  }
}

const ROLE_RANKS = {
  owner: 100,
  admin: 80,
  marketplaceReviewer: 50,
  listingEditor: 45,
  support: 40,
  auditor: 20,
  remove: 0,
  '': 0
}

function cleanString(value = '', max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function normalizeRole(value = '') {
  const raw = cleanString(value, 80)
  const key = raw.replace(/[\s_:-]+/g, '').toLowerCase()
  return ROLE_ALIASES.get(key) || ROLE_ALIASES.get(raw) || ''
}

function rolePermissions(role = '') {
  return { ...(ROLE_PERMISSIONS[normalizeRole(role)] || {}) }
}

function roleRank(role = '') {
  return ROLE_RANKS[normalizeRole(role)] || 0
}

function buildAdminClaims(role = '') {
  const normalizedRole = normalizeRole(role)
  if (!normalizedRole || normalizedRole === 'remove') {
    throw new HttpsError('invalid-argument', 'A valid admin role is required.')
  }
  const permissions = rolePermissions(normalizedRole)
  const claims = {
    admin: true,
    adminRole: normalizedRole
  }
  PERMISSION_KEYS.forEach((key) => {
    claims[key] = permissions[key] === true
  })
  return claims
}

function stripAdminClaims(existingClaims = {}) {
  const next = { ...(existingClaims || {}) }
  ADMIN_CLAIM_KEYS.forEach((key) => {
    delete next[key]
  })
  return next
}

function pickAdminClaims(claims = {}) {
  return ADMIN_CLAIM_KEYS.reduce((picked, key) => {
    if (Object.prototype.hasOwnProperty.call(claims, key)) picked[key] = claims[key]
    return picked
  }, {})
}

function mergeAdminClaims(existingClaims = {}, role = '', active = true) {
  const normalizedRole = normalizeRole(role)
  const stripped = stripAdminClaims(existingClaims)
  if (!active || normalizedRole === 'remove') return stripped
  return {
    ...stripped,
    ...buildAdminClaims(normalizedRole)
  }
}

function getAuthFromRequest(request = {}) {
  return request.auth || request.context?.auth || null
}

function permissionIsAllowed(claims = {}, permission = '') {
  const key = cleanString(permission, 80)
  if (!PERMISSION_KEYS.includes(key)) return false
  if (key === 'roleManage') return claims.roleManage === true
  return claims[key] === true
}

function getRequesterClaims(request = {}) {
  const auth = getAuthFromRequest(request)
  const uid = cleanString(auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const token = auth?.token || {}
  const role = normalizeRole(token.adminRole || '')
  const permissions = rolePermissions(role)
  const claims = {
    uid,
    email: cleanString(token.email || '', 320),
    admin: token.admin === true,
    adminRole: role
  }
  PERMISSION_KEYS.forEach((key) => {
    claims[key] = token[key] === true || permissions[key] === true
  })
  return claims
}

function assertAdmin(request = {}) {
  const claims = getRequesterClaims(request)
  if (claims.admin === true) return claims
  throw new HttpsError('permission-denied', 'Admin access is required.')
}

function assertPermission(request = {}, permission = '') {
  const claims = assertAdmin(request)
  if (permissionIsAllowed(claims, permission)) return claims
  throw new HttpsError('permission-denied', 'This admin permission is required.')
}

function assertAnyPermission(request = {}, permissions = []) {
  const claims = assertAdmin(request)
  const allowed = Array.isArray(permissions) && permissions.length
    ? permissions.some((permission) => permissionIsAllowed(claims, permission))
    : true
  if (allowed) return claims
  throw new HttpsError('permission-denied', 'One of these admin permissions is required.')
}

function canManageRoles(claims = {}) {
  return permissionIsAllowed(claims, 'roleManage')
}

function canReviewProducts(claims = {}) {
  return permissionIsAllowed(claims, 'productReview')
}

function canEditListings(claims = {}) {
  return permissionIsAllowed(claims, 'listingEdit')
}

function canReadUsers(claims = {}) {
  return permissionIsAllowed(claims, 'userRead')
}

function canModerateUsers(claims = {}) {
  return permissionIsAllowed(claims, 'userModerate')
}

module.exports = {
  ADMIN_CLAIM_KEYS,
  PERMISSION_KEYS,
  ROLE_PERMISSIONS,
  ROLE_RANKS,
  assertAdmin,
  assertAnyPermission,
  assertPermission,
  buildAdminClaims,
  canEditListings,
  canManageRoles,
  canModerateUsers,
  canReadUsers,
  canReviewProducts,
  cleanString,
  getRequesterClaims,
  mergeAdminClaims,
  normalizeRole,
  pickAdminClaims,
  roleRank,
  rolePermissions,
  stripAdminClaims
}
