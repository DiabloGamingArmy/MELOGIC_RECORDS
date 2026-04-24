import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore'
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
    updatedAt: toIsoDate(raw.updatedAt),
    deleted: Boolean(raw.deleted)
  }
}

function getMessagesQuery(threadId) {
  return query(collection(db, 'threads', threadId, 'messages'), orderBy('createdAt', 'asc'), limit(300))
}

export async function listMessages(threadId) {
  if (!db || !threadId) return []

  let snapshot
  try {
    snapshot = await getDocs(getMessagesQuery(threadId))
  } catch {
    snapshot = await getDocs(query(collection(db, 'threads', threadId, 'messages'), limit(300)))
  }

  return snapshot.docs
    .map((messageDoc) => normalizeMessage(messageDoc.id, messageDoc.data()))
    .sort((a, b) => (a.createdAt || '') > (b.createdAt || '') ? 1 : -1)
}

export function subscribeToMessages(threadId, callback) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}

  try {
    return onSnapshot(getMessagesQuery(threadId), (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => normalizeMessage(docSnap.id, docSnap.data()))
      callback(messages)
    })
  } catch {
    return onSnapshot(query(collection(db, 'threads', threadId, 'messages'), limit(300)), (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => normalizeMessage(docSnap.id, docSnap.data()))
      callback(messages)
    })
  }
}

export async function sendMessage(threadId, payload = {}) {
  if (!db || !threadId || !payload.senderId || !String(payload.body || '').trim()) {
    throw new Error('sendMessage requires threadId, senderId, and non-empty body.')
  }

  const body = String(payload.body).trim()
  const threadRef = doc(db, 'threads', threadId)
  const participantRef = doc(db, 'threads', threadId, 'participants', payload.senderId)

  await runTransaction(db, async (transaction) => {
    const [threadSnap, participantSnap] = await Promise.all([transaction.get(threadRef), transaction.get(participantRef)])
    if (!threadSnap.exists()) throw new Error('Thread not found.')
    if (!participantSnap.exists()) throw new Error('Sender is not a participant in this thread.')

    const messageRef = doc(collection(db, 'threads', threadId, 'messages'))
    transaction.set(messageRef, {
      senderId: payload.senderId,
      body,
      type: payload.type || 'text',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deleted: false
    })

    transaction.update(threadRef, {
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: body,
      lastMessageSenderId: payload.senderId,
      lastMessageType: payload.type || 'text'
    })
  })

  await setDoc(
    doc(db, 'users', payload.senderId, 'inboxThreads', threadId),
    {
      threadId,
      lastMessageText: body,
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: payload.senderId,
      unreadCount: 0,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  )

  return true
}

export async function markThreadRead({ threadId, uid }) {
  if (!db || !threadId || !uid) return false

  const threadSnap = await getDoc(doc(db, 'threads', threadId))
  if (!threadSnap.exists()) return false

  await Promise.all([
    updateDoc(doc(db, 'threads', threadId, 'participants', uid), {
      lastReadAt: serverTimestamp()
    }),
    setDoc(
      doc(db, 'users', uid, 'inboxThreads', threadId),
      {
        unreadCount: 0,
        lastReadAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )
  ])

  return true
}
