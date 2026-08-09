const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { writeAccountEventToBatch } = require('../account/accountEvents')
const { loadAuthorSnapshot } = require('./communityCommentShared')
const { canonicalCounter, desiredToggleState, reactionTransition } = require('./communityEngagementState')

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
    const active = desiredToggleState(stateSnap.exists, request.data?.active)
    const delta = Number(active) - Number(stateSnap.exists)
    const count = nextCount(canonicalCounter(post, kind === 'save' ? 'saveCount' : 'likeCount', countKey), delta)
    const now = admin.firestore.FieldValue.serverTimestamp()

    if (active && !stateSnap.exists) tx.set(stateRef, { uid, postId: postRef.id, createdAt: now, updatedAt: now })
    else if (!active && stateSnap.exists) tx.delete(stateRef)

    tx.set(postRef, {
      [`counts.${countKey}`]: count,
      [kind === 'save' ? 'saveCount' : 'likeCount']: count,
      score: nextCount(post.score, kind === 'like' ? delta : 0),
      updatedAt: now
    }, { merge: true })

    if (kind === 'like' && active && !stateSnap.exists && post.authorUid && post.authorUid !== uid) {
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
    const transition = reactionTransition({
      likeExists: likeSnap.exists,
      dislikeExists: dislikeSnap.exists,
      requestedReaction: reaction,
      requestedActive: request.data?.active
    })
    const { liked, disliked, likeDelta, dislikeDelta } = transition
    const likeCount = nextCount(canonicalCounter(post, 'likeCount', 'likes'), likeDelta)
    const dislikeCount = nextCount(canonicalCounter(post, 'dislikeCount', 'dislikes'), dislikeDelta)
    const now = admin.firestore.FieldValue.serverTimestamp()

    if (liked) {
      tx.set(likeRef, { uid, postId: postRef.id, reaction: 'like', createdAt: now, updatedAt: now }, { merge: true })
      tx.delete(dislikeRef)
    } else if (disliked) {
      tx.set(dislikeRef, { uid, postId: postRef.id, reaction: 'dislike', createdAt: now, updatedAt: now }, { merge: true })
      tx.delete(likeRef)
    } else {
      tx.delete(likeRef)
      tx.delete(dislikeRef)
    }

    tx.set(postRef, {
      'counts.likes': likeCount,
      'counts.dislikes': dislikeCount,
      likeCount,
      dislikeCount,
      score: nextCount(post.score, likeDelta),
      updatedAt: now
    }, { merge: true })

    if (liked && !likeSnap.exists && post.authorUid && post.authorUid !== uid) {
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
      reaction: transition.reaction,
      liked,
      disliked,
      active: reaction === 'like' ? liked : disliked,
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
    const shareSnap = await tx.get(shareRef)
    const count = nextCount(canonicalCounter(post, 'shareCount', 'shares'), shareSnap.exists ? 0 : 1)
    const now = admin.firestore.FieldValue.serverTimestamp()
    tx.set(shareRef, {
      uid,
      postId: postRef.id,
      ...(!shareSnap.exists ? { sharedAt: now } : {}),
      updatedAt: now
    }, { merge: true })
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
