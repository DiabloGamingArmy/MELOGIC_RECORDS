import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAt, endAt } from 'firebase/firestore'
import { db } from '../firebase/firestore'

function normalizeProfile(profileDoc) {
  const raw = profileDoc.data() || {}
  return {
    uid: raw.uid || profileDoc.id,
    displayName: String(raw.displayName || '').trim(),
    username: String(raw.username || '').trim(),
    usernameLower: String(raw.usernameLower || raw.username || '').trim().toLowerCase(),
    avatarURL: String(raw.avatarURL || '').trim(),
    photoURL: String(raw.photoURL || '').trim()
  }
}

export async function searchProfilesByUsername(input = '') {
  if (!db) return []
  const normalized = String(input || '').trim().toLowerCase()
  if (normalized.length < 2) return []

  const profileQuery = query(
    collection(db, 'profiles'),
    orderBy('usernameLower'),
    startAt(normalized),
    endAt(`${normalized}\uf8ff`),
    limit(10)
  )

  try {
    const snapshot = await getDocs(profileQuery)
    return snapshot.docs.map(normalizeProfile)
  } catch (error) {
    console.warn('[profileSearchService] Prefix profile search failed. Trying exact username lookup.', error?.code || error?.message || error)
    if (!/^[a-z0-9_-]{3,30}$/.test(normalized)) {
      const lookupError = new Error('Unable to search users right now.')
      lookupError.code = 'profile-search/unavailable'
      throw lookupError
    }

    try {
      const claimSnap = await getDoc(doc(db, 'usernameClaims', normalized))
      const uid = claimSnap.exists() ? claimSnap.data()?.uid : ''
      if (!uid) return []
      const profileSnap = await getDoc(doc(db, 'profiles', uid))
      if (!profileSnap.exists()) return []
      return [normalizeProfile(profileSnap)]
    } catch (fallbackError) {
      console.warn('[profileSearchService] Exact username lookup failed.', fallbackError?.code || fallbackError?.message || fallbackError)
      const lookupError = new Error('Unable to search users right now.')
      lookupError.code = 'profile-search/unavailable'
      throw lookupError
    }
  }
}
