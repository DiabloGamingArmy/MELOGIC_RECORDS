import { getDatabase } from 'firebase/database'
import { app } from './firebaseConfig.js'

let hasWarnedDatabaseInit = false

export let realtimeDatabase = null

try {
  realtimeDatabase = getDatabase(app)
} catch (error) {
  if (!hasWarnedDatabaseInit) {
    hasWarnedDatabaseInit = true
    console.warn('[firebase/realtimeDatabase] Realtime Database initialization failed.', error?.message || error)
  }
}
