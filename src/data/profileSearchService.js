import { collection, getDocs, limit, orderBy, query, startAt, endAt } from 'firebase/firestore'
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

  const snapshot = await getDocs(profileQuery)
  return snapshot.docs.map(normalizeProfile)
}
