import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAt, endAt, where } from 'firebase/firestore'
import { doc as liteDoc, getDoc as liteGetDoc, getFirestore as getLiteFirestore } from 'firebase/firestore/lite'
import { app } from '../firebase/firebaseConfig.js'
import { db } from '../firebase/firestore'

// melogic-shared-public-identity-cache-v1
const sharedPublicIdentityCache = new Map()

export function getCachedPublicProfileIdentityByUid(uid = '') {
  const cleanUid = String(uid || '').trim()
  return cleanUid ? (sharedPublicIdentityCache.get(cleanUid) || null) : null
}

function publishPublicProfileIdentity(uid = '', identity = null) {
  const cleanUid = String(uid || '').trim()
  if (!cleanUid || !identity) return identity
  sharedPublicIdentityCache.set(cleanUid, identity)
  try {
    globalThis.dispatchEvent?.(new CustomEvent('melogic:public-profile-identity', {
      detail: { uid: cleanUid, identity }
    }))
  } catch {}
  return identity
}

function normalizeProfile(profileDoc) {
  const raw = profileDoc.data() || {}
  return {
    uid: raw.uid || profileDoc.id,
    displayName: String(raw.displayName || '').trim(),
    username: String(raw.username || '').trim(),
    usernameLower: String(raw.usernameLower || raw.username || '').trim().toLowerCase(),
    avatarURL: String(raw.avatarURL || '').trim(),
    photoURL: String(raw.photoURL || '').trim(),
    roleLabel: String(raw.roleLabel || 'Melogic member').trim(),
    location: String(raw.location || '').trim(),
    badges: Array.isArray(raw.badges) ? Array.from(new Set(raw.badges.map((value) => String(value || '').toLowerCase().trim()).filter(Boolean))) : []
  }
}

export async function searchProfilesByUsername(input = '') {
  if (!db) return []
  const normalized = String(input || '').trim().toLowerCase()
  if (normalized.length < 2) return []

  const profileQuery = query(
    collection(db, 'profiles'),
    orderBy('usernameLower'),
    startAt(normalized),
    endAt(`${normalized}\uf8ff`),
    limit(10)
  )

  try {
    const snapshot = await getDocs(profileQuery)
    return snapshot.docs.map(normalizeProfile)
  } catch (error) {
    console.warn('[profileSearchService] Prefix profile search failed. Trying exact username lookup.', error?.code || error?.message || error)
    if (!/^[a-z0-9_-]{3,30}$/.test(normalized)) {
      const lookupError = new Error('Unable to search users right now.')
      lookupError.code = 'profile-search/unavailable'
      throw lookupError
    }

    try {
      const claimSnap = await getDoc(doc(db, 'usernameClaims', normalized))
      const uid = claimSnap.exists() ? claimSnap.data()?.uid : ''
      if (!uid) return []
      const profileSnap = await getDoc(doc(db, 'profiles', uid))
      if (!profileSnap.exists()) return []
      return [normalizeProfile(profileSnap)]
    } catch (fallbackError) {
      console.warn('[profileSearchService] Exact username lookup failed.', fallbackError?.code || fallbackError?.message || fallbackError)
      const lookupError = new Error('Unable to search users right now.')
      lookupError.code = 'profile-search/unavailable'
      throw lookupError
    }
  }
}

// melogic-streaming-legacy-artist-identity-v2
export async function getPublicProfileIdentityByArtistName(name = '') {
  const cleanName = String(name || '').trim()
  if (!db || !cleanName) return null
  try {
    const [displayNameSnap, artistNameSnap] = await Promise.all([
      getDocs(query(collection(db, 'profiles'), where('displayName', '==', cleanName), limit(2))),
      getDocs(query(collection(db, 'profiles'), where('artistName', '==', cleanName), limit(2)))
    ])
    const matches = new Map()
    ;[...displayNameSnap.docs, ...artistNameSnap.docs].forEach((snap) => matches.set(snap.id, snap))
    if (matches.size !== 1) return null
    return normalizeProfile([...matches.values()][0])
  } catch (error) {
    console.warn('[profileSearchService] Legacy artist identity lookup failed.', error?.code || error?.message || error)
    return null
  }
}

