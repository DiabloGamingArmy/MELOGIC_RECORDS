import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  updateProfile
} from 'firebase/auth'
import { app } from './firebaseConfig.js'

export const auth = getAuth(app)

const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({ prompt: 'select_account' })

export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback)
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
