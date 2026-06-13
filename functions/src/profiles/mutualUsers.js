const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const firestore = admin.firestore()

function cleanString(value = '', max = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function requireAuth(request) {
  const uid = cleanString(request.auth?.uid || '')
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function validUid(value = '') {
  const uid = cleanString(value)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid user id is required.')
  return uid
}

function normalizeSuggestion(uid, profile = {}, reasons = {}) {
  const reasonLabels = []
  const reasonCodes = []
  if (reasons.mutualFollowers > 0) {
    reasonCodes.push('mutual_followers')
    reasonLabels.push(`${reasons.mutualFollowers} mutual connection${reasons.mutualFollowers === 1 ? '' : 's'}`)
  }
  if (reasons.sameCommunities > 0) {
    reasonCodes.push('same_community')
    reasonLabels.push(reasons.sameCommunities === 1 ? 'Same community' : `${reasons.sameCommunities} shared communities`)
  }
  if (reasons.sameLocation) {
    reasonCodes.push('location_match')
    reasonLabels.push('Same public location')
  }
  return {
    uid,
    displayName: cleanString(profile.displayName || 'Melogic member', 120),
    username: cleanString(profile.username || '', 80),
    photoURL: cleanString(profile.avatarURL || profile.photoURL || '', 900),
    roleLabel: cleanString(profile.roleLabel || 'Melogic member', 80),
    reasonCodes,
    reasonLabels,
    score: Math.max(0, Number(reasons.score || 0)),
    alreadyFollowing: false,
    canMessage: true
  }
}

function rankSuggestionCandidates(candidateMap = new Map(), { limit = 18 } = {}) {
  return [...candidateMap.entries()]
    .map(([uid, reasons]) => ({
      uid,
      ...reasons,
      score: Number(reasons.mutualFollowers || 0) * 4
        + Number(reasons.sameCommunities || 0) * 3
        + (reasons.sameLocation ? 1 : 0)
    }))
    .sort((a, b) => b.score - a.score || String(a.uid).localeCompare(String(b.uid)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 18, 30)))
}

async function loadSuggestions(viewerUid, limitCount) {
  const userRef = firestore.collection('users').doc(viewerUid)
  const [followingSnap, dismissedSnap, viewerProfileSnap, focusedSnap] = await Promise.all([
    userRef.collection('following').limit(15).get(),
    userRef.collection('dismissedSuggestions').limit(250).get(),
    firestore.collection('profiles').doc(viewerUid).get(),
    userRef.collection('focusedCommunities').limit(8).get()
  ])
  const existingFollowing = new Set(followingSnap.docs.map((entry) => entry.id))
  const dismissed = new Set(dismissedSnap.docs.map((entry) => entry.id))
  const candidates = new Map()

  await Promise.all(followingSnap.docs.map(async (connection) => {
    const secondDegree = await firestore.collection('users').doc(connection.id).collection('following').limit(20).get()
    secondDegree.docs.forEach((entry) => {
      const uid = entry.id
      if (!uid || uid === viewerUid || existingFollowing.has(uid) || dismissed.has(uid)) return
      const current = candidates.get(uid) || { mutualFollowers: 0, sameCommunities: 0 }
      current.mutualFollowers += 1
      candidates.set(uid, current)
    })
  }))

  await Promise.all(focusedSnap.docs.map(async (community) => {
    const peers = await firestore.collectionGroup('focusedCommunities')
      .where('communityId', '==', community.id)
      .limit(20)
      .get()
    peers.docs.forEach((entry) => {
      const uid = entry.ref.parent.parent?.id || ''
      if (!uid || uid === viewerUid || existingFollowing.has(uid) || dismissed.has(uid)) return
      const current = candidates.get(uid) || { mutualFollowers: 0, sameCommunities: 0 }
      current.sameCommunities += 1
      candidates.set(uid, current)
    })
  }))

  const ranked = rankSuggestionCandidates(candidates, { limit: limitCount * 2 })
  if (!ranked.length) return []
  const profileSnaps = await firestore.getAll(...ranked.map((entry) => firestore.collection('profiles').doc(entry.uid)))
  const profileByUid = new Map(profileSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() || {}]))
  const viewerLocation = cleanString(viewerProfileSnap.data()?.location || '', 120).toLowerCase()

  return ranked
    .map((entry) => {
      const profile = profileByUid.get(entry.uid)
      if (!profile) return null
      const candidateLocation = cleanString(profile.location || '', 120).toLowerCase()
      const reasons = {
        ...entry,
        sameLocation: Boolean(viewerLocation && candidateLocation && viewerLocation === candidateLocation)
      }
      return normalizeSuggestion(entry.uid, profile, reasons)
    })
    .filter(Boolean)
    .slice(0, limitCount)
}

const getMutualUserSuggestions = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const viewerUid = requireAuth(request)
  const limitCount = Math.max(1, Math.min(Number(request.data?.limit) || 18, 30))
  const suggestions = await loadSuggestions(viewerUid, limitCount)
  return {
    ok: true,
    suggestions,
    sources: {
      mutualFollowers: true,
      sameCommunities: true,
      publicLocation: true,
      tags: false,
      interactions: false
    }
  }
})

const dismissMutualUserSuggestion = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const viewerUid = requireAuth(request)
  const suggestedUid = validUid(request.data?.suggestedUid)
  if (viewerUid === suggestedUid) throw new HttpsError('failed-precondition', 'You cannot dismiss your own profile.')
  await firestore.collection('users').doc(viewerUid).collection('dismissedSuggestions').doc(suggestedUid).set({
    suggestedUid,
    dismissedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  return { ok: true, suggestedUid }
})

const matchContactsToUsers = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  requireAuth(request)
  const inputContacts = Array.isArray(request.data?.contacts) ? request.data.contacts : []
  if (inputContacts.length > 100) throw new HttpsError('invalid-argument', 'Choose 100 contacts or fewer.')
  const contacts = inputContacts.slice(0, 100)
  return {
    ok: true,
    matches: [],
    matchingEnabled: false,
    processedCount: contacts.length,
    message: 'Secure contact matching will activate after the private verified-identifier index is provisioned. No contacts were stored.'
  }
})

module.exports = {
  dismissMutualUserSuggestion,
  getMutualUserSuggestions,
  matchContactsToUsers,
  normalizeSuggestion,
  rankSuggestionCandidates
}
