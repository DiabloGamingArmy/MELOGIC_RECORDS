import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updateProfile
} from 'firebase/auth'
import { app } from './firebaseConfig.js'

export const auth = getAuth(app)
let hasWarnedPersistence = false
let initialAuthStatePromise = null

export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  if (!hasWarnedPersistence) {
    hasWarnedPersistence = true
    console.warn('[firebase/auth] Failed to enable local persistence.', error?.code || error?.message || error)
  }
})

const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({ prompt: 'select_account' })

export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback)
}

export async function waitForInitialAuthState() {
  if (initialAuthStatePromise) return initialAuthStatePromise

  initialAuthStatePromise = authPersistenceReady.then(
    () =>
      new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          unsubscribe()
          resolve(user)
        })
      })
  )

  return initialAuthStatePromise
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function createAccountWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password)
}

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider)
}

export function signOutUser() {
  return signOut(auth)
}

export function updateCurrentUserProfile(profileUpdates) {
  if (!auth.currentUser) return Promise.resolve()
  return updateProfile(auth.currentUser, profileUpdates)
}
