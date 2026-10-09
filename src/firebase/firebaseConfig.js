import publicFirebaseConfig from '../../config/firebase-client.json'
import { initializeApp, getApps } from 'firebase/app'
import { initAppCheck } from './appCheck.js'

const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || publicFirebaseConfig.projectId
const APP_NAME = 'melogic-records-web'

function apiKeyHint(value) {
  const key = String(value || '').trim()
  if (!key) return 'missing'
  if (key.length <= 10) return key
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

const fallbackFirebaseConfig = publicFirebaseConfig

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fallbackFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fallbackFirebaseConfig.authDomain,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || fallbackFirebaseConfig.databaseURL,
  projectId: PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fallbackFirebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackFirebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fallbackFirebaseConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || fallbackFirebaseConfig.measurementId
}

const existingApp = getApps().find((instance) => instance.name === APP_NAME)
export const app = existingApp || initializeApp(firebaseConfig, APP_NAME)

const firebaseConfigDiag = {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  appId: firebaseConfig.appId,
  apiKeyHint: apiKeyHint(firebaseConfig.apiKey)
}

console.info('[firebase/config] initialized', firebaseConfigDiag)

if (typeof window !== 'undefined') {
  window.__MELOGIC_FIREBASE_DIAG__ = () => ({
    ...firebaseConfigDiag,
    currentHostname: window.location.hostname
  })
}

initAppCheck(app)
export { firebaseConfig }
