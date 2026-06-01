const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')

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
      score: nextCount(post.score, kind === 'like' ? delta : 0),
      updatedAt: now
    }, { merge: true })

    return {
      ok: true,
      postId: postRef.id,
      active,
      [`${countKey}Count`]: count
    }
  })
}

const toggleCommunityPostLike = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => togglePostState(request, 'like'))
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
    tx.set(postRef, { 'counts.shares': count, updatedAt: now }, { merge: true })
    return { ok: true, postId: postRef.id, sharesCount: count }
  })
})

module.exports = {
  toggleCommunityPostLike,
  toggleCommunityPostSave,
  recordCommunityPostShare
}
