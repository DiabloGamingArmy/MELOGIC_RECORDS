import {
  arrayRemove,
  arrayUnion,
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
  updateDoc,
  writeBatch
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
let hasWarnedThreadFallback = false

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
    participantCount: Number(raw.participantCount || 0),
    otherParticipantIds: Array.isArray(raw.otherParticipantIds) ? raw.otherParticipantIds : [],
    lastMessageText: raw.lastMessageText || '',
    lastMessageAt: toIsoDate(raw.lastMessageAt),
    lastMessageSenderId: raw.lastMessageSenderId || '',
    lastMessageType: raw.lastMessageType || 'text',
    status: raw.status || 'active',
    dmKey: raw.dmKey || '',
    unreadCount: Number(raw.unreadCount || 0)
  }
}

function getInboxMirrorQuery(uid) {
  return query(collection(db, 'users', uid, 'inboxThreads'), orderBy('updatedAt', 'desc'), limit(100))
}

function sortThreadsNewestFirst(threads = []) {
  return [...threads].sort((a, b) => {
    const aDate = a.lastMessageAt || a.updatedAt || a.createdAt || ''
    const bDate = b.lastMessageAt || b.updatedAt || b.createdAt || ''
    return aDate < bDate ? 1 : -1
  })
}

function shouldFallbackListener(error) {
  const code = String(error?.code || '').toLowerCase()
  return code.includes('failed-precondition')
    || code.includes('permission-denied')
    || code.includes('unavailable')
    || code.includes('internal')
}

export async function listThreadsForUser(uid) {
  if (!db || !uid) return []

  let snapshot
  try {
    snapshot = await getDocs(getInboxMirrorQuery(uid))
  } catch {
    snapshot = await getDocs(query(collection(db, 'users', uid, 'inboxThreads'), limit(100)))
  }

  const threads = snapshot.docs.map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
  return sortThreadsNewestFirst(threads)
}

export function subscribeToThreadsForUser(uid, callback, onError) {
  if (!db || !uid || typeof callback !== 'function') return () => {}

  let primaryUnsubscribe = () => {}
  let fallbackUnsubscribe = () => {}
  let usingFallback = false

  const startFallbackListener = () => {
    if (usingFallback) return
    usingFallback = true
    try {
      primaryUnsubscribe()
    } catch {
      // noop
    }
    if (!hasWarnedThreadFallback) {
      hasWarnedThreadFallback = true
      console.warn('[threadService] Primary inbox listener failed; falling back to unordered listener.')
    }
    fallbackUnsubscribe = onSnapshot(
      query(collection(db, 'users', uid, 'inboxThreads'), limit(100)),
      (snapshot) => {
        const threads = snapshot.docs.map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
        callback(sortThreadsNewestFirst(threads))
      },
      (error) => {
        if (typeof onError === 'function') onError(error)
      }
    )
  }

  primaryUnsubscribe = onSnapshot(getInboxMirrorQuery(uid), (snapshot) => {
    const threads = snapshot.docs.map((threadDoc) => normalizeThread(threadDoc.id, threadDoc.data()))
    callback(sortThreadsNewestFirst(threads))
  }, (error) => {
    if (shouldFallbackListener(error)) {
      startFallbackListener()
      return
    }
    if (typeof onError === 'function') onError(error)
  })

  return () => {
    primaryUnsubscribe()
    fallbackUnsubscribe()
  }
}

export async function getThread(threadId) {
  if (!db || !threadId) return null
  try {
    const threadDoc = await getDoc(doc(db, 'threads', threadId))
    if (!threadDoc.exists()) return null
    return normalizeThread(threadDoc.id, threadDoc.data())
  } catch (error) {
    if (String(error?.code || '').includes('permission-denied')) return null
    throw error
  }
}

export async function createOrGetDm({ creatorId, targetUid }) {
  if (!creatorId || !targetUid) throw new Error('createOrGetDm requires creatorId and targetUid.')

  try {
    const callable = httpsCallable(functions, 'createOrGetDm')
    const result = await callable({ targetUid })
    if (result?.data?.threadId) {
      console.info('[threadService] createOrGetDm callable succeeded', {
        threadId: result.data.threadId,
        existing: Boolean(result.data.existing)
      })
      return getThread(result.data.threadId)
    }
  } catch (error) {
    console.warn('[threadService] createOrGetDm callable failed', {
      code: error?.code || 'unknown',
      message: error?.message || 'Callable failed'
    })
    if (String(error?.code || '').includes('not-found')) {
      throw new Error('Messaging service is not fully deployed. Please try again later.')
    }
    throw error
  }
  throw new Error('Messaging service is not fully deployed. Please try again later.')
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
        lastDeliveredAt: null,
        lastReadAt: null,
        muted: false,
        archived: false
      },
      { merge: true }
    )
  })

  await Promise.all(writes)
}

