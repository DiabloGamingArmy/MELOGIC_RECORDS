import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore'
import { app } from './firebaseConfig.js'

let hasWarnedFirestore = false

export let db = null

try {
  db = getFirestore(app)
} catch (error) {
  if (!hasWarnedFirestore) {
    hasWarnedFirestore = true
    console.warn('[firebase/firestore] Firestore initialization failed.', error?.message || error)
  }
}

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
  const profileRef = doc(db, 'users', uid)
  const snapshot = await getDoc(profileRef)
  return snapshot.exists() ? snapshot.data() : null
}
