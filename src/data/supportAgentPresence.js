import { onDisconnect, ref, set } from 'firebase/database'
import { realtimeDatabase } from '../firebase/realtimeDatabase'

function cleanId(value = '') {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180)
}

function presenceRef(threadId = '') {
  const id = cleanId(threadId)
  return id && realtimeDatabase ? ref(realtimeDatabase, `supportAgentSessions/${id}`) : null
}

export async function connectSupportAgentPresence({ threadId = '', requesterUid = '', agentUid = '', agentFirstName = 'Support' } = {}) {
  const pathRef = presenceRef(threadId)
  if (!pathRef || !agentUid) return { ok: false }
  const base = {
    threadId: cleanId(threadId),
    requesterUid: cleanId(requesterUid),
    agentUid: cleanId(agentUid),
    agentFirstName: String(agentFirstName || 'Support').replace(/[^A-Za-z]/g, '').slice(0, 50) || 'Support'
  }
  await onDisconnect(pathRef).set({
    ...base,
    active: false,
    endedAt: Date.now(),
    reason: 'connection_closed'
  })
  await set(pathRef, {
    ...base,
    active: true,
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
    reason: 'connected'
  })
  return { ok: true }
}

export async function endSupportAgentPresence({ threadId = '', requesterUid = '', agentUid = '', agentFirstName = 'Support', reason = 'manual_disconnect' } = {}) {
  const pathRef = presenceRef(threadId)
  if (!pathRef || !agentUid) return { ok: false }
  await set(pathRef, {
    threadId: cleanId(threadId),
    requesterUid: cleanId(requesterUid),
    agentUid: cleanId(agentUid),
    agentFirstName: String(agentFirstName || 'Support').replace(/[^A-Za-z]/g, '').slice(0, 50) || 'Support',
    active: false,
    endedAt: Date.now(),
    reason: String(reason || 'manual_disconnect').slice(0, 80)
  })
  return { ok: true }
}