export async function createGroupThread({ creatorId, participantIds = [], title = '', imagePath = '', imageURL = '' }) {
  if (!creatorId) throw new Error('createGroupThread requires creatorId.')
  try {
    const callable = httpsCallable(functions, 'createGroupThread')
    const result = await callable({ participantIds, title, imagePath, imageURL })
    if (result?.data?.threadId) return getThread(result.data.threadId)
  } catch (error) {
    if (String(error?.code || '').includes('not-found')) {
      throw new Error('Messaging service is not fully deployed. Please try again later.')
    }
    throw error
  }

  throw new Error('Messaging service is not fully deployed. Please try again later.')
}

export async function repairMyInboxThreads() {
  const callable = httpsCallable(functions, 'repairMyInboxThreads')
  const result = await callable({})
  return {
    repairedCount: Number(result?.data?.repairedCount || 0)
  }
}

export async function addParticipantsToThread({ threadId, actorUid, participantIds = [] }) {
  if (!db || !threadId || !actorUid || !participantIds.length) return false

  try {
    const callable = httpsCallable(functions, 'updateThreadParticipants')
    await callable({ threadId, mode: 'add', participantIds })
    return true
  } catch {
    // fallback only for local scaffolding
  }

  const threadRef = doc(db, 'threads', threadId)
  const thread = await getThread(threadId)
  if (!thread) throw new Error('Thread not found.')
  if (!Array.isArray(thread.participantIds) || !thread.participantIds.includes(actorUid)) {
    throw new Error('Only participants can add members.')
  }
  if (thread.createdBy && thread.createdBy !== actorUid) {
    throw new Error('Only owner can add members.')
  }

  const uniqueNewParticipants = Array.from(new Set(participantIds.filter(Boolean)))
  if (!uniqueNewParticipants.length) return false

  await updateDoc(threadRef, {
    participantIds: arrayUnion(...uniqueNewParticipants),
    updatedAt: serverTimestamp()
  })

  const updatedThread = await getThread(threadId)
  const allIds = updatedThread?.participantIds || []
  await upsertParticipants(threadId, uniqueNewParticipants, actorUid)
  await updateDoc(threadRef, { participantCount: allIds.length })
  return true
}

export async function removeParticipantFromThread({ threadId, actorUid, participantId }) {
  if (!db || !threadId || !actorUid || !participantId) return false

  try {
    const callable = httpsCallable(functions, 'updateThreadParticipants')
    await callable({ threadId, mode: 'remove', participantIds: [participantId] })
    return true
  } catch {
    // fallback only for local scaffolding
  }

  const threadRef = doc(db, 'threads', threadId)
  await runTransaction(db, async (transaction) => {
    const participantRef = doc(db, 'threads', threadId, 'participants', actorUid)
    const participantSnap = await transaction.get(participantRef)
    if (!participantSnap.exists()) throw new Error('Not a participant.')
    const role = participantSnap.data()?.role || 'member'
    if (role !== 'owner' && actorUid !== participantId) {
      throw new Error('Only owner can remove others.')
    }

    transaction.update(threadRef, {
      participantIds: arrayRemove(participantId),
      updatedAt: serverTimestamp()
    })
  })

  const batch = writeBatch(db)
  batch.set(doc(db, 'threads', threadId, 'participants', participantId), { archived: true }, { merge: true })
  await batch.commit()

  const thread = await getThread(threadId)
  await updateDoc(threadRef, { participantCount: (thread?.participantIds || []).length })
  return true
}

export async function updateThreadDetails({ threadId, actorUid, title = '', imageURL = '', imagePath = '' }) {
  if (!db || !threadId || !actorUid) return false
  const thread = await getThread(threadId)
  if (!thread) throw new Error('Thread not found.')
  if (thread.type !== 'group') throw new Error('Only group chats can be renamed.')
  if (thread.createdBy && thread.createdBy !== actorUid) throw new Error('Only the group owner can edit chat details.')

  await updateDoc(doc(db, 'threads', threadId), {
    title: String(title || '').trim(),
    imageURL: String(imageURL || '').trim(),
    imagePath: String(imagePath || '').trim(),
    updatedAt: serverTimestamp()
  })

  return true
}
