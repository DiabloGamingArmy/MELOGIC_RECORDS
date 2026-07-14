import { get, onDisconnect, onValue, ref, remove, set } from 'firebase/database'
import { realtimeDatabase } from '../../firebase/realtimeDatabase'

function cleanId(value = '', fallback = '') {
  const clean = String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  return clean || fallback
}

function nowMs() {
  return Date.now()
}

export function nativeViewerSessionId(streamId = '') {
  const storageKey = `melogicNativeViewer:${cleanId(streamId, 'stream')}`
  try {
    const existing = window.sessionStorage.getItem(storageKey)
    if (existing) return cleanId(existing, existing)
    const created = `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    window.sessionStorage.setItem(storageKey, created)
    return created
  } catch {
    return `viewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
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
  await set(pathRef, payload)
  await onDisconnect(pathRef).remove()
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
  return onValue(ref(realtimeDatabase, `livePresence/${cleanStreamId}/playbackDemand`), (snapshot) => {
    const value = snapshot.val() || {}
    const sessions = Object.entries(value).map(([id, row]) => ({ viewerSessionId: id, ...(row || {}) }))
    onNext({ count: sessions.length, sessions })
  }, () => onNext({ count: 0, sessions: [] }))
}

export async function getPlaybackDemandCount(streamId = '') {
  const cleanStreamId = cleanId(streamId)
  if (!realtimeDatabase || !cleanStreamId) return 0
  const snapshot = await get(ref(realtimeDatabase, `livePresence/${cleanStreamId}/playbackDemand`)).catch(() => null)
  return snapshot?.exists?.() ? Object.keys(snapshot.val() || {}).length : 0
}

export async function writeNativeHostPresence({ streamId = '', uid = '', state = 'online', broadcasting = false } = {}) {
  const cleanStreamId = cleanId(streamId)
  const cleanUid = cleanId(uid)
  if (!realtimeDatabase || !cleanStreamId || !cleanUid) return { ok: false }
  const pathRef = ref(realtimeDatabase, `livePresence/${cleanStreamId}/host`)
  await set(pathRef, {
    uid: cleanUid,
    state: state === 'offline' ? 'offline' : 'online',
    lastSeenAt: nowMs(),
    broadcasting: Boolean(broadcasting)
  })
  await onDisconnect(pathRef).set({
    uid: cleanUid,
    state: 'offline',
    lastSeenAt: nowMs(),
    broadcasting: false
  })
  return { ok: true }
}
