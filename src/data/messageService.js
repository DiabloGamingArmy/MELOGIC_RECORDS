import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeMessage(messageId, raw = {}) {
  return {
    id: messageId,
    senderId: raw.senderId || '',
    body: raw.body || '',
    type: raw.type || 'text',
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt)
  }
}

export async function listMessages(threadId) {
  if (!db || !threadId) return []

  let snapshot
  try {
    snapshot = await getDocs(query(collection(db, 'threads', threadId, 'messages'), orderBy('createdAt', 'asc'), limit(100)))
  } catch {
    snapshot = await getDocs(query(collection(db, 'threads', threadId, 'messages'), limit(100)))
  }

  return snapshot.docs
    .map((messageDoc) => normalizeMessage(messageDoc.id, messageDoc.data()))
    .sort((a, b) => (a.createdAt || '') > (b.createdAt || '') ? 1 : -1)
}

export async function sendMessage(threadId, payload = {}) {
  if (!db || !threadId || !payload.senderId || !String(payload.body || '').trim()) {
    throw new Error('sendMessage requires threadId, senderId, and non-empty body.')
  }

  const body = String(payload.body).trim()
  const messageDoc = await addDoc(collection(db, 'threads', threadId, 'messages'), {
    senderId: payload.senderId,
    body,
    type: payload.type || 'text',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  await updateDoc(doc(db, 'threads', threadId), {
    updatedAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessageText: body,
    lastMessageSenderId: payload.senderId
  })

  return {
    id: messageDoc.id,
    senderId: payload.senderId,
    body,
    type: payload.type || 'text',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}
