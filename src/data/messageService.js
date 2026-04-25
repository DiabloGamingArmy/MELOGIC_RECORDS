import {
  addDoc,
  collection,
  writeBatch,
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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { storage } from '../firebase/storage'

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
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    deleted: Boolean(raw.deleted)
  }
}

function summarizeMessage(body, attachments = []) {
  if (String(body || '').trim()) return String(body || '').trim()
  if (!attachments.length) return 'Sent a message'
  if (attachments.length > 1) return 'Sent attachments'
  const [first] = attachments
  if (String(first?.mimeType || '').startsWith('image/')) return 'Sent an image'
  if (String(first?.mimeType || '').startsWith('video/')) return 'Sent a video'
  if (String(first?.mimeType || '').startsWith('audio/')) return 'Sent audio'
  return 'Sent a file'
}

async function uploadMessageAttachments(threadId, messageId, attachments = []) {
  if (!storage || !attachments.length) return []
  const uploads = await Promise.all(attachments.map(async (file, index) => {
    if (!(file instanceof File)) return null
    const safeName = `${Date.now()}-${index}-${String(file.name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const storagePath = `threads/${threadId}/messages/${messageId}/attachments/${safeName}`
    const storageRef = ref(storage, storagePath)
    await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' })
    const url = await getDownloadURL(storageRef)
    return {
      name: file.name || safeName,
      type: String(file.type || '').split('/')[0] || 'file',
      mimeType: file.type || 'application/octet-stream',
      size: Number(file.size || 0),
      storagePath,
      url
    }
  }))

  return uploads.filter(Boolean)
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

export function subscribeToMessages(threadId, callback, onError) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}

  try {
    return onSnapshot(getMessagesQuery(threadId), (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => normalizeMessage(docSnap.id, docSnap.data()))
      callback(messages)
    }, onError)
  } catch {
    return onSnapshot(query(collection(db, 'threads', threadId, 'messages'), limit(300)), (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => normalizeMessage(docSnap.id, docSnap.data()))
      callback(messages)
    }, onError)
  }
}

export async function sendMessage(threadId, payload = {}) {
  const body = String(payload.body || '').trim()
  const attachmentsInput = Array.isArray(payload.attachments) ? payload.attachments : []
  if (!db || !threadId || !payload.senderId || (!body && !attachmentsInput.length)) {
    throw new Error('sendMessage requires threadId, senderId, and message content.')
  }

  const threadRef = doc(db, 'threads', threadId)
  const participantRef = doc(db, 'threads', threadId, 'participants', payload.senderId)
  const messageRef = doc(collection(db, 'threads', threadId, 'messages'))

  const [threadSnap, participantSnap] = await Promise.all([getDoc(threadRef), getDoc(participantRef)])
  if (!threadSnap.exists()) throw new Error('Thread not found.')
  if (!participantSnap.exists()) throw new Error('Sender is not a participant in this thread.')

  const attachments = await uploadMessageAttachments(threadId, messageRef.id, attachmentsInput)
  const summary = summarizeMessage(body, attachments)
  const batch = writeBatch(db)
  batch.set(messageRef, {
      senderId: payload.senderId,
      body,
      type: payload.type || 'text',
      attachments,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deleted: false
    })
  batch.update(threadRef, {
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessageText: summary,
      lastMessageSenderId: payload.senderId,
      lastMessageType: payload.type || 'text'
    })
  batch.set(participantRef, {
      uid: payload.senderId,
      lastDeliveredAt: serverTimestamp(),
      lastReadAt: serverTimestamp()
    }, { merge: true })
  await batch.commit()

  await setDoc(
    doc(db, 'users', payload.senderId, 'inboxThreads', threadId),
    {
      threadId,
      lastMessageText: summary,
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

export function subscribeToThreadParticipants(threadId, callback, onError) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}
  return onSnapshot(collection(db, 'threads', threadId, 'participants'), (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizeParticipant(docSnap.id, docSnap.data())))
  }, onError)
}

export function subscribeToTypingState(threadId, callback, onError) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}
  return onSnapshot(collection(db, 'threads', threadId, 'typing'), (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizeTypingState(docSnap.id, docSnap.data())))
  }, onError)
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
