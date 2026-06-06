import {
  getAuth,
  onAuthStateChanged,
  onIdTokenChanged,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updateProfile
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { app } from './firebaseConfig.js'
import { functions } from './functions.js'

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
const googleProviderWithAccountSelect = new GoogleAuthProvider()
googleProviderWithAccountSelect.setCustomParameters({ prompt: 'select_account' })

export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback)
}

export function subscribeToIdToken(callback) {
  return onIdTokenChanged(auth, callback)
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

export async function signInWithEmail(email, password) {
  await authPersistenceReady
  return signInWithEmailAndPassword(auth, email, password)
}

export async function createAccountWithEmail(email, password) {
  await authPersistenceReady
  return createUserWithEmailAndPassword(auth, email, password)
}

export async function signInWithGoogle({ forceAccountSelect = false } = {}) {
  await authPersistenceReady
  return signInWithPopup(auth, forceAccountSelect ? googleProviderWithAccountSelect : googleProvider)
}

export async function sendPasswordReset(email) {
  await authPersistenceReady
  const callable = httpsCallable(functions, 'requestPasswordResetEmail')
  const result = await callable({ email })
  return result?.data || { ok: true }
}

export async function sendEmailVerificationRequest() {
  await authPersistenceReady
  const callable = httpsCallable(functions, 'requestEmailVerification')
  const result = await callable({})
  return result?.data || { ok: true }
}

export function signOutUser() {
  return signOut(auth)
}

export function updateCurrentUserProfile(profileUpdates) {
  if (!auth.currentUser) return Promise.resolve()
  return updateProfile(auth.currentUser, profileUpdates)
}