// melogic-community-verified-badge-v1
// melogic-identity-lifecycle-trace-v1
function tracePublicIdentity(stage, detail = {}) {
  try {
    const root = globalThis
    const trace = Array.isArray(root.__MELOGIC_IDENTITY_TRACE__) ? root.__MELOGIC_IDENTITY_TRACE__ : []
    trace.push({ at: new Date().toISOString(), ms: Math.round(performance?.now?.() || 0), source: 'profileSearchService', stage, ...detail })
    if (trace.length > 200) trace.splice(0, trace.length - 200)
    root.__MELOGIC_IDENTITY_TRACE__ = trace
  } catch {}
}

// melogic-profile-identity-lite-fallback-v1
let publicIdentityLiteDb = null

function getPublicIdentityLiteDb() {
  if (!publicIdentityLiteDb) publicIdentityLiteDb = getLiteFirestore(app)
  return publicIdentityLiteDb
}

// melogic-cancellable-profile-timeout-v1
function publicIdentityTimeout(ms, uid = '') {
  let timer = 0
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      tracePublicIdentity('primary-timeout-fired', { uid, timeoutMs: ms })
      const error = new Error(`Public profile identity read timed out after ${ms}ms.`)
      error.code = 'profile-identity/primary-timeout'
      reject(error)
    }, ms)
  })
  return { promise, cancel: () => { if (timer) clearTimeout(timer) } }
}

export async function getPublicProfileIdentityByUid(uid = '') {
  const cleanUid = String(uid || '').trim()
  tracePublicIdentity('identity-call', { uid: cleanUid, hasDb: Boolean(db) })
  if (!db || !cleanUid) {
    tracePublicIdentity('identity-short-circuit', { uid: cleanUid, hasDb: Boolean(db) })
    return null
  }
  try {
    tracePublicIdentity('primary-getdoc-start', { uid: cleanUid })
    const primaryTimeout = publicIdentityTimeout(2500, cleanUid)
    const snap = await Promise.race([
      getDoc(doc(db, 'profiles', cleanUid)).then((value) => {
        tracePublicIdentity('primary-getdoc-settled', { uid: cleanUid, exists: value.exists() })
        return value
      }, (error) => {
        tracePublicIdentity('primary-getdoc-rejected', { uid: cleanUid, code: String(error?.code || ''), message: String(error?.message || error || '') })
        throw error
      }),
      primaryTimeout.promise
    ])
    primaryTimeout.cancel()
    const result = snap.exists() ? normalizeProfile(snap) : null
    tracePublicIdentity('identity-return-primary', { uid: cleanUid, found: Boolean(result), badges: result?.badges || [] })
    return result ? publishPublicProfileIdentity(cleanUid, result) : null
  } catch (primaryError) {
    tracePublicIdentity('primary-catch', { uid: cleanUid, code: String(primaryError?.code || ''), message: String(primaryError?.message || primaryError || '') })
    console.warn('[profileSearchService] Primary public identity read unavailable; trying Firestore Lite.', primaryError?.code || primaryError?.message || primaryError)
    try {
      tracePublicIdentity('lite-start', { uid: cleanUid })
      const liteDb = getPublicIdentityLiteDb()
      const liteSnap = await liteGetDoc(liteDoc(liteDb, 'profiles', cleanUid))
      tracePublicIdentity('lite-settled', { uid: cleanUid, exists: liteSnap.exists() })
      const result = liteSnap.exists() ? normalizeProfile(liteSnap) : null
      tracePublicIdentity('identity-return-lite', { uid: cleanUid, found: Boolean(result), badges: result?.badges || [] })
      return result ? publishPublicProfileIdentity(cleanUid, result) : null
    } catch (fallbackError) {
      tracePublicIdentity('lite-error', { uid: cleanUid, code: String(fallbackError?.code || ''), message: String(fallbackError?.message || fallbackError || '') })
      console.warn('[profileSearchService] Firestore Lite public identity fallback failed.', fallbackError?.code || fallbackError?.message || fallbackError)
      tracePublicIdentity('identity-return-null', { uid: cleanUid })
      return null
    }
  }
}