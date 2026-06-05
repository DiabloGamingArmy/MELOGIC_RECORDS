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

async function toggleCommunityCommentReaction(request, reaction = 'like') {
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
  const dislikeRef = commentRef.collection('dislikes').doc(uid)
  const author = reaction === 'like' ? await loadAuthorSnapshot(uid) : null

  return firestore.runTransaction(async (tx) => {
    await assertPublicPost(tx, postRef)
    const [commentSnap, likeSnap, dislikeSnap] = await Promise.all([tx.get(commentRef), tx.get(likeRef), tx.get(dislikeRef)])
    if (!commentSnap.exists || commentSnap.data()?.status !== 'visible') {
      throw new HttpsError('not-found', 'Comment not found.')
    }
    const comment = commentSnap.data() || {}
    const currentReaction = likeSnap.exists ? 'like' : dislikeSnap.exists ? 'dislike' : ''
    const nextReaction = currentReaction === reaction ? '' : reaction
    const likeDelta = (nextReaction === 'like' ? 1 : 0) - (currentReaction === 'like' ? 1 : 0)
    const dislikeDelta = (nextReaction === 'dislike' ? 1 : 0) - (currentReaction === 'dislike' ? 1 : 0)
    const likeCount = nextCount(comment.likeCount, likeDelta)
    const dislikeCount = nextCount(comment.dislikeCount, dislikeDelta)
    const now = admin.firestore.FieldValue.serverTimestamp()

    if (nextReaction === 'like') {
      tx.set(likeRef, { uid, postId, commentId, reaction: 'like', createdAt: now, updatedAt: now }, { merge: true })
      tx.delete(dislikeRef)
    } else if (nextReaction === 'dislike') {
      tx.set(dislikeRef, { uid, postId, commentId, reaction: 'dislike', createdAt: now, updatedAt: now }, { merge: true })
      tx.delete(likeRef)
    } else {
      if (currentReaction === 'like') tx.delete(likeRef)
      if (currentReaction === 'dislike') tx.delete(dislikeRef)
    }
    tx.set(commentRef, { likeCount, dislikeCount, updatedAt: now }, { merge: true })

    if (nextReaction === 'like' && currentReaction !== 'like' && comment.authorUid && comment.authorUid !== uid) {
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

    return {
      ok: true,
      postId,
      commentId,
      reaction: nextReaction || null,
      active: nextReaction === reaction,
      liked: nextReaction === 'like',
      disliked: nextReaction === 'dislike',
      likeCount,
      dislikeCount
    }
  })
}

const toggleCommunityCommentLike = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => toggleCommunityCommentReaction(request, 'like'))
const toggleCommunityCommentDislike = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => toggleCommunityCommentReaction(request, 'dislike'))

module.exports = {
  toggleCommunityCommentLike,
  toggleCommunityCommentDislike
}
