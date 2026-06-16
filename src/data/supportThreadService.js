import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

function callable(name, payload = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  return httpsCallable(functions, name)(payload)
    .then((response) => response?.data || {})
    .catch((error) => {
      console.error(`[support] ${name} failed`, {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      throw error
    })
}

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function normalizeSupportThread(threadId, raw = {}) {
  return {
    id: String(raw.id || threadId || '').trim(),
    type: 'support',
    requesterUid: String(raw.requesterUid || '').trim(),
    participantUids: Array.isArray(raw.participantUids) ? raw.participantUids.map((uid) => String(uid || '').trim()).filter(Boolean) : [],
    assignedAgentUid: String(raw.assignedAgentUid || '').trim(),
    status: String(raw.status || 'open').trim() || 'open',
    source: String(raw.source || 'support').trim(),
    subject: String(raw.subject || 'Support request').trim(),
    priority: String(raw.priority || 'normal').trim(),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    lastMessageAt: toIsoDate(raw.lastMessageAt),
    lastMessagePreview: String(raw.lastMessagePreview || '').trim(),
    resolvedAt: toIsoDate(raw.resolvedAt),
    resolvedBy: String(raw.resolvedBy || '').trim(),
    humanRequested: raw.humanRequested === true,
    aiRoutedToAgent: raw.aiRoutedToAgent === true,
    aiEscalationReason: String(raw.aiEscalationReason || '').trim(),
    aiSuggestedCategory: String(raw.aiSuggestedCategory || '').trim(),
    typing: normalizeSupportTyping(raw.typing),
    requester: raw.requester && typeof raw.requester === 'object' ? raw.requester : null,
    assignedAgent: raw.assignedAgent && typeof raw.assignedAgent === 'object' ? raw.assignedAgent : null
  }
}

function normalizeSupportTyping(raw = {}) {
  const typing = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const ai = typing.ai && typeof typing.ai === 'object' && !Array.isArray(typing.ai) ? typing.ai : {}
  return {
    ai: {
      active: ai.active === true,
      label: String(ai.label || '').trim(),
      startedAt: toIsoDate(ai.startedAt),
      expiresAt: toIsoDate(ai.expiresAt),
      clearedAt: toIsoDate(ai.clearedAt)
    }
  }
}

export function normalizeSupportMessage(messageId, raw = {}, metadata = {}) {
  return {
    id: String(raw.id || messageId || '').trim(),
    senderUid: String(raw.senderUid || '').trim(),
    senderType: ['user', 'agent', 'system', 'ai', 'system_ai'].includes(raw.senderType) ? raw.senderType : 'system',
    body: String(raw.body || '').trim(),
    createdAt: toIsoDate(raw.createdAt),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    pendingWrites: metadata.hasPendingWrites === true
  }
}

export async function createSupportThread(payload = {}) {
  const result = await callable('createSupportThread', {
    source: String(payload.source || 'support').trim(),
    subject: String(payload.subject || 'Support request').trim(),
    priority: String(payload.priority || 'normal').trim(),
    initialMessage: String(payload.initialMessage || '').trim()
  })
  return {
    ...result,
    thread: result.thread ? normalizeSupportThread(result.thread.id || result.threadId, result.thread) : null
  }
}

export function sendSupportMessage({ threadId = '', body = '', safePageContext = null, asAgent = false } = {}) {
  return callable('sendSupportMessage', {
    threadId: String(threadId || '').trim(),
    body: String(body || '').trim(),
    asAgent: asAgent === true,
    safePageContext: safePageContext && typeof safePageContext === 'object' ? {
      guidanceSessionActive: safePageContext.guidanceSessionActive === true,
      guidanceSessionStatus: String(safePageContext.guidanceSessionStatus || '').trim().slice(0, 40),
      route: String(safePageContext.route || safePageContext.currentRoute || '').trim().slice(0, 200),
      currentRoute: String(safePageContext.currentRoute || safePageContext.route || '').trim().slice(0, 240),
      routeLabel: String(safePageContext.routeLabel || '').trim().slice(0, 120),
      pageTitle: String(safePageContext.pageTitle || '').trim().slice(0, 200),
      featureArea: String(safePageContext.featureArea || '').trim().slice(0, 120),
      activeModal: String(safePageContext.activeModal || '').trim().slice(0, 120),
      viewport: safePageContext.viewport && typeof safePageContext.viewport === 'object' ? safePageContext.viewport : {},
      scroll: safePageContext.scroll && typeof safePageContext.scroll === 'object' ? safePageContext.scroll : {},
      landmarks: Array.isArray(safePageContext.landmarks) ? safePageContext.landmarks.slice(0, 24) : [],
      productId: String(safePageContext.productId || '').trim().slice(0, 180),
      productTitle: String(safePageContext.productTitle || '').trim().slice(0, 200)
    } : {}
  })
}

export function requestSupportAgent({ threadId = '' } = {}) {
  return callable('requestSupportAgent', { threadId: String(threadId || '').trim() })
}

export function claimSupportThread({ threadId = '' } = {}) {
  return callable('claimSupportThread', { threadId: String(threadId || '').trim() })
}

export function resolveSupportThread({ threadId = '' } = {}) {
  return callable('resolveSupportThread', { threadId: String(threadId || '').trim() })
}

export function endSupportThread({ threadId = '' } = {}) {
  return callable('endSupportThread', { threadId: String(threadId || '').trim() })
}

export async function listSupportThreads(payload = {}) {
  const result = await callable('listSupportThreads', {
    status: String(payload.status || 'active').trim(),
    limitCount: Number(payload.limitCount || 50)
  })
  return {
    ...result,
    threads: (result.threads || []).map((thread) => normalizeSupportThread(thread.id, thread))
  }
}

export async function listSupportMessages({ threadId = '' } = {}) {
  const result = await callable('listSupportMessages', { threadId: String(threadId || '').trim() })
  return (result.messages || []).map((message) => normalizeSupportMessage(message.id, message))
}

export function subscribeToSupportThread(threadId = '', callback, onError) {
  if (!db || !threadId) return () => {}
  return onSnapshot(doc(db, 'supportThreads', threadId), (snap) => {
    callback(snap.exists() ? normalizeSupportThread(snap.id, snap.data()) : null)
  }, onError)
}

export function subscribeToSupportMessages(threadId = '', callback, onError) {
  if (!db || !threadId) return () => {}
  const messagesQuery = query(
    collection(db, 'supportThreads', threadId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(100)
  )
  return onSnapshot(messagesQuery, (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizeSupportMessage(docSnap.id, docSnap.data(), docSnap.metadata)))
  }, onError)
}

export async function getSupportMessages(threadId = '') {
  if (!db || !threadId) return []
  const snapshot = await getDocs(query(
    collection(db, 'supportThreads', threadId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(100)
  ))
  return snapshot.docs.map((docSnap) => normalizeSupportMessage(docSnap.id, docSnap.data(), docSnap.metadata))
}
