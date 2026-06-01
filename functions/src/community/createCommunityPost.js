const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')

const POST_TYPES = new Set(['text', 'product_share'])

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

const createCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

  const type = cleanString(request.data?.type || 'text', 40)
  const title = cleanString(request.data?.title || '', 120)
  const body = cleanString(request.data?.body || '', 2000)
  const tags = normalizeTags(request.data?.tags || [])

  if (!POST_TYPES.has(type)) throw new HttpsError('invalid-argument', 'A valid post type is required.')
  if (!body) throw new HttpsError('invalid-argument', 'Post body is required.')
  if (type === 'product_share' && !cleanString(request.data?.linkedProductId || '', 180)) {
    throw new HttpsError('invalid-argument', 'Choose a product to share.')
  }

  const [author, productLink] = await Promise.all([
    loadAuthorSnapshot(uid),
    type === 'product_share'
      ? buildProductSnapshot(request.data?.linkedProductId || '')
      : Promise.resolve({ linkedProductId: '', linkedProductSnapshot: {} })
  ])

  const postRef = db().collection('communityPosts').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    postId: postRef.id,
    authorUid: uid,
    ...author,
    type,
    title,
    body,
    communityId: '',
    communitySlug: '',
    ...productLink,
    mediaPaths: [],
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

  await postRef.set(payload)
  return { ok: true, postId: postRef.id, post: { ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
})

module.exports = {
  createCommunityPost
}
