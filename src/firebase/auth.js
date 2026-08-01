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
  sendPasswordResetEmail,
  sendEmailVerification,
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
  try {
    const result = await callable({ email })
    const response = result?.data || { ok: true }
    if (response.fallback !== 'firebase_auth') return response
  } catch (error) {
    const code = String(error?.code || '')
    const recoverable = [
      'functions/resource-exhausted',
      'functions/unavailable',
      'functions/deadline-exceeded',
      'functions/internal'
    ].includes(code)
    if (!recoverable) throw error
  }
  await sendPasswordResetEmail(auth, String(email || '').trim(), {
    url: 'https://melogicrecords.studio/auth',
    handleCodeInApp: false
  })
  return {
    ok: true,
    message: 'If an account exists for that email, we sent a password reset link.',
    provider: 'firebase_auth'
  }
}

const AUTH_EMAIL_CONTINUE_URL = 'https://melogicrecords.studio/account/security'

async function sendFirebaseEmailVerification(user) {
  if (!user) {
    const error = new Error('Sign in before requesting another verification email.')
    error.code = 'auth/requires-recent-login'
    throw error
  }
  if (user.emailVerified) return { ok: true, message: 'Your email is already verified.' }
  await sendEmailVerification(user, {
    url: AUTH_EMAIL_CONTINUE_URL,
    handleCodeInApp: false
  })
  return {
    ok: true,
    message: 'Verification email sent.',
    provider: 'firebase_auth'
  }
}

export async function sendEmailVerificationRequest() {
  await authPersistenceReady
  const callable = httpsCallable(functions, 'requestEmailVerification')
  try {
    const result = await callable({})
    const response = result?.data || { ok: true }
    if (response.fallback !== 'firebase_auth') return response
  } catch (error) {
    // Verification must not depend on the custom SMTP relay being reachable.
    // Firebase Auth has its own protected delivery path and quotas, so use it
    // when the callable is unavailable or its server-side cooldown was reached
    // after a failed SMTP attempt.
    const code = String(error?.code || '')
    const recoverable = [
      'functions/resource-exhausted',
      'functions/unavailable',
      'functions/deadline-exceeded',
      'functions/internal'
    ].includes(code)
    if (!recoverable) throw error
  }
  return sendFirebaseEmailVerification(auth.currentUser)
}

export function signOutUser() {
  return signOut(auth)
}

export function updateCurrentUserProfile(profileUpdates) {
  if (!auth.currentUser) return Promise.resolve()
  return updateProfile(auth.currentUser, profileUpdates)
}
