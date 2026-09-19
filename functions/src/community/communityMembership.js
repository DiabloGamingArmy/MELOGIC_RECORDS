const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')

function requireAuth(request) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function membershipPolicy(community = {}) {
  const explicit = cleanString(community.membershipPolicy || '', 40).toLowerCase()
  if (['open', 'approval', 'invite', 'email_domain', 'affiliation', 'private'].includes(explicit)) return explicit
  return community.visibility === 'public' ? 'open' : 'approval'
}

function membershipRef(firestore, communityId, uid) {
  return firestore.collection('communities').doc(communityId).collection('members').doc(uid)
}

const getCommunityMembership = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const communityId = cleanString(request.data?.communityId || '', 180)
  if (!communityId || communityId.includes('/')) throw new HttpsError('invalid-argument', 'A valid community id is required.')
  const firestore = admin.firestore()
  const [communitySnap, memberSnap] = await Promise.all([
    firestore.collection('communities').doc(communityId).get(),
    membershipRef(firestore, communityId, uid).get()
  ])
  if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
  const community = communitySnap.data() || {}
  const membership = memberSnap.exists ? memberSnap.data() || {} : null
  return {
    ok: true,
    communityId,
    policy: membershipPolicy(community),
    membership: membership ? {
      status: cleanString(membership.status || 'member', 40),
      roleIds: Array.isArray(membership.roleIds) ? membership.roleIds.slice(0, 20) : ['member'],
      verificationType: cleanString(membership.verificationType || '', 60),
      verified: membership.verified === true
    } : null
  }
})

const joinCommunity = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const communityId = cleanString(request.data?.communityId || '', 180)
  if (!communityId || communityId.includes('/')) throw new HttpsError('invalid-argument', 'A valid community id is required.')
  const firestore = admin.firestore()
  const communityRef = firestore.collection('communities').doc(communityId)
  const memberRef = membershipRef(firestore, communityId, uid)
  return firestore.runTransaction(async (tx) => {
    const [communitySnap, memberSnap] = await Promise.all([tx.get(communityRef), tx.get(memberRef)])
    if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
    const community = communitySnap.data() || {}
    if (community.status !== 'active') throw new HttpsError('failed-precondition', 'This community is not available.')
    if (memberSnap.exists) {
      const current = memberSnap.data() || {}
      return { ok: true, communityId, status: cleanString(current.status || 'member', 40), alreadyJoined: true }
    }

    const policy = membershipPolicy(community)
    if (['invite', 'private', 'email_domain', 'affiliation'].includes(policy)) {
      throw new HttpsError('failed-precondition', 'This community requires verification or an invitation before joining.')
    }
    const status = policy === 'approval' ? 'pending' : 'member'
    const now = admin.firestore.FieldValue.serverTimestamp()
    tx.set(memberRef, {
      communityId,
      uid,
      status,
      roleIds: ['member'],
      verificationType: '',
      verified: false,
      joinedAt: now,
      updatedAt: now
    })
    const currentCount = Math.max(0, Number(community.memberCount || 0))
    if (status === 'member') tx.set(communityRef, { memberCount: currentCount + 1, updatedAt: now }, { merge: true })
    return { ok: true, communityId, status, alreadyJoined: false }
  })
})

const leaveCommunity = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const communityId = cleanString(request.data?.communityId || '', 180)
  if (!communityId || communityId.includes('/')) throw new HttpsError('invalid-argument', 'A valid community id is required.')
  const firestore = admin.firestore()
  const communityRef = firestore.collection('communities').doc(communityId)
  const memberRef = membershipRef(firestore, communityId, uid)
  return firestore.runTransaction(async (tx) => {
    const [communitySnap, memberSnap] = await Promise.all([tx.get(communityRef), tx.get(memberRef)])
    if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
    if (!memberSnap.exists) return { ok: true, communityId, left: false }
    const community = communitySnap.data() || {}
    if (community.ownerUid === uid || community.createdBy === uid) {
      throw new HttpsError('failed-precondition', 'Transfer ownership before leaving this community.')
    }
    const member = memberSnap.data() || {}
    tx.delete(memberRef)
    if (member.status === 'member') {
      const now = admin.firestore.FieldValue.serverTimestamp()
      tx.set(communityRef, { memberCount: Math.max(0, Number(community.memberCount || 0) - 1), updatedAt: now }, { merge: true })
    }
    return { ok: true, communityId, left: true }
  })
})

module.exports = { getCommunityMembership, joinCommunity, leaveCommunity }
