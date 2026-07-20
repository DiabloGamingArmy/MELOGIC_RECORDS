import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  endBefore,
  limit,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { storage } from '../firebase/storage'
import { getThreadParticipantUids } from './threadService'

const MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024
const MAX_ATTACHMENT_LABEL = '256 MB'
export const INITIAL_MESSAGE_LIMIT = 40
export const OLDER_MESSAGE_PAGE_SIZE = 25

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function validateAttachmentSize(file) {
  if (file instanceof File && Number(file.size || 0) > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment is too large. Maximum size is ${MAX_ATTACHMENT_LABEL}.`)
  }
}

function normalizeMessage(messageId, raw = {}, metadata = {}) {
  return {
    id: messageId,
    clientMessageId: String(raw.clientMessageId || '').trim(),
    senderId: raw.senderId || raw.senderUid || '',
    senderUid: raw.senderUid || raw.senderId || '',
    senderType: String(raw.senderType || '').trim() || (raw.senderId ? 'user' : 'system'),
    agentId: String(raw.agentId || '').trim(),
    senderDisplayName: String(raw.senderDisplayName || raw.senderFirstName || raw.metadata?.agentFirstName || '').trim(),
    senderFirstName: String(raw.senderFirstName || raw.metadata?.agentFirstName || '').trim(),
    avatarPath: String(raw.avatarPath || raw.metadata?.avatarPath || '').trim(),
    body: raw.body || '',
    type: raw.type || 'text',
    metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {},
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    deleted: Boolean(raw.deleted),
    deletedAt: toIsoDate(raw.deletedAt),
    deletedBy: raw.deletedBy || '',
    edited: Boolean(raw.edited),
    editedAt: toIsoDate(raw.editedAt),
    replyTo: raw.replyTo && typeof raw.replyTo === 'object' ? normalizeReplyTo(raw.replyTo) : null,
    pendingWrites: metadata.hasPendingWrites === true
  }
}

function normalizeReplyTo(raw = {}) {
  const messageId = String(raw.messageId || '').trim()
  const senderId = String(raw.senderId || '').trim()
  if (!messageId || !senderId) return null
  return {
    messageId,
    senderId,
    senderName: String(raw.senderName || '').trim(),
    bodyPreview: String(raw.bodyPreview || '').trim().slice(0, 240),
    attachmentSummary: String(raw.attachmentSummary || '').trim().slice(0, 80),
    type: String(raw.type || 'text').trim() || 'text',
    createdAt: toIsoDate(raw.createdAt)
  }
}

function getAttachmentKind(attachment = {}) {
  const mime = String(attachment?.mimeType || '')
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

export function summarizeMessage(body, attachments = []) {
  const text = String(body || '').trim()
  const items = Array.isArray(attachments) ? attachments : []
  if (text && !items.length) return text.slice(0, 140)
  if (text && items.length) return text.slice(0, 140) || 'Text + attachment'
  if (!items.length) return 'Sent a message'
  if (items.length === 1) {
    const kind = getAttachmentKind(items[0])
    if (kind === 'image') return '1 image'
    if (kind === 'video') return '1 video'
    if (kind === 'audio') return '1 audio'
    return '1 file'
  }
  const allImages = items.every((item) => getAttachmentKind(item) === 'image')
  if (allImages) return `${items.length} images`
  return `${items.length} attachments`
}

function normalizeReaction(reactionId, raw = {}) {
  return {
    id: reactionId,
    uid: raw.uid || '',
    emoji: raw.emoji || '',
    emojiKey: raw.emojiKey || '',
    threadId: raw.threadId || '',
    messageId: raw.messageId || '',
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt)
  }
}

function timestampToMillis(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

async function getImageDimensions(file) {
  if (!(file instanceof File) || !String(file.type || '').startsWith('image/') || typeof createImageBitmap !== 'function') {
    return { width: 0, height: 0 }
  }
  try {
    const bitmap = await createImageBitmap(file)
    const dimensions = { width: bitmap.width || 0, height: bitmap.height || 0 }
    bitmap.close?.()
    return dimensions
  } catch {
    return { width: 0, height: 0 }
  }
}

async function uploadMessageAttachments(threadId, messageId, attachments = []) {
  if (!storage || !attachments.length) return []
  const uploads = await Promise.all(attachments.map(async (file, index) => {
    if (!(file instanceof File)) return null
    validateAttachmentSize(file)
    const safeName = `${Date.now()}-${index}-${String(file.name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const storagePath = `threads/${threadId}/messages/${messageId}/attachments/${safeName}`
    const storageRef = ref(storage, storagePath)
    const dimensions = await getImageDimensions(file)
    await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' })
    const url = await getDownloadURL(storageRef)
    return {
      name: file.name || safeName,
      type: String(file.type || '').split('/')[0] || 'file',
      mimeType: file.type || 'application/octet-stream',
      size: Number(file.size || 0),
      storagePath,
      url,
      ...(dimensions.width && dimensions.height ? dimensions : {})
    }
  }))

  return uploads.filter(Boolean)
}

