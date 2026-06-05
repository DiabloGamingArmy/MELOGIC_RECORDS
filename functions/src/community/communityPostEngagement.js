const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { writeAccountEventToBatch } = require('../account/accountEvents')
const { loadAuthorSnapshot } = require('./communityCommentShared')

function requireAuth(request) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function postRefFor(postId = '') {
  const id = cleanString(postId, 180)
  if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'A valid post id is required.')
  return admin.firestore().collection('communityPosts').doc(id)
}

async function assertPublicPost(tx, postRef) {
  const postSnap = await tx.get(postRef)
  if (!postSnap.exists) throw new HttpsError('not-found', 'Community post not found.')
  const post = postSnap.data() || {}
  if (post.status !== 'published' || post.visibility !== 'public') {
    throw new HttpsError('permission-denied', 'This community post is not available.')
  }
  return post
}

function nextCount(current = 0, delta = 0) {
  return Math.max(0, Math.round(Number(current || 0)) + delta)
}

async function togglePostState(request, kind = 'like') {
  const uid = requireAuth(request)
  const postRef = postRefFor(request.data?.postId || '')
  const childName = kind === 'save' ? 'saves' : 'likes'
  const countKey = kind === 'save' ? 'saves' : 'likes'
  const stateRef = postRef.collection(childName).doc(uid)
  const author = kind === 'like' ? await loadAuthorSnapshot(uid) : null

  return admin.firestore().runTransaction(async (tx) => {
    const post = await assertPublicPost(tx, postRef)
    const stateSnap = await tx.get(stateRef)
    const active = !stateSnap.exists
    const delta = active ? 1 : -1
    const count = nextCount(post.counts?.[countKey], delta)
    const now = admin.firestore.FieldValue.serverTimestamp()

    if (active) tx.set(stateRef, { uid, postId: postRef.id, createdAt: now, updatedAt: now })
    else tx.delete(stateRef)

    tx.set(postRef, {
      [`counts.${countKey}`]: count,
      [kind === 'save' ? 'saveCount' : 'likeCount']: count,
      score: nextCount(post.score, kind === 'like' ? delta : 0),
      updatedAt: now
    }, { merge: true })

    if (kind === 'like' && active && post.authorUid && post.authorUid !== uid) {
      writeAccountEventToBatch(admin.firestore(), tx, post.authorUid, {
        type: 'community_post_like',
        title: 'Your post got a like',
        message: `${author?.authorDisplayName || 'A creator'} liked your community post.`,
        actorUid: uid,
        actorType: 'user',
        source: 'community',
        path: `/community/post/${postRef.id}`,
        metadata: { postId: postRef.id }
      })
    }

    return {
      ok: true,
      postId: postRef.id,
      active,
      [`${countKey}Count`]: count
    }
  })
}

async function togglePostReaction(request, reaction = 'like') {
  const uid = requireAuth(request)
  const postRef = postRefFor(request.data?.postId || '')
  const likeRef = postRef.collection('likes').doc(uid)
  const dislikeRef = postRef.collection('dislikes').doc(uid)
  const author = reaction === 'like' ? await loadAuthorSnapshot(uid) : null

  return admin.firestore().runTransaction(async (tx) => {
    const post = await assertPublicPost(tx, postRef)
    const [likeSnap, dislikeSnap] = await Promise.all([tx.get(likeRef), tx.get(dislikeRef)])
    const currentReaction = likeSnap.exists ? 'like' : dislikeSnap.exists ? 'dislike' : ''
    const nextReaction = currentReaction === reaction ? '' : reaction
    const likeDelta = (nextReaction === 'like' ? 1 : 0) - (currentReaction === 'like' ? 1 : 0)
    const dislikeDelta = (nextReaction === 'dislike' ? 1 : 0) - (currentReaction === 'dislike' ? 1 : 0)
    const likeCount = nextCount(post.counts?.likes ?? post.likeCount, likeDelta)
    const dislikeCount = nextCount(post.counts?.dislikes ?? post.dislikeCount, dislikeDelta)
    const now = admin.firestore.FieldValue.serverTimestamp()

    if (nextReaction === 'like') {
      tx.set(likeRef, { uid, postId: postRef.id, reaction: 'like', createdAt: now, updatedAt: now }, { merge: true })
      tx.delete(dislikeRef)
    } else if (nextReaction === 'dislike') {
      tx.set(dislikeRef, { uid, postId: postRef.id, reaction: 'dislike', createdAt: now, updatedAt: now }, { merge: true })
      tx.delete(likeRef)
    } else {
      if (currentReaction === 'like') tx.delete(likeRef)
      if (currentReaction === 'dislike') tx.delete(dislikeRef)
    }

    tx.set(postRef, {
      'counts.likes': likeCount,
      'counts.dislikes': dislikeCount,
      likeCount,
      dislikeCount,
      score: nextCount(post.score, likeDelta),
      updatedAt: now
    }, { merge: true })

    if (nextReaction === 'like' && currentReaction !== 'like' && post.authorUid && post.authorUid !== uid) {
      writeAccountEventToBatch(admin.firestore(), tx, post.authorUid, {
        type: 'community_post_like',
        title: 'Your post got a like',
        message: `${author?.authorDisplayName || 'A creator'} liked your community post.`,
        actorUid: uid,
        actorType: 'user',
        source: 'community',
        path: `/community/post/${postRef.id}`,
        metadata: { postId: postRef.id }
      })
    }

    return {
      ok: true,
      postId: postRef.id,
      reaction: nextReaction || null,
      liked: nextReaction === 'like',
      disliked: nextReaction === 'dislike',
      active: nextReaction === reaction,
      likesCount: likeCount,
      dislikesCount: dislikeCount,
      likeCount,
      dislikeCount
    }
  })
}

const toggleCommunityPostLike = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => togglePostReaction(request, 'like'))
const toggleCommunityPostDislike = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => togglePostReaction(request, 'dislike'))
const toggleCommunityPostSave = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => togglePostState(request, 'save'))

const recordCommunityPostShare = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const postRef = postRefFor(request.data?.postId || '')
  const shareRef = postRef.collection('shares').doc(uid)

  return admin.firestore().runTransaction(async (tx) => {
    const post = await assertPublicPost(tx, postRef)
    const count = nextCount(post.counts?.shares, 1)
    const now = admin.firestore.FieldValue.serverTimestamp()
    tx.set(shareRef, { uid, postId: postRef.id, sharedAt: now, updatedAt: now }, { merge: true })
    tx.set(postRef, { 'counts.shares': count, shareCount: count, updatedAt: now }, { merge: true })
    return { ok: true, postId: postRef.id, sharesCount: count }
  })
})

module.exports = {
  toggleCommunityPostLike,
  toggleCommunityPostDislike,
  toggleCommunityPostSave,
  recordCommunityPostShare
}
