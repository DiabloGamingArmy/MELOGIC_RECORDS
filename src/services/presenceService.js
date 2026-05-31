import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { auth, subscribeToIdToken, waitForInitialAuthState } from '../firebase/auth'
import { db } from '../firebase/firestore'

const ACTIVE_WINDOW_MS = 2 * 60 * 1000
const HEARTBEAT_MS = 45 * 1000

let started = false
let heartbeatTimer = null
let unsubscribeToken = null
let latestClaims = {}

function cleanString(value = '', max = 240) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeList(value = []) {
  return Array.isArray(value)
    ? value.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 20)
    : []
}

function userAgentSummary() {
  const ua = String(navigator.userAgent || '')
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return 'mobile'
  if (/Firefox/i.test(ua)) return 'firefox'
  if (/Edg/i.test(ua)) return 'edge'
  if (/Chrome/i.test(ua)) return 'chrome'
  if (/Safari/i.test(ua)) return 'safari'
  return 'browser'
}

async function loadProfileContext(uid) {
  try {
    const [profileSnap, userSnap] = await Promise.all([
      getDoc(doc(db, 'profiles', uid)),
      getDoc(doc(db, 'users', uid))
    ])
    const profile = profileSnap.exists() ? profileSnap.data() || {} : {}
    const account = userSnap.exists() ? userSnap.data() || {} : {}
    return { profile, account }
  } catch (error) {
    if (import.meta.env?.DEV) console.warn('[presence] profile context failed', error?.code || error?.message || error)
    return { profile: {}, account: {} }
  }
}

async function writePresence(user, { hidden = false } = {}) {
  if (!user?.uid || !db) return
  const { profile, account } = await loadProfileContext(user.uid)
  const roles = normalizeList(account.roles || profile.roles)
  const badges = normalizeList(profile.badges)
  const adminRole = cleanString(latestClaims.adminRole || '', 80)
  const isAdmin = latestClaims.admin === true
  const isModerator = roles.includes('moderator') || latestClaims.userModerate === true
  const staffVisible = isAdmin || isModerator || roles.includes('founder') || roles.includes('staff')
  const now = Date.now()
  const activeUntil = Timestamp.fromMillis(now + (hidden ? 30 * 1000 : ACTIVE_WINDOW_MS))

  await setDoc(doc(db, 'presence', user.uid), {
    uid: user.uid,
    displayName: cleanString(profile.displayName || account.displayName || user.displayName || 'User', 180),
    username: cleanString(profile.username || account.username || '', 120),
    photoURL: cleanString(profile.photoURL || profile.avatarURL || account.photoURL || user.photoURL || '', 900),
    avatarURL: cleanString(profile.avatarURL || profile.photoURL || account.photoURL || user.photoURL || '', 900),
    roles,
    badges,
    adminRole,
    isAdmin,
    isModerator,
    staffVisible,
    lastSeenAt: serverTimestamp(),
    activeUntil,
    path: cleanString(window.location.pathname || '/', 240),
    pageTitle: cleanString(document.title || '', 180),
    userAgentSummary: userAgentSummary(),
    updatedAt: serverTimestamp()
  }, { merge: true })
}

function clearHeartbeat() {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function scheduleHeartbeat(user) {
  clearHeartbeat()
  if (!user?.uid) return
  writePresence(user).catch((error) => {
    if (import.meta.env?.DEV) console.warn('[presence] write failed', error?.code || error?.message || error)
  })
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      writePresence(auth.currentUser).catch((error) => {
        if (import.meta.env?.DEV) console.warn('[presence] heartbeat failed', error?.code || error?.message || error)
      })
    }
  }, HEARTBEAT_MS)
}

export function startPresenceTracking() {
  if (started) return
  started = true
  unsubscribeToken = subscribeToIdToken(async (user) => {
    clearHeartbeat()
    if (!user?.uid) return
    try {
      latestClaims = (await user.getIdTokenResult()).claims || {}
    } catch {
      latestClaims = {}
    }
    scheduleHeartbeat(user)
  })
  waitForInitialAuthState().then((user) => {
    if (user?.uid) scheduleHeartbeat(user)
  }).catch(() => {})

  document.addEventListener('visibilitychange', () => {
    if (!auth.currentUser?.uid) return
    writePresence(auth.currentUser, { hidden: document.visibilityState !== 'visible' }).catch(() => {})
  }, { passive: true })
  window.addEventListener('pagehide', () => {
    if (!auth.currentUser?.uid) return
    writePresence(auth.currentUser, { hidden: true }).catch(() => {})
  }, { passive: true })
}

export function stopPresenceTracking() {
  clearHeartbeat()
  unsubscribeToken?.()
  unsubscribeToken = null
  started = false
}
