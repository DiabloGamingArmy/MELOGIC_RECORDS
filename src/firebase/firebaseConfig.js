import { initializeApp, getApps } from 'firebase/app'

const PROJECT_ID = 'melogic-records'
const APP_NAME = 'melogic-records-web'

const fallbackFirebaseConfig = {
  apiKey: 'AIzaSyAckD68tYqbvoZqdVYLUA1k6Nw2pp6UpVU',
  authDomain: 'melogic-records.firebaseapp.com',
  projectId: PROJECT_ID,
  storageBucket: 'melogic-records.firebasestorage.app',
  messagingSenderId: '799449606868',
  appId: '1:799449606868:web:67ca014dc47b9cb0146941',
  measurementId: 'G-60NKMRCX5W'
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || fallbackFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || fallbackFirebaseConfig.authDomain,
  projectId: PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || fallbackFirebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackFirebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || fallbackFirebaseConfig.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || fallbackFirebaseConfig.measurementId
}

const existingApp = getApps().find((instance) => instance.name === APP_NAME)
export const app = existingApp || initializeApp(firebaseConfig, APP_NAME)
export { firebaseConfig }
