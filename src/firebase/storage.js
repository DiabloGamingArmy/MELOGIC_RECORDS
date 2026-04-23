import { getStorage } from 'firebase/storage'
import { app } from './firebaseConfig.js'

let hasWarnedStorageInit = false

export let storage = null

try {
  storage = getStorage(app)
} catch (error) {
  if (!hasWarnedStorageInit) {
    hasWarnedStorageInit = true
    console.warn('[firebase/storage] Storage initialization failed.', error?.message || error)
  }
}
