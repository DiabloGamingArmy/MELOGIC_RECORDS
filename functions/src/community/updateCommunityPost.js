const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')

function db() {
  return admin.firestore()
}

function requireAuth(request) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function cleanPostId(value = '') {
  const postId = cleanString(value, 180)
  if (!postId || postId.includes('/')) throw new HttpsError('invalid-argument', 'A valid post id is required.')
  return postId
}

function cleanTag(value = '') {
  return cleanString(value, 40)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function normalizeTags(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\s]+/)
  return Array.from(new Set(raw.map(cleanTag).filter(Boolean))).slice(0, 5)
}

function tokenizeForSearch(...values) {
  const tokens = new Set()
  values.forEach((value) => {
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9@\s_-]+/g, ' ')
      .split(/[\s,_-]+/)
      .map((part) => part.replace(/^@+/, '').trim())
      .filter((part) => part.length >= 2)
      .slice(0, 30)
      .forEach((part) => tokens.add(part.slice(0, 40)))
  })
  return Array.from(tokens).slice(0, 50)
}

const updateCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const postId = cleanPostId(request.data?.postId || '')
  const title = cleanString(request.data?.title || '', 120)
  const body = cleanString(request.data?.body || '', 4000)
  const tags = normalizeTags(request.data?.tags || [])
  const requestedVisibility = cleanString(request.data?.visibility || '', 24)
  const postRef = db().collection('communityPosts').doc(postId)
  const postSnap = await postRef.get()
  if (!postSnap.exists) throw new HttpsError('not-found', 'Community post not found.')

  const post = postSnap.data() || {}
  if (post.authorUid !== uid) throw new HttpsError('permission-denied', 'You can only edit your own posts.')
  if (post.status !== 'published') throw new HttpsError('failed-precondition', 'Only published posts can be edited right now.')
  if (post.visibility !== 'public') throw new HttpsError('failed-precondition', 'This post visibility cannot be edited right now.')

  const attachments = Array.isArray(post.attachments) ? post.attachments : []
  if (!title && !body && !attachments.length) {
    throw new HttpsError('invalid-argument', 'Add text, a title, or keep an attachment before saving.')
  }

  const visibility = requestedVisibility === 'public' || !requestedVisibility ? 'public' : post.visibility
  const tagKeys = tags
  const searchKeywords = tokenizeForSearch(
    title,
    body,
    tags.join(' '),
    post.communityName,
    post.communitySlug,
    post.authorDisplayName,
    post.authorUsername,
    post.intent,
    post.intentData?.category,
    post.intentData?.roleNeeded,
    ...attachments.map((attachment) => attachment?.snapshot?.title || '')
  )
  const now = admin.firestore.FieldValue.serverTimestamp()
  const update = {
    title,
    titleLower: title.toLowerCase(),
    body,
    tags,
    tagKeys,
    searchKeywords,
    visibility,
    edited: true,
    editedAt: now,
    updatedAt: now
  }

  await postRef.set(update, { merge: true })
  return {
    ok: true,
    postId,
    post: {
      ...update,
      postId,
      edited: true,
      editedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }
})

module.exports = {
  updateCommunityPost
}
