const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')

const LOW_COST_DEFAULTS = {
  viewPublicContent: true,
  communityPost: true,
  communityReact: true,
  communityMessage: true,
  musicLiveChat: true,
  productInteract: true,
  productPurchase: true,
  productDownload: true,
  productCreate: true,
  studioBasic: true,
  souraBasic: true,
  musicDiscover: true,
  musicListen: true
}

const RISKY_DEFAULTS = {
  musicLive: false,
  musicPost: false,
  musicSubmit: false,
  musicVideoPost: false,
  highQuotaStudio: false,
  distributionSubmit: false,
  adminTools: false,
  staffTools: false
}

const DEFAULT_PERMISSIONS = {
  ...LOW_COST_DEFAULTS,
  ...RISKY_DEFAULTS
}

const PUBLIC_BADGE_KEYS = ['verified', 'creator', 'artist', 'founder', 'staff']
const ELIGIBLE_ROLES = new Set(['creator', 'artist', 'founder', 'staff', 'admin', 'owner'])

function db() {
  return admin.firestore()
}

function cleanBoolMap(value = {}, allowedKeys = null) {
  const input = value && typeof value === 'object' ? value : {}
  return Object.keys(input).reduce((result, key) => {
    const cleanKey = cleanString(key, 80)
    if (!cleanKey || (allowedKeys && !allowedKeys.includes(cleanKey))) return result
    result[cleanKey] = input[key] === true
    return result
  }, {})
}

function serializeDate(value) {
  if (!value) return ''
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return cleanString(value, 80)
}

function hasRoleFallback(user = {}, profile = {}) {
  const roleValues = [
    user.role,
    user.accountType,
    user.roleLabel,
    profile.role,
    profile.roleLabel,
    profile.accountType
  ].map((value) => cleanString(value, 40).toLowerCase())
  return roleValues.some((value) => ELIGIBLE_ROLES.has(value))
}

function isSuspended(user = {}, profile = {}, explicit = {}) {
  const restrictions = explicit.restrictions || {}
  return user?.suspended === true
    || profile?.suspended === true
    || user?.accountStatus === 'suspended'
    || profile?.accountStatus === 'suspended'
    || restrictions.suspended === true
}

function resolveAccountPermissions({ user = {}, profile = {}, explicit = {}, auth = null } = {}) {
  const permissions = {
    ...DEFAULT_PERMISSIONS,
    ...(explicit.permissions || {})
  }
  const restrictions = cleanBoolMap(explicit.restrictions || {})
  const badges = cleanBoolMap(explicit.badges || {}, PUBLIC_BADGE_KEYS)
  const suspended = isSuspended(user, profile, { restrictions })
  const emailVerified = auth?.token?.email_verified === true || user.emailVerified === true || profile.emailVerified === true

  if (user.musicLiveEnabled === true || profile.musicLiveEnabled === true || hasRoleFallback(user, profile)) {
    permissions.musicLive = true
  }

  if (!emailVerified) {
    permissions.communityPost = false
    permissions.communityReact = false
    permissions.communityMessage = false
  }

  if (restrictions.liveSuspended === true || restrictions.musicRestricted === true) {
    permissions.musicLive = false
  }
  if (restrictions.musicRestricted === true) {
    permissions.musicPost = false
    permissions.musicSubmit = false
    permissions.musicVideoPost = false
  }
  if (restrictions.marketplaceRestricted === true) {
    permissions.productInteract = false
    permissions.productPurchase = false
    permissions.productCreate = false
  }
  if (restrictions.communityRestricted === true) {
    permissions.communityPost = false
    permissions.communityReact = false
    permissions.communityMessage = false
  }
  if (restrictions.studioRestricted === true) {
    permissions.studioBasic = false
    permissions.souraBasic = false
    permissions.highQuotaStudio = false
  }

  if (suspended) {
    Object.keys(permissions).forEach((key) => {
      if (key !== 'viewPublicContent' && key !== 'musicDiscover' && key !== 'musicListen') permissions[key] = false
    })
  }

  return {
    permissions,
    restrictions,
    badges,
    emailVerified,
    suspended,
    source: explicit.exists ? 'explicit' : 'defaults',
    updatedAt: serializeDate(explicit.updatedAt),
    updatedByUid: cleanString(explicit.updatedByUid || '', 180),
    updatedByEmail: cleanString(explicit.updatedByEmail || '', 320),
    updatedByDisplayName: cleanString(explicit.updatedByDisplayName || '', 160),
    changeReason: cleanString(explicit.changeReason || '', 1200),
    expiresAt: serializeDate(explicit.expiresAt)
  }
}

async function loadAccountPermissionInputs(uid = '') {
  const [userSnap, profileSnap, permissionSnap] = await Promise.all([
    db().collection('users').doc(uid).get(),
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).collection('permissions').doc('current').get()
  ])
  const explicit = permissionSnap.exists ? permissionSnap.data() || {} : {}
  return {
    user: userSnap.exists ? userSnap.data() || {} : {},
    profile: profileSnap.exists ? profileSnap.data() || {} : {},
    explicit: {
      ...explicit,
      exists: permissionSnap.exists
    },
    path: `users/${uid}/permissions/current`
  }
}

async function resolvePermissionsForUid(uid = '', auth = null) {
  const inputs = await loadAccountPermissionInputs(uid)
  return {
    ...resolveAccountPermissions({ ...inputs, auth }),
    explicit: inputs.explicit,
    path: inputs.path
  }
}

module.exports = {
  DEFAULT_PERMISSIONS,
  PUBLIC_BADGE_KEYS,
  cleanBoolMap,
  loadAccountPermissionInputs,
  resolveAccountPermissions,
  resolvePermissionsForUid
}
