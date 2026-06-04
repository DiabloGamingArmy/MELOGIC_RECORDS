const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { cleanSlug, seedOfficialCommunities } = require('./communityShared')

const POST_TYPES = new Set(['post', 'text', 'product_share'])

function db() {
  return admin.firestore()
}

function cleanTag(value = '') {
  return cleanString(value, 40).toLowerCase().replace(/[^a-z0-9_-]+/g, '').slice(0, 32)
}

function normalizeTags(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\s]+/)
  return Array.from(new Set(raw.map(cleanTag).filter(Boolean))).slice(0, 5)
}

async function loadAuthorSnapshot(uid = '') {
  const [profileSnap, userSnap] = await Promise.all([
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).get()
  ])
  const profile = profileSnap.exists ? profileSnap.data() || {} : {}
  const user = userSnap.exists ? userSnap.data() || {} : {}
  return {
    authorDisplayName: cleanString(profile.displayName || user.displayName || user.name || 'Melogic Creator', 120),
    authorUsername: cleanString(profile.username || user.username || '', 60),
    authorAvatarURL: cleanString(profile.avatarURL || profile.photoURL || user.avatarURL || user.photoURL || '', 900)
  }
}

async function buildProductSnapshot(productId = '') {
  const id = cleanString(productId, 180)
  if (!id) return { linkedProductId: '', linkedProductSnapshot: {} }
  if (id.includes('/')) throw new HttpsError('invalid-argument', 'A valid product id is required.')

  const snap = await db().collection('products').doc(id).get()
  if (!snap.exists) throw new HttpsError('not-found', 'The shared product could not be found.')
  const product = snap.data() || {}
  if (product.status !== 'published' || product.visibility !== 'public') {
    throw new HttpsError('failed-precondition', 'Only public published products can be shared.')
  }

  return {
    linkedProductId: id,
    linkedProductSnapshot: {
      productId: id,
      title: cleanString(product.title || 'Untitled product', 180),
      slug: cleanString(product.slug || '', 180),
      artistId: cleanString(product.artistId || '', 180),
      artistName: cleanString(product.artistDisplayName || product.artistName || '', 120),
      thumbnailURL: cleanString(product.thumbnailURL || product.coverURL || '', 900),
      priceCents: Math.max(0, Math.round(Number(product.priceCents || 0))),
      isFree: Boolean(product.isFree) || Number(product.priceCents || 0) <= 0,
      currency: cleanString(product.currency || 'USD', 12)
    }
  }
}

async function buildProductAttachment(productId = '') {
  const productLink = await buildProductSnapshot(productId)
  if (!productLink.linkedProductId) return null
  return {
    type: 'product',
    productId: productLink.linkedProductId,
    snapshot: {
      title: productLink.linkedProductSnapshot.title || 'Untitled product',
      slug: productLink.linkedProductSnapshot.slug || '',
      thumbnailURL: productLink.linkedProductSnapshot.thumbnailURL || '',
      creatorName: productLink.linkedProductSnapshot.artistName || '',
      priceCents: productLink.linkedProductSnapshot.priceCents || 0,
      isFree: productLink.linkedProductSnapshot.isFree === true,
      currency: productLink.linkedProductSnapshot.currency || 'USD'
    }
  }
}

async function normalizeAttachments(value = []) {
  const raw = Array.isArray(value) ? value : []
  const productIds = Array.from(new Set(raw
    .filter((attachment) => attachment && typeof attachment === 'object' && attachment.type === 'product')
    .map((attachment) => cleanString(attachment.productId || '', 180))
    .filter((id) => id && !id.includes('/')))).slice(0, 1)

  const productAttachments = await Promise.all(productIds.map((id) => buildProductAttachment(id)))
  return productAttachments.filter(Boolean)
}

function normalizeMentions(ids = [], usernames = [], uid = '') {
  const mentionedUserIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((id) => cleanString(id, 180))
    .filter((id) => id && id !== uid && !id.includes('/')))).slice(0, 10)
  const mentionedUsernames = Array.from(new Set((Array.isArray(usernames) ? usernames : [])
    .map((username) => cleanString(username, 60).replace(/^@/, '').toLowerCase())
    .filter(Boolean))).slice(0, 10)
  return { mentionedUserIds, mentionedUsernames }
}