function normalizeParticipant(participantId, raw = {}) {
  const avatarURL = String(
    raw.avatarURL
    || raw.avatarUrl
    || raw.photoURL
    || raw.photoUrl
    || raw.profileImageURL
    || raw.profileImageUrl
    || raw.profilePicture
    || raw.imageURL
    || raw.imageUrl
    || raw.photo
    || ''
  ).trim()
  return {
    id: participantId,
    uid: raw.uid || participantId,
    role: raw.role || 'member',
    displayName: String(raw.displayName || '').trim(),
    username: String(raw.username || '').trim(),
    avatarURL,
    photoURL: avatarURL,
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
  return query(collection(db, 'threads', threadId, 'messages'), orderBy('createdAt', 'asc'), limitToLast(INITIAL_MESSAGE_LIMIT))
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

export async function listOlderMessages(threadId, beforeCreatedAt = null, pageSize = OLDER_MESSAGE_PAGE_SIZE) {
  if (!db || !threadId || !beforeCreatedAt) return []
  const beforeDate = beforeCreatedAt instanceof Date ? beforeCreatedAt : new Date(beforeCreatedAt)
  if (Number.isNaN(beforeDate.getTime())) return []

  let snapshot
  try {
    snapshot = await getDocs(query(
      collection(db, 'threads', threadId, 'messages'),
      orderBy('createdAt', 'asc'),
      endBefore(beforeDate),
      limitToLast(Math.max(4, Math.min(Number(pageSize || OLDER_MESSAGE_PAGE_SIZE), 50)))
    ))
  } catch {
    snapshot = await getDocs(query(collection(db, 'threads', threadId, 'messages'), orderBy('createdAt', 'asc'), limit(300)))
  }

  return snapshot.docs
    .map((messageDoc) => normalizeMessage(messageDoc.id, messageDoc.data()))
    .filter((message) => new Date(message.createdAt || 0).getTime() < beforeDate.getTime())
    .sort((a, b) => (a.createdAt || '') > (b.createdAt || '') ? 1 : -1)
}

export function subscribeToMessages(threadId, callback, onError) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}

  try {
    return onSnapshot(getMessagesQuery(threadId), (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => normalizeMessage(
        docSnap.id,
        docSnap.data({ serverTimestamps: 'estimate' }),
        docSnap.metadata
      ))
      callback(messages)
    }, onError)
  } catch {
    return onSnapshot(query(collection(db, 'threads', threadId, 'messages'), limit(300)), (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => normalizeMessage(
        docSnap.id,
        docSnap.data({ serverTimestamps: 'estimate' }),
        docSnap.metadata
      ))
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
  attachmentsInput.forEach((file) => validateAttachmentSize(file))

  const threadRef = doc(db, 'threads', threadId)
  const messageRef = doc(collection(db, 'threads', threadId, 'messages'))

  const threadSnap = await getDoc(threadRef)
  if (!threadSnap.exists()) throw new Error('Thread not found.')
  const threadData = threadSnap.data() || {}
  const participantUids = getThreadParticipantUids(threadData)
  if (!participantUids.includes(payload.senderId)) {
    throw new Error('You are not a participant in this thread.')
  }
  const attachments = await uploadMessageAttachments(threadId, messageRef.id, attachmentsInput)
  const normalizedType = (() => {
    if (!attachments.length) return payload.type || 'text'
    if (attachments.length === 1 && !body) return getAttachmentKind(attachments[0])
    return 'attachment'
  })()
  const replyTo = payload.replyTo && typeof payload.replyTo === 'object'
    ? normalizeReplyTo(payload.replyTo)
    : null
  const clientMessageId = String(payload.clientMessageId || '').trim().slice(0, 80)
  const safePageContext = payload.safePageContext && typeof payload.safePageContext === 'object' ? payload.safePageContext : null
  const callable = httpsCallable(functions, 'sendInboxMessage')
  const response = await callable({
    threadId,
    messageId: messageRef.id,
    body,
    type: normalizedType,
    attachments,
    replyTo,
    clientMessageId,
    ...(safePageContext ? { safePageContext } : {})
  })
  return response.data
}

export async function editMessage({ threadId, messageId, uid, body }) {
  const trimmedBody = String(body || '').trim()
  if (!db || !threadId || !messageId || !uid) throw new Error('Missing required editMessage fields.')
  if (!trimmedBody) throw new Error('Message cannot be empty.')
  if (trimmedBody.length > 1200) throw new Error('Message exceeds 1200 character limit.')

  const messageRef = doc(db, 'threads', threadId, 'messages', messageId)
  const threadRef = doc(db, 'threads', threadId)
  await runTransaction(db, async (transaction) => {
    const [messageSnap, threadSnap] = await Promise.all([transaction.get(messageRef), transaction.get(threadRef)])
    if (!messageSnap.exists()) throw new Error('Message not found.')
    if (!threadSnap.exists()) throw new Error('Thread not found.')
    const message = messageSnap.data() || {}
    if (message.senderId !== uid) throw new Error('Only sender can edit this message.')
    if (Boolean(message.deleted)) throw new Error('Deleted messages cannot be edited.')
    if (Array.isArray(message.attachments) && message.attachments.length) throw new Error('Attachment messages cannot be edited.')
    if (String(message.type || 'text') !== 'text') throw new Error('Only text messages can be edited.')

    transaction.update(messageRef, {
      body: trimmedBody,
      edited: true,
      editedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })

    if (timestampToMillis(threadSnap.data()?.lastMessageAt) === timestampToMillis(message.createdAt)) {
      transaction.update(threadRef, {
        lastMessageText: summarizeMessage(trimmedBody, []),
        lastMessageType: 'text',
        lastMessageSenderId: uid,
        lastMessageAttachmentCount: 0,
        updatedAt: serverTimestamp()
      })
    }
  })

  return true
}

function emojiToKey(emoji = '') {
  return encodeURIComponent(String(emoji || '').trim())
}

function reactionIdFor(uid, emoji) {
  return `${uid}_${emojiToKey(emoji)}`
}

export async function addMessageReaction({ threadId, messageId, uid, emoji }) {
  const normalizedEmoji = String(emoji || '').trim()
  if (!db || !threadId || !messageId || !uid || !normalizedEmoji) return false
  const reactionRef = doc(db, 'threads', threadId, 'messages', messageId, 'reactions', reactionIdFor(uid, normalizedEmoji))
  await setDoc(reactionRef, {
    uid,
    emoji: normalizedEmoji,
    emojiKey: emojiToKey(normalizedEmoji),
    threadId,
    messageId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
  return true
}

export async function removeMessageReaction({ threadId, messageId, uid, emoji, reactionId }) {
  if (!db || !threadId || !messageId) return false
  const resolvedReactionId = reactionId || reactionIdFor(uid, emoji)
  if (!resolvedReactionId) return false
  await deleteDoc(doc(db, 'threads', threadId, 'messages', messageId, 'reactions', resolvedReactionId))
  return true
}

export function subscribeToMessageReactions(threadId, messageIds = [], callback, onError) {
  if (!db || !threadId || typeof callback !== 'function') return () => {}
  const ids = Array.from(new Set((messageIds || []).filter(Boolean)))
  if (!ids.length) {
    callback({})
    return () => {}
  }

  const reactionState = {}
  const unsubscribes = ids.map((messageId) => onSnapshot(
    collection(db, 'threads', threadId, 'messages', messageId, 'reactions'),
    (snapshot) => {
      reactionState[messageId] = snapshot.docs.map((docSnap) => normalizeReaction(docSnap.id, docSnap.data()))
      callback({ ...reactionState })
    },
    onError
  ))

  return () => unsubscribes.forEach((stop) => stop())
}

export async function hideMessageForMe({ threadId, messageId, uid }) {
  if (!db || !threadId || !messageId || !uid) return false
  await setDoc(doc(db, 'users', uid, 'hiddenThreadMessages', threadId, 'messages', messageId), {
    threadId,
    messageId,
    hiddenAt: serverTimestamp()
  }, { merge: true })
  return true
}

export function subscribeToHiddenThreadMessages({ threadId, uid, callback, onError }) {
  if (!db || !threadId || !uid || typeof callback !== 'function') return () => {}
  return onSnapshot(collection(db, 'users', uid, 'hiddenThreadMessages', threadId, 'messages'), (snapshot) => {
    callback(snapshot.docs.map((docSnap) => docSnap.id))
  }, onError)
}

export async function deleteMessageForEveryone({ threadId, messageId, uid }) {
  if (!db || !threadId || !messageId || !uid) throw new Error('Missing required deleteMessageForEveryone fields.')
  const messageRef = doc(db, 'threads', threadId, 'messages', messageId)
  const threadRef = doc(db, 'threads', threadId)
  await runTransaction(db, async (transaction) => {
    const [messageSnap, threadSnap] = await Promise.all([transaction.get(messageRef), transaction.get(threadRef)])
    if (!messageSnap.exists()) throw new Error('Message not found.')
    if (!threadSnap.exists()) throw new Error('Thread not found.')
    const message = messageSnap.data() || {}
    const thread = threadSnap.data() || {}
    const isThreadOwner = thread.createdBy === uid
    if (message.senderId !== uid && !isThreadOwner) throw new Error('Only sender or thread owner can delete for everyone.')
    if (message.deleted) return

    transaction.update(messageRef, {
      deleted: true,
      body: '',
      attachments: [],
      deletedAt: serverTimestamp(),
      deletedBy: uid,
      updatedAt: serverTimestamp()
      // TODO: storage cleanup for removed attachments should run in trusted backend flow.
    })

    if (timestampToMillis(threadSnap.data()?.lastMessageAt) === timestampToMillis(message.createdAt)) {
      transaction.update(threadRef, {
        lastMessageText: 'Message removed',
        lastMessageType: 'deleted',
        lastMessageSenderId: uid,
        lastMessageAttachmentCount: 0,
        updatedAt: serverTimestamp()
      })
    }
  })
  return true
}

export async function markThreadRead({ threadId, uid }) {
  if (!db || !threadId || !uid) return false

  const threadSnap = await getDoc(doc(db, 'threads', threadId))
  if (!threadSnap.exists()) return false

  await setDoc(doc(db, 'threads', threadId, 'participants', uid), {
    uid,
    lastDeliveredAt: serverTimestamp(),
    lastReadAt: serverTimestamp()
  }, { merge: true })

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
