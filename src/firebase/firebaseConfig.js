import { initializeApp, getApps } from 'firebase/app'
import { initAppCheck } from './appCheck.js'

const PROJECT_ID = 'melogic-records'
const APP_NAME = 'melogic-records-web'

function apiKeyHint(value) {
  const key = String(value || '').trim()
  if (!key) return 'missing'
  if (key.length <= 10) return key
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

const fallbackFirebaseConfig = {
  apiKey: 'AIzaSyAckD68tYqbvoZqdVYLUA1k6Nw2pp6UpVU',
  authDomain: 'melogic-records.firebaseapp.com',
  databaseURL: 'https://melogic-records-default-rtdb.firebaseio.com',
  projectId: PROJECT_ID,
  storageBucket: 'melogic-records.firebasestorage.app',
  messagingSenderId: '799449606868',
  appId: '1:799449606868:web:67ca014dc47b9cb0146941',
  measurementId: 'G-60NKMRCX5W'
}

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
