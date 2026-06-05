const { HttpsError } = require('firebase-functions/v2/https')
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

function postRefFor(postId = '') {
  const id = cleanString(postId, 180)
  if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'A valid post id is required.')
  return db().collection('communityPosts').doc(id)
}

function commentRefFor(postId = '', commentId = '') {
  const id = cleanString(commentId, 180)
  if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'A valid comment id is required.')
  return postRefFor(postId).collection('comments').doc(id)
}

async function assertPublicPost(tx, postRef) {
  const postSnap = await tx.get(postRef)
  if (!postSnap.exists) throw new HttpsError('not-found', 'Community post not found.')
  const post = postSnap.data() || {}
  if (post.status !== 'published' || post.visibility !== 'public') {
    throw new HttpsError('permission-denied', 'This community post is not available.')
  }
  return { post, postSnap }
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

function nextCount(current = 0, delta = 0) {
  return Math.max(0, Math.round(Number(current || 0)) + delta)
}

function serializeDate(value) {
  if (!value) return ''
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value || '')
}

function serializeComment(comment = {}, id = '') {
  return {
    commentId: id || comment.commentId || '',
    postId: comment.postId || '',
    authorUid: comment.authorUid || '',
    authorDisplayName: comment.authorDisplayName || 'Melogic Creator',
    authorUsername: comment.authorUsername || '',
    authorAvatarURL: comment.authorAvatarURL || '',
    body: comment.body || '',
    parentCommentId: comment.parentCommentId || '',
    replyCount: Math.max(0, Number(comment.replyCount || 0)),
    likeCount: Math.max(0, Number(comment.likeCount || 0)),
    dislikeCount: Math.max(0, Number(comment.dislikeCount || 0)),
    status: comment.status || 'visible',
    createdAt: serializeDate(comment.createdAt),
    updatedAt: serializeDate(comment.updatedAt)
  }
}

module.exports = {
  assertPublicPost,
  commentRefFor,
  db,
  loadAuthorSnapshot,
  nextCount,
  postRefFor,
  requireAuth,
  serializeComment
}