async function resolveCommunityForPost({ communityId = '', communitySlug = '', uid = '' } = {}) {
  const id = cleanString(communityId || cleanSlug(communitySlug), 180)
  if (!id) return { communityId: '', communitySlug: '' }
  if (id.includes('/')) throw new HttpsError('invalid-argument', 'A valid community id is required.')

  await seedOfficialCommunities()

  const communityRef = db().collection('communities').doc(id)
  const communitySnap = await communityRef.get()
  if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
  const community = communitySnap.data() || {}
  if (community.status !== 'active' || community.visibility !== 'public') {
    throw new HttpsError('failed-precondition', 'This community is not available for posting.')
  }

  const postingMode = cleanString(community.postingMode || 'open', 40)
  const isModerator = community.ownerUid === uid || (Array.isArray(community.moderatorIds) && community.moderatorIds.includes(uid))
  if (postingMode === 'moderators_only' && !isModerator) {
    throw new HttpsError('permission-denied', 'Only moderators can post in this community.')
  }
  if (postingMode === 'focused_only' || postingMode === 'members_only') {
    const focusSnap = await db().collection('users').doc(uid).collection('focusedCommunities').doc(communitySnap.id).get()
    if (!focusSnap.exists && !isModerator) {
      throw new HttpsError('permission-denied', 'Focus this community before posting.')
    }
  }

  return {
    communityId: communitySnap.id,
    communitySlug: cleanString(community.slug || communitySnap.id, 80),
    communityName: cleanString(community.name || community.slug || communitySnap.id, 120)
  }
}

const createCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

  const rawType = cleanString(request.data?.type || 'post', 40)
  const type = rawType === 'product_share' ? 'product_share' : rawType === 'text' ? 'text' : 'post'
  const title = cleanString(request.data?.title || '', 120)
  const body = cleanString(request.data?.body || '', 2000)
  const tags = normalizeTags(request.data?.tags || [])
  const mentions = normalizeMentions(request.data?.mentionedUserIds || [], request.data?.mentionedUsernames || [], uid)

  if (!POST_TYPES.has(type)) throw new HttpsError('invalid-argument', 'A valid post type is required.')
  if (type === 'product_share' && !cleanString(request.data?.linkedProductId || '', 180)) {
    throw new HttpsError('invalid-argument', 'Choose a product to share.')
  }

  const [author, productLink, attachments, community] = await Promise.all([
    loadAuthorSnapshot(uid),
    type === 'product_share'
      ? buildProductSnapshot(request.data?.linkedProductId || '')
      : Promise.resolve({ linkedProductId: '', linkedProductSnapshot: {} }),
    type === 'product_share'
      ? Promise.resolve([])
      : normalizeAttachments(request.data?.attachments || []),
    resolveCommunityForPost({
      communityId: request.data?.communityId || '',
      communitySlug: request.data?.communitySlug || '',
      uid
    })
  ])
  if (!body && !title && !attachments.length && type !== 'product_share') {
    throw new HttpsError('invalid-argument', 'Add text, a title, or an attachment before publishing.')
  }

  const postRef = db().collection('communityPosts').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    postId: postRef.id,
    authorUid: uid,
    ...author,
    type,
    title,
    body,
    communityId: community.communityId,
    communitySlug: community.communitySlug,
    communityName: community.communityName || '',
    ...productLink,
    attachments,
    mediaPaths: [],
    mentionedUserIds: mentions.mentionedUserIds,
    mentionedUsernames: mentions.mentionedUsernames,
    scheduledAt: null,
    publishStatus: 'published',
    tags,
    status: 'published',
    visibility: 'public',
    official: false,
    counts: {
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      reports: 0
    },
    score: 0,
    createdAt: now,
    updatedAt: now
  }

  const batch = db().batch()
  batch.set(postRef, payload)
  if (community.communityId) {
    batch.set(db().collection('communities').doc(community.communityId), {
      postCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now
    }, { merge: true })
  }
  await batch.commit()
  return { ok: true, postId: postRef.id, post: { ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
})

module.exports = {
  createCommunityPost
}
