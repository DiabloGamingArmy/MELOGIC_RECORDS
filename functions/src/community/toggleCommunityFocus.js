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

const toggleCommunityFocus = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const communityId = cleanString(request.data?.communityId || '', 180)
  if (!communityId || communityId.includes('/')) throw new HttpsError('invalid-argument', 'A valid community id is required.')

  const firestore = admin.firestore()
  const communityRef = firestore.collection('communities').doc(communityId)
  const focusRef = firestore.collection('users').doc(uid).collection('focusedCommunities').doc(communityId)
  const actor = await loadAuthorSnapshot(uid).catch(() => ({ authorDisplayName: 'A creator' }))

  return firestore.runTransaction(async (tx) => {
    const [communitySnap, focusSnap] = await Promise.all([tx.get(communityRef), tx.get(focusRef)])
    if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
    const community = communitySnap.data() || {}
    if (community.status !== 'active' || community.visibility !== 'public') {
      throw new HttpsError('failed-precondition', 'This community is not available.')
    }

    const focused = !focusSnap.exists
    const current = Math.max(0, Number(community.focusCount || 0))
    const focusCount = Math.max(0, current + (focused ? 1 : -1))
    const now = admin.firestore.FieldValue.serverTimestamp()

    if (focused) {
      tx.set(focusRef, {
        communityId,
        slug: cleanString(community.slug || communityId, 80),
        name: cleanString(community.name || communityId, 120),
        category: cleanString(community.category || '', 80),
        focusedAt: now,
        updatedAt: now
      })
    } else {
      tx.delete(focusRef)
    }

    tx.set(communityRef, { focusCount, updatedAt: now }, { merge: true })
    if (focused && community.ownerUid && community.ownerUid !== uid) {
      writeAccountEventToBatch(firestore, tx, community.ownerUid, {
        type: 'community_follow',
        title: 'New community focus',
        message: `${actor.authorDisplayName || 'A creator'} focused ${community.name || 'your community'}.`,
        actorUid: uid,
        actorType: 'user',
        source: 'community',
        path: `/community/c/${cleanString(community.slug || communityId, 80)}`,
        metadata: { communityId, actorUid: uid }
      })
    }
    return { ok: true, communityId, focused, focusCount }
  })
})

module.exports = {
  toggleCommunityFocus
}
