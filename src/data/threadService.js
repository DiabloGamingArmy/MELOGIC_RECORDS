import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase/firestore'

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeThread(threadId, raw = {}) {
  return {
    id: threadId,
    type: raw.type === 'group' ? 'group' : 'dm',
    createdBy: raw.createdBy || '',
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    title: raw.title || '',
    imagePath: raw.imagePath || '',
    imageURL: raw.imageURL || '',
    participantIds: Array.isArray(raw.participantIds) ? raw.participantIds : [],
    lastMessageText: raw.lastMessageText || '',
    lastMessageAt: toIsoDate(raw.lastMessageAt),
    lastMessageSenderId: raw.lastMessageSenderId || ''
  }
}

export async function listThreadsForUser(uid) {
  if (!db || !uid) return []

  const threadRef = collection(db, 'threads')
  let snapshot

  try {
    snapshot = await getDocs(query(threadRef, where('participantIds', 'array-contains', uid), orderBy('updatedAt', 'desc'), limit(100)))
  } catch {
    snapshot = await getDocs(query(threadRef, where('participantIds', 'array-contains', uid), limit(100)))
  }

  const threads = snapshot.docs.map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
  return threads.sort((a, b) => {
    const aDate = a.lastMessageAt || a.updatedAt || a.createdAt || ''
    const bDate = b.lastMessageAt || b.updatedAt || b.createdAt || ''
    return aDate < bDate ? 1 : -1
  })
}

export async function getThread(threadId) {
  if (!db || !threadId) return null
  const threadDoc = await getDoc(doc(db, 'threads', threadId))
  if (!threadDoc.exists()) return null
  return normalizeThread(threadDoc.id, threadDoc.data())
}

async function upsertParticipants(threadId, participantIds = [], ownerId = '') {
  const writes = participantIds.map((uid) => {
    const role = uid === ownerId ? 'owner' : 'member'
    return setDoc(
      doc(db, 'threads', threadId, 'participants', uid),
      {
        uid,
        role,
        joinedAt: serverTimestamp(),
        lastReadAt: null
      },
      { merge: true }
    )
  })

  await Promise.all(writes)
}

export async function createDmThread({ creatorId, participantId }) {
  if (!db || !creatorId || !participantId || creatorId === participantId) {
    throw new Error('createDmThread requires unique creatorId and participantId.')
  }

  const participantIds = [creatorId, participantId]

  const existing = await getDocs(query(collection(db, 'threads'), where('type', '==', 'dm'), where('participantIds', 'array-contains', creatorId), limit(20)))

  const existingThread = existing.docs
    .map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
    .find((thread) => thread.participantIds.length === 2 && thread.participantIds.includes(participantId))

  if (existingThread) return existingThread

  const threadDoc = await addDoc(collection(db, 'threads'), {
    type: 'dm',
    createdBy: creatorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    title: '',
    imagePath: '',
    imageURL: '',
    participantIds,
    lastMessageText: '',
    lastMessageAt: null,
    lastMessageSenderId: ''
  })

  await upsertParticipants(threadDoc.id, participantIds, creatorId)
  return getThread(threadDoc.id)
}

export async function createGroupThread({ creatorId, participantIds = [], title = '', imagePath = '', imageURL = '' }) {
  if (!db || !creatorId) {
    throw new Error('createGroupThread requires creatorId.')
  }

  const members = Array.from(new Set([creatorId, ...participantIds].filter(Boolean)))
  const threadDoc = await addDoc(collection(db, 'threads'), {
    type: 'group',
    createdBy: creatorId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    title: String(title || '').trim(),
    imagePath: imagePath || '',
    imageURL: imageURL || '',
    participantIds: members,
    lastMessageText: '',
    lastMessageAt: null,
    lastMessageSenderId: ''
  })

  await upsertParticipants(threadDoc.id, members, creatorId)
  return getThread(threadDoc.id)
}
