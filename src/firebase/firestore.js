import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore'
import { app } from './firebaseConfig.js'

let hasWarnedProfileRead = false

export const db = getFirestore(app)

export async function upsertUserProfile(user, profileInput = {}) {
  if (!db || !user?.uid) return false

  const userRef = doc(db, 'users', user.uid)
  const payload = {
    uid: user.uid,
    displayName: profileInput.displayName || user.displayName || '',
    username: profileInput.username || '',
    email: user.email || profileInput.email || '',
    photoURL: user.photoURL || null,
    bio: profileInput.bio || '',
    role: 'user',
    updatedAt: serverTimestamp()
  }

  if (profileInput.isNewUser) {
    payload.createdAt = serverTimestamp()
  }

  await setDoc(userRef, payload, { merge: true })
  return true
}

export async function getUserProfile(uid) {
  if (!db || !uid) return null
  try {
    const profileRef = doc(db, 'users', uid)
    const snapshot = await getDoc(profileRef)
    return snapshot.exists() ? snapshot.data() : null
  } catch (error) {
    if (!hasWarnedProfileRead) {
      hasWarnedProfileRead = true
      console.warn('[firebase/firestore] Profile read failed; falling back to Auth user.', error?.message || error)
    }
    return null
  }
}
