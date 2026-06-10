const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { writeAccountEventToBatch } = require('../account/accountEvents')
const {
  assertPublicPost,
  commentRefFor,
  db,
  loadAuthorSnapshot,
  postRefFor,
  requireAuth,
  serializeComment
} = require('./communityCommentShared')

function normalizeAttachments(value = [], { uid = '', postId = '', commentId = '' } = {}) {
  const rows = Array.isArray(value) ? value : []
  if (rows.length > 3) throw new HttpsError('invalid-argument', 'Comments can include up to 3 attachments.')
  const prefix = `community/comments/${uid}/${postId}/${commentId}/`
  return rows.map((attachment) => {
    const type = cleanString(attachment?.type || '', 20)
    const name = cleanString(attachment?.name || '', 180)
    const path = cleanString(attachment?.path || '', 700)
    const contentType = cleanString(attachment?.contentType || '', 120).toLowerCase()
    const size = Math.max(0, Math.round(Number(attachment?.size || 0)))
    if (!['image', 'audio', 'project'].includes(type)) {
      throw new HttpsError('invalid-argument', 'Choose a supported comment attachment.')
    }
    if (!name || !path.startsWith(prefix) || path.includes('..')) {
      throw new HttpsError('invalid-argument', 'Comment attachment path is invalid.')
    }
    const validType = size > 0 && (type === 'image'
      ? contentType.startsWith('image/') && size <= 8 * 1024 * 1024
      : type === 'audio'
        ? contentType.startsWith('audio/') && size <= 25 * 1024 * 1024
        : ['application/json', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'audio/midi', 'audio/x-midi'].includes(contentType) && size <= 15 * 1024 * 1024)
    if (!validType) throw new HttpsError('invalid-argument', 'Comment attachment type or size is not allowed.')
    return { type, name, path, size, contentType }
  })
}

const createCommunityComment = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const postId = cleanString(request.data?.postId || '', 180)
  const parentCommentId = cleanString(request.data?.parentCommentId || '', 180)
  const body = cleanString(request.data?.body || '', 2000)
  const requestedCommentId = cleanString(request.data?.commentId || '', 180)

  if (!postId || postId.includes('/')) throw new HttpsError('invalid-argument', 'A valid post id is required.')
  if (parentCommentId.includes('/')) throw new HttpsError('invalid-argument', 'A valid parent comment id is required.')
  if (requestedCommentId.includes('/')) throw new HttpsError('invalid-argument', 'A valid comment id is required.')

  const firestore = db()
  const postRef = postRefFor(postId)
  const commentRef = requestedCommentId
    ? postRef.collection('comments').doc(requestedCommentId)
    : postRef.collection('comments').doc()
  const attachments = normalizeAttachments(request.data?.attachments || [], {
    uid,
    postId,
    commentId: commentRef.id
  })
  if (!body && !attachments.length) throw new HttpsError('invalid-argument', 'Add text or an attachment to this comment.')
  const parentRef = parentCommentId ? commentRefFor(postId, parentCommentId) : null
  const author = await loadAuthorSnapshot(uid)
  const now = admin.firestore.FieldValue.serverTimestamp()

  const result = await firestore.runTransaction(async (tx) => {
    const { post } = await assertPublicPost(tx, postRef)
    const existingCommentSnap = await tx.get(commentRef)
    if (existingCommentSnap.exists) throw new HttpsError('already-exists', 'This comment already exists.')
    if (post.commentsLocked === true) {
      throw new HttpsError('failed-precondition', 'Comments are locked on this post.')
    }
    const visibleCommentsSnap = await tx.get(postRef.collection('comments').where('status', '==', 'visible'))
    let parent = null
    if (parentRef) {
      const parentSnap = await tx.get(parentRef)
      if (!parentSnap.exists || parentSnap.data()?.status !== 'visible') {
        throw new HttpsError('not-found', 'Parent comment not found.')
      }
      parent = parentSnap.data() || {}
      if (parent.parentCommentId) throw new HttpsError('failed-precondition', 'Replies can only be one level deep.')
    }

    const payload = {
      commentId: commentRef.id,
      postId,
      authorUid: uid,
      ...author,
      body,
      attachments,
      parentCommentId: parentCommentId || '',
      replyCount: 0,
      likeCount: 0,
      dislikeCount: 0,
      status: 'visible',
      createdAt: now,
      updatedAt: now
    }

    tx.set(commentRef, payload)
    tx.set(postRef, {
      'counts.comments': Math.max(0, Number(visibleCommentsSnap.size || post.counts?.comments || 0)) + 1,
      commentCount: Math.max(0, Number(visibleCommentsSnap.size || post.counts?.comments || 0)) + 1,
      score: Math.max(0, Number(post.score || 0)) + 1,
      updatedAt: now
    }, { merge: true })
    if (parentRef) {
      tx.set(parentRef, {
        replyCount: admin.firestore.FieldValue.increment(1),
        updatedAt: now
      }, { merge: true })
    }

    const sourcePath = `/community/post/${postId}`
    const actorName = author.authorDisplayName || 'A creator'
    if (!parent && post.authorUid && post.authorUid !== uid) {
      writeAccountEventToBatch(firestore, tx, post.authorUid, {
        type: 'community_comment',
        title: 'New comment on your post',
        message: `${actorName} commented on your community post.`,
        actorUid: uid,
        actorType: 'user',
        source: 'community',
        path: sourcePath,
        metadata: { postId, commentId: commentRef.id }
      })
    }
    if (parent && parent.authorUid && parent.authorUid !== uid) {
      writeAccountEventToBatch(firestore, tx, parent.authorUid, {
        type: 'community_reply',
        title: 'New reply to your comment',
        message: `${actorName} replied to your community comment.`,
        actorUid: uid,
        actorType: 'user',
        source: 'community',
        path: sourcePath,
        metadata: { postId, commentId: commentRef.id, parentCommentId }
      })
    }

    return {
      post,
      payload,
      commentCount: Math.max(0, Number(visibleCommentsSnap.size || post.counts?.comments || 0)) + 1
    }
  })

  return {
    ok: true,
    postId,
    commentId: commentRef.id,
    commentCount: result.commentCount,
    comment: serializeComment({
      ...result.payload,
      createdAt: new Date(),
      updatedAt: new Date()
    }, commentRef.id)
  }
})

module.exports = {
  createCommunityComment
}
