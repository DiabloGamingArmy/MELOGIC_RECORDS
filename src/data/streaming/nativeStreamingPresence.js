import { get, onDisconnect, onValue, ref, remove, set } from 'firebase/database'
import { realtimeDatabase } from '../../firebase/realtimeDatabase'

const runtimeViewerSessions = new Map()

function cleanId(value = '', fallback = '') {
  const clean = String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  return clean || fallback
}

function nowMs() {
  return Date.now()
}

export function nativeViewerSessionId(streamId = '') {
  const cleanStreamId = cleanId(streamId, 'stream')
  if (runtimeViewerSessions.has(cleanStreamId)) return runtimeViewerSessions.get(cleanStreamId)
  const storageKey = `melogicNativeViewer:${cleanId(streamId, 'stream')}`
  try {
    const created = `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
    window.sessionStorage.setItem(storageKey, created)
    runtimeViewerSessions.set(cleanStreamId, created)
    return created
  } catch {
    const created = `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
    runtimeViewerSessions.set(cleanStreamId, created)
    return created
  }
}

export function nativeHostSessionId(streamId = '') {
  const cleanStreamId = cleanId(streamId, 'stream')
  const storageKey = `melogicNativeHost:${cleanStreamId}`
  try {
    const existing = window.sessionStorage.getItem(storageKey)
    if (existing) return existing
    const created = `host_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
    window.sessionStorage.setItem(storageKey, created)
    return created
  } catch {
    return `host_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
  }
}

export async function writePlaybackDemand({ streamId = '', viewerSessionId = '', uid = null, state = 'buffering', tabId = '', userAgentHash = '' } = {}) {
  const cleanStreamId = cleanId(streamId)
  const cleanSessionId = cleanId(viewerSessionId || nativeViewerSessionId(streamId))
  if (!realtimeDatabase || !cleanStreamId || !cleanSessionId) return { ok: false }
  const pathRef = ref(realtimeDatabase, `livePresence/${cleanStreamId}/playbackDemand/${cleanSessionId}`)
  const payload = {
    uid: uid || null,
    state: ['buffering', 'listening', 'paused'].includes(state) ? state : 'buffering',
    joinedAt: nowMs(),
    lastSeenAt: nowMs(),
    tabId: cleanId(tabId, cleanSessionId),
    ...(userAgentHash ? { userAgentHash: String(userAgentHash).slice(0, 160) } : {})
  }
  await onDisconnect(pathRef).remove()
  await set(pathRef, payload)
  return { ok: true, streamId: cleanStreamId, viewerSessionId: cleanSessionId }
}

export async function updatePlaybackDemandState({ streamId = '', viewerSessionId = '', uid = null, state = 'listening', tabId = '' } = {}) {
  return writePlaybackDemand({ streamId, viewerSessionId, uid, state, tabId })
}

export async function clearPlaybackDemand(streamId = '', viewerSessionId = '') {
  const cleanStreamId = cleanId(streamId)
  const cleanSessionId = cleanId(viewerSessionId)
  if (!realtimeDatabase || !cleanStreamId || !cleanSessionId) return { ok: false }
  await remove(ref(realtimeDatabase, `livePresence/${cleanStreamId}/playbackDemand/${cleanSessionId}`))
  return { ok: true }
}

export function observePlaybackDemand(streamId = '', onNext = () => {}) {
  const cleanStreamId = cleanId(streamId)
  if (!realtimeDatabase || !cleanStreamId) return () => {}
  const path = `livePresence/${cleanStreamId}/playbackDemand`
  return onValue(ref(realtimeDatabase, path), (snapshot) => {
    const value = snapshot.val() || {}
    const sessions = Object.entries(value).map(([id, row]) => ({ viewerSessionId: id, ...(row || {}) }))
    const activeSessions = sessions.filter((session) => session.state === 'buffering' || session.state === 'listening')
    onNext({ count: activeSessions.length, sessions, activeSessions, path })
  }, (error) => onNext({ count: 0, sessions: [], activeSessions: [], path, error: error?.message || 'RTDB playback demand read failed' }))
}

export async function getPlaybackDemandCount(streamId = '') {
  const cleanStreamId = cleanId(streamId)
  if (!realtimeDatabase || !cleanStreamId) return 0
  const snapshot = await get(ref(realtimeDatabase, `livePresence/${cleanStreamId}/playbackDemand`)).catch(() => null)
  if (!snapshot?.exists?.()) return 0
  return Object.values(snapshot.val() || {}).filter((row) => row?.state === 'buffering' || row?.state === 'listening').length
}

export async function writeNativeHostPresence({ streamId = '', uid = '', state = 'online', broadcasting = false, hostSessionId = '' } = {}) {
  const cleanStreamId = cleanId(streamId)
  const cleanUid = cleanId(uid)
  if (!realtimeDatabase || !cleanStreamId || !cleanUid) return { ok: false }
  const pathRef = ref(realtimeDatabase, `livePresence/${cleanStreamId}/host`)
  const payload = {
    uid: cleanUid,
    hostSessionId: cleanId(hostSessionId, nativeHostSessionId(streamId)),
    state: state === 'offline' ? 'offline' : 'online',
    lastSeenAt: nowMs(),
    broadcasting: Boolean(broadcasting)
  }
  await onDisconnect(pathRef).set({
    uid: cleanUid,
    hostSessionId: payload.hostSessionId,
    state: 'offline',
    lastSeenAt: nowMs(),
    broadcasting: false
  })
  await set(pathRef, payload)
  return { ok: true, hostSessionId: payload.hostSessionId }
}

export function observeNativeHostPresence(streamId = '', onNext = () => {}) {
  const cleanStreamId = cleanId(streamId)
  if (!realtimeDatabase || !cleanStreamId) return () => {}
  return onValue(ref(realtimeDatabase, `livePresence/${cleanStreamId}/host`), (snapshot) => {
    onNext(snapshot.val() || null)
  }, () => onNext(null))
}

export async function getNativeHostPresence(streamId = '') {
  const cleanStreamId = cleanId(streamId)
  if (!realtimeDatabase || !cleanStreamId) return null
  const snapshot = await get(ref(realtimeDatabase, `livePresence/${cleanStreamId}/host`)).catch(() => null)
  return snapshot?.exists?.() ? snapshot.val() || null : null
}
