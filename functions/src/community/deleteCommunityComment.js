const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const {
  assertPublicPost,
  commentRefFor,
  db,
  nextCount,
  postRefFor,
  requireAuth
} = require('./communityCommentShared')

function isAdmin(request = {}) {
  return request.auth?.token?.admin === true || request.auth?.token?.userModerate === true
}

const deleteCommunityComment = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const postId = cleanString(request.data?.postId || '', 180)
  const commentId = cleanString(request.data?.commentId || '', 180)
  if (!postId || postId.includes('/') || !commentId || commentId.includes('/')) {
    throw new HttpsError('invalid-argument', 'A valid post and comment id are required.')
  }

  const firestore = db()
  const postRef = postRefFor(postId)
  const commentRef = commentRefFor(postId, commentId)
  const now = admin.firestore.FieldValue.serverTimestamp()

  return firestore.runTransaction(async (tx) => {
    const { post } = await assertPublicPost(tx, postRef)
    const commentSnap = await tx.get(commentRef)
    if (!commentSnap.exists) throw new HttpsError('not-found', 'Comment not found.')
    const comment = commentSnap.data() || {}
    const currentCommentCount = Number(post.counts?.comments || 0)
    if (comment.status !== 'visible') return { ok: true, postId, commentId, deleted: true, commentCount: currentCommentCount }
    if (comment.authorUid !== uid && !isAdmin(request)) {
      throw new HttpsError('permission-denied', 'You can only delete your own comment.')
    }
    const parentRef = comment.parentCommentId ? commentRefFor(postId, comment.parentCommentId) : null
    const [parentSnap, visibleCommentsSnap] = await Promise.all([
      parentRef ? tx.get(parentRef) : Promise.resolve(null),
      tx.get(postRef.collection('comments').where('status', '==', 'visible'))
    ])
    const parent = parentSnap?.exists ? parentSnap.data() || {} : {}
    const nextCommentCount = nextCount(visibleCommentsSnap.size || currentCommentCount, -1)

    tx.set(commentRef, {
      status: comment.authorUid === uid ? 'deleted_by_author' : 'hidden_by_moderator',
      body: '',
      attachments: [],
      deletedAt: now,
      deletedBy: uid,
      updatedAt: now
    }, { merge: true })
    tx.set(postRef, {
      'counts.comments': nextCommentCount,
      commentCount: nextCommentCount,
      score: nextCount(post.score || 0, -1),
      updatedAt: now
    }, { merge: true })
    if (parentRef) {
      tx.set(parentRef, {
        replyCount: nextCount(parent.replyCount || 0, -1),
        updatedAt: now
      }, { merge: true })
    }

    return { ok: true, postId, commentId, deleted: true, commentCount: nextCommentCount }
  })
})

module.exports = {
  deleteCommunityComment
}
