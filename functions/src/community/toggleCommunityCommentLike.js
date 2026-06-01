const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { writeAccountEventToBatch } = require('../account/accountEvents')
const {
  assertPublicPost,
  commentRefFor,
  db,
  loadAuthorSnapshot,
  nextCount,
  postRefFor,
  requireAuth
} = require('./communityCommentShared')

const toggleCommunityCommentLike = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const postId = cleanString(request.data?.postId || '', 180)
  const commentId = cleanString(request.data?.commentId || '', 180)
  if (!postId || postId.includes('/') || !commentId || commentId.includes('/')) {
    throw new HttpsError('invalid-argument', 'A valid post and comment id are required.')
  }

  const firestore = db()
  const postRef = postRefFor(postId)
  const commentRef = commentRefFor(postId, commentId)
  const likeRef = commentRef.collection('likes').doc(uid)
  const author = await loadAuthorSnapshot(uid)

  return firestore.runTransaction(async (tx) => {
    await assertPublicPost(tx, postRef)
    const [commentSnap, likeSnap] = await Promise.all([tx.get(commentRef), tx.get(likeRef)])
    if (!commentSnap.exists || commentSnap.data()?.status !== 'visible') {
      throw new HttpsError('not-found', 'Comment not found.')
    }
    const comment = commentSnap.data() || {}
    const active = !likeSnap.exists
    const likeCount = nextCount(comment.likeCount, active ? 1 : -1)
    const now = admin.firestore.FieldValue.serverTimestamp()

    if (active) tx.set(likeRef, { uid, postId, commentId, createdAt: now, updatedAt: now })
    else tx.delete(likeRef)
    tx.set(commentRef, { likeCount, updatedAt: now }, { merge: true })

    if (active && comment.authorUid && comment.authorUid !== uid) {
      writeAccountEventToBatch(firestore, tx, comment.authorUid, {
        type: 'community_comment_like',
        title: 'Your comment got a like',
        message: `${author.authorDisplayName || 'A creator'} liked your community comment.`,
        actorUid: uid,
        actorType: 'user',
        source: 'community',
        path: `/community/post/${postId}`,
        metadata: { postId, commentId }
      })
    }

    return { ok: true, postId, commentId, active, likeCount }
  })
})

module.exports = {
  toggleCommunityCommentLike
}
