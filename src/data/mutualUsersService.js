import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { searchProfilesByUsername } from './profileSearchService'
import { platformRecommendation } from '../platform/platformCapabilities'

const SESSION_KEY = 'melogic_discovery_session_v1'

function cleanSessionId(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
}

function getDiscoverySessionId() {
  try {
    const existing = cleanSessionId(window.localStorage.getItem(SESSION_KEY))
    if (existing) return existing
    const generated = cleanSessionId(globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`)
    window.localStorage.setItem(SESSION_KEY, generated)
    return generated
  } catch {
    return `session-${Date.now()}`
  }
}

function publicCapabilitySnapshot(capabilities = {}) {
  return {
    platform: capabilities.platform || 'unknown',
    supportsContactPicker: capabilities.supportsContactPicker === true,
    supportsFilePicker: capabilities.supportsFilePicker === true,
    supportsShare: capabilities.supportsShare === true,
    supportsPush: capabilities.supportsPush === true,
    browserName: String(capabilities.browserName || 'Unknown').slice(0, 40),
    osName: String(capabilities.osName || 'Unknown').slice(0, 40)
  }
}

export function getPlatformDiscoveryRecommendations({ capabilities } = {}) {
  return platformRecommendation(capabilities)
}

export async function saveClientCapabilities({ uid, capabilities } = {}) {
  const cleanUid = String(uid || '').trim()
  if (!db || !cleanUid) return false
  const sessionId = getDiscoverySessionId()
  await setDoc(doc(db, 'users', cleanUid, 'clientCapabilities', sessionId), {
    uid: cleanUid,
    sessionId,
    ...publicCapabilitySnapshot(capabilities),
    updatedAt: serverTimestamp()
  }, { merge: true })
  return true
}

export async function searchUsersByUsername(query = '') {
  const rows = await searchProfilesByUsername(query)
  return rows.map((profile) => ({
    ...profile,
    photoURL: profile.avatarURL || profile.photoURL || '',
    roleLabel: profile.roleLabel || 'Melogic member',
    reasonCodes: ['username_search'],
    reasonLabels: ['Username search'],
    score: 0,
    alreadyFollowing: false,
    canMessage: true
  }))
}

export async function getMutualUserSuggestions({ limit = 18 } = {}) {
  const callable = httpsCallable(functions, 'getMutualUserSuggestions')
  const result = await callable({ limit })
  return result?.data || { ok: false, suggestions: [] }
}

export async function dismissSuggestion(suggestedUid = '') {
  const callable = httpsCallable(functions, 'dismissMutualUserSuggestion')
  const result = await callable({ suggestedUid: String(suggestedUid || '').trim() })
  return result?.data || { ok: false }
}

export async function matchContacts({ contacts = [], source = 'manual' } = {}) {
  const callable = httpsCallable(functions, 'matchContactsToUsers')
  const result = await callable({
    contacts: Array.isArray(contacts) ? contacts.slice(0, 100) : [],
    source: String(source || 'manual').slice(0, 30)
  })
  return result?.data || { ok: false, matches: [], matchingEnabled: false }
}

export async function getMutualFollowerSuggestions() {
  const result = await getMutualUserSuggestions()
  return result.suggestions || []
}

export async function getSameCommunitySuggestions() {
  const result = await getMutualUserSuggestions()
  return (result.suggestions || []).filter((item) => item.reasonCodes?.includes('same_community'))
}

export async function getTagBasedSuggestions() {
  return []
}

export async function getInteractionBasedSuggestions() {
  return []
}
