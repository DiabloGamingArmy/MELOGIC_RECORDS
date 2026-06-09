const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString, requireAdminActionSecurity } = require('../admin/adminAuth')
const { COMMUNITY_CATEGORIES, POSTING_MODES, cleanSlug, communityIdForSlug } = require('./communityShared')

function db() {
  return admin.firestore()
}

function requireAuth(request) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function cleanStringArray(value = [], maxItems = 20, maxLength = 220) {
  const rows = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n/)
  return rows
    .map((item) => cleanString(item || '', maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

function cleanStatus(value = '') {
  const status = cleanString(value || 'active', 40)
  return ['active', 'hidden', 'archived', 'deleted'].includes(status) ? status : 'active'
}

function cleanVisibility(value = '') {
  return cleanString(value || 'public', 40) === 'private' ? 'private' : 'public'
}

function cleanAssetPath(value = '', slug = '') {
  const path = cleanString(value || '', 500)
  if (!path) return ''
  const prefix = `assets/site/community/communities/${slug}/`
  return path.startsWith(prefix) && !path.includes('..') ? path : ''
}

const createCommunity = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  await requireAdminActionSecurity(request, ['userModerate'])

  const name = cleanString(request.data?.name || request.data?.title || '', 80)
  const slug = cleanSlug(request.data?.slug || name)
  const description = cleanString(request.data?.description || '', 500)
  const category = cleanString(request.data?.category || 'Creator Help', 80)
  const postingMode = cleanString(request.data?.postingMode || 'open', 40)
  const status = cleanStatus(request.data?.status || 'active')
  const visibility = cleanVisibility(request.data?.visibility || 'public')
  const rules = cleanStringArray(request.data?.rules || [], 20, 240)
  const moderatorIds = cleanStringArray(request.data?.moderatorUids || request.data?.moderatorIds || [], 50, 180)
    .filter((id) => !id.includes('/'))
  const uniqueModerators = [...new Set([uid, ...moderatorIds])]
  const imagePath = cleanAssetPath(request.data?.imagePath || request.data?.iconPath || '', slug)
  const bannerImagePath = cleanAssetPath(request.data?.bannerImagePath || request.data?.bannerPath || '', slug)
  const imageUrl = imagePath ? cleanString(request.data?.imageUrl || request.data?.iconURL || '', 1200) : ''
  const bannerImageUrl = bannerImagePath ? cleanString(request.data?.bannerImageUrl || request.data?.bannerURL || '', 1200) : ''

  if (!name) throw new HttpsError('invalid-argument', 'Community name is required.')
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpsError('invalid-argument', 'Use a lowercase slug with letters, numbers, and hyphens.')
  }
  if (!description) throw new HttpsError('invalid-argument', 'Community description is required.')
  if (!COMMUNITY_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', 'Choose a valid community category.')
  if (!POSTING_MODES.has(postingMode)) throw new HttpsError('invalid-argument', 'Choose a valid posting mode.')

  const communityId = communityIdForSlug(slug)
  const communityRef = db().collection('communities').doc(communityId)
  const existing = await communityRef.get()
  if (existing.exists) throw new HttpsError('already-exists', 'That community slug is already taken.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    communityId,
    slug,
    title: name,
    name,
    description,
    rules,
    category,
    imagePath,
    imageUrl,
    imageURL: imageUrl,
    iconPath: imagePath,
    iconURL: imageUrl,
    bannerImagePath,
    bannerImageUrl,
    bannerURL: bannerImageUrl,
    createdBy: uid,
    updatedBy: uid,
    ownerUid: uid,
    moderatorIds: uniqueModerators,
    moderatorUids: uniqueModerators,
    memberCount: 0,
    followerCount: 0,
    focusCount: 0,
    postCount: 0,
    lastPostAt: null,
    visibility,
    postingMode,
    status,
    hidden: status === 'hidden',
    deletedAt: status === 'deleted' ? now : null,
    official: true,
    createdAt: now,
    updatedAt: now
  }

  await communityRef.set(payload)
  return { ok: true, communityId, slug, community: { ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
})

module.exports = {
  createCommunity
}
