const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { COMMUNITY_CATEGORIES, POSTING_MODES, cleanSlug, communityIdForSlug, seedOfficialCommunities } = require('./communityShared')

function db() {
  return admin.firestore()
}

function requireAuth(request) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function canCreateCommunity(request = {}) {
  const token = request.auth?.token || {}
  return Boolean(
    token.admin === true
    || token.role === 'beta'
    || token.role === 'verified'
    || token.role === 'pro'
    || token.verified === true
    || token.beta === true
    || token.pro === true
  )
}

const createCommunity = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  if (!canCreateCommunity(request)) {
    throw new HttpsError('permission-denied', 'Community creation is limited during the first launch.')
  }

  const name = cleanString(request.data?.name || '', 80)
  const slug = cleanSlug(request.data?.slug || name)
  const description = cleanString(request.data?.description || '', 500)
  const category = cleanString(request.data?.category || 'Creator Help', 80)
  const postingMode = cleanString(request.data?.postingMode || 'open', 40)

  if (!name) throw new HttpsError('invalid-argument', 'Community name is required.')
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpsError('invalid-argument', 'Use a lowercase slug with letters, numbers, and hyphens.')
  }
  if (!description) throw new HttpsError('invalid-argument', 'Community description is required.')
  if (!COMMUNITY_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', 'Choose a valid community category.')
  if (!POSTING_MODES.has(postingMode)) throw new HttpsError('invalid-argument', 'Choose a valid posting mode.')

  await seedOfficialCommunities()

  const communityId = communityIdForSlug(slug)
  const communityRef = db().collection('communities').doc(communityId)
  const existing = await communityRef.get()
  if (existing.exists) throw new HttpsError('already-exists', 'That community slug is already taken.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    communityId,
    slug,
    name,
    description,
    category,
    iconURL: '',
    bannerURL: '',
    createdBy: uid,
    ownerUid: uid,
    moderatorIds: [uid],
    memberCount: 0,
    focusCount: 0,
    postCount: 0,
    visibility: 'public',
    postingMode,
    status: 'active',
    official: false,
    createdAt: now,
    updatedAt: now
  }

  await communityRef.set(payload)
  return { ok: true, communityId, slug, community: { ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
})

module.exports = {
  createCommunity
}
