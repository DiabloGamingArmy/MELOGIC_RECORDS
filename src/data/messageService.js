import {
  addDoc,
  collection,
  deleteDoc,
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

function normalizeParticipant(participantId, raw = {}) {
  return {
    id: participantId,
    uid: raw.uid || participantId,
    role: raw.role || 'member',
    displayName: String(raw.displayName || '').trim(),
    username: String(raw.username || '').trim(),
    avatarURL: String(raw.avatarURL || '').trim(),
    photoURL: String(raw.photoURL || '').trim(),
    lastReadAt: toIsoDate(raw.lastReadAt),
    lastDeliveredAt: toIsoDate(raw.lastDeliveredAt),
    joinedAt: toIsoDate(raw.joinedAt)
  }
}

function normalizeTypingState(typingId, raw = {}) {
  return {
    id: typingId,
    uid: raw.uid || typingId,
    displayName: String(raw.displayName || '').trim(),
    username: String(raw.username || '').trim(),
    updatedAt: toIsoDate(raw.updatedAt)
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

    transaction.set(participantRef, {
      uid: payload.senderId,
      lastDeliveredAt: serverTimestamp(),
      lastReadAt: serverTimestamp()
    }, { merge: true })
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
    setDoc(doc(db, 'threads', threadId, 'participants', uid), {
      uid,
      lastDeliveredAt: serverTimestamp(),
      lastReadAt: serverTimestamp()
    }, { merge: true }),
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

export async function markThreadDelivered({ threadId, uid }) {
  if (!db || !threadId || !uid) return false
  await setDoc(doc(db, 'threads', threadId, 'participants', uid), {
    uid,
    lastDeliveredAt: serverTimestamp()
  }, { merge: true })
  return true
}

export function subscribeToThreadParticipants(threadId, callback) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}
  return onSnapshot(collection(db, 'threads', threadId, 'participants'), (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizeParticipant(docSnap.id, docSnap.data())))
  })
}

export function subscribeToTypingState(threadId, callback) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}
  return onSnapshot(collection(db, 'threads', threadId, 'typing'), (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizeTypingState(docSnap.id, docSnap.data())))
  })
}

export async function setTypingState({ threadId, uid, displayName = '', username = '', isTyping }) {
  if (!db || !threadId || !uid) return false
  const typingRef = doc(db, 'threads', threadId, 'typing', uid)
  if (isTyping) {
    await setDoc(typingRef, {
      uid,
      displayName: String(displayName || '').trim(),
      username: String(username || '').trim(),
      updatedAt: serverTimestamp()
    }, { merge: true })
    return true
  }

  await deleteDoc(typingRef)
  return true
}
